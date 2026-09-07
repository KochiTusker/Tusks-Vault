// The one-click pairing handshake.
//
// Copying a token between two apps is the friction this exists to remove, so
// the flow is the shape used to pair a device: the client asks, both ends show
// the same short code, the human confirms the codes match and clicks Allow, and
// only then does a token exist.
//
// The code is not decoration. Without it, a page the GM has open in another tab
// could fire its own pair request at the moment they went looking for the
// prompt, and they would have no way to tell which of the two they were
// approving. Matching codes make the approval specific to the thing that asked:
// a hostile page can raise a prompt, but it cannot make Foundry display ITS
// code.
//
// State is deliberately in memory. A pairing request is valid for two minutes
// and means nothing after a restart, so persisting it would only create a way
// for a stale request to be approved later.

import crypto from "crypto";
import { addClient, isMcpSurface, type McpSurface } from "./auth";

/** How long a request stays approvable. Long enough to glance between two
 *  screens, short enough that a prompt left unattended lapses on its own. */
export const PAIRING_TTL_MS = 2 * 60 * 1000;

/** How long a denial suppresses further prompts from the same origin. A denial
 *  is the user saying "not this thing"; re-prompting immediately would let a
 *  hostile page grind them down until they mis-click. */
export const DENIAL_COOLDOWN_MS = 60 * 60 * 1000;

export type PairingStatus = "pending" | "approved" | "denied" | "expired" | "unknown";

interface PairingRequest {
  id: string;
  code: string;
  origin: string;
  /** What the caller says it is. Shown to the human before they approve, and
   *  baked into the credential on approval — see PairedClient.surface. */
  surface: McpSurface;
  clientName: string;
  worldTitle: string;
  foundryVersion: string;
  createdAt: number;
  expiresAt: number;
  status: Exclude<PairingStatus, "unknown">;
  /** Set on approval, cleared the first time the client collects it. A token
   *  that can be fetched twice is a token the loser of a race also holds. */
  token?: string;
}

/** At most one request may be outstanding. A queue of prompts is a queue of
 *  chances to approve the wrong one. */
let current: PairingRequest | null = null;

/** origin → epoch ms when the denial lapses. */
const denials = new Map<string, number>();

function now(): number {
  return Date.now();
}

/** Expire the outstanding request in place if its time is up. Called at the top
 *  of every read so a lapsed request is never shown as live. */
function sweep(): void {
  if (current && current.status === "pending" && now() > current.expiresAt) {
    current.status = "expired";
  }
}

function isDenied(origin: string): boolean {
  const until = denials.get(origin);
  if (until === undefined) return false;
  if (now() > until) {
    denials.delete(origin);
    return false;
  }
  return true;
}

/** Six digits, uniformly drawn. `randomInt` rather than `Math.random` because
 *  this is the value that makes an approval specific. */
function mintCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Cap free text from an unauthenticated caller before it reaches the
 *  dashboard. The panel escapes it too — this is the belt to that pair of
 *  braces, and it also stops a megabyte of "world title" being held in memory. */
function clamp(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim().slice(0, max) : "";
}

export interface PairingRequestInput {
  origin: string;
  /** Anything unrecognised pairs as a plain `mcp` client — the surface with no
   *  Foundry-specific policy attached. Defaulting the other way would let a
   *  malformed request claim the Foundry surface by omission. */
  surface?: unknown;
  clientName?: unknown;
  worldTitle?: unknown;
  foundryVersion?: unknown;
}

/**
 * Flat, not a discriminated union.
 *
 * `strictNullChecks` is off in this repo, so a union on `ok` does NOT narrow —
 * the compiler would happily let a caller read `.reason` off the success arm.
 * Optional fields on one shape are honest about that; see the same note in
 * chat/types.ts.
 */
export interface PairingRequestOutcome {
  ok: boolean;
  requestId?: string;
  code?: string;
  expiresAt?: number;
  /** Only set when `ok` is false. */
  reason?: "busy" | "denied";
}

/**
 * Open a pairing request.
 *
 * Refuses while another is outstanding (`busy`) and while this origin is inside
 * its denial cooldown (`denied`). Both are reported to the caller so the module
 * can say something useful instead of hanging on a prompt that will never
 * appear.
 */
export function requestPairing(input: PairingRequestInput): PairingRequestOutcome {
  sweep();
  if (isDenied(input.origin)) return { ok: false, reason: "denied" };
  if (current && current.status === "pending") return { ok: false, reason: "busy" };

  const created = now();
  current = {
    id: crypto.randomUUID(),
    code: mintCode(),
    origin: input.origin,
    surface: isMcpSurface(input.surface) ? input.surface : "mcp",
    clientName: clamp(input.clientName, 60) || "Unknown client",
    worldTitle: clamp(input.worldTitle, 80),
    foundryVersion: clamp(input.foundryVersion, 20),
    createdAt: created,
    expiresAt: created + PAIRING_TTL_MS,
    status: "pending",
  };
  return { ok: true, requestId: current.id, code: current.code, expiresAt: current.expiresAt };
}

/** What the dashboard shows beside Allow / Deny. Carries the code — the whole
 *  point is that the human compares it with the one Foundry is showing. */
export interface PendingPairing {
  requestId: string;
  code: string;
  origin: string;
  surface: McpSurface;
  clientName: string;
  worldTitle: string;
  foundryVersion: string;
  expiresAt: number;
}

export function pendingPairing(): PendingPairing | null {
  sweep();
  if (!current || current.status !== "pending") return null;
  return {
    requestId: current.id,
    code: current.code,
    origin: current.origin,
    surface: current.surface,
    clientName: current.clientName,
    worldTitle: current.worldTitle,
    foundryVersion: current.foundryVersion,
    expiresAt: current.expiresAt,
  };
}

/**
 * Approve the outstanding request and mint the client.
 *
 * Takes the requestId and checks it matches, so a stale dashboard tab cannot
 * approve a request that replaced the one it was showing.
 */
export function approvePairing(
  requestId: string
): { token: string; clientId: string; surface: McpSurface } | null {
  sweep();
  if (!current || current.status !== "pending" || current.id !== requestId) return null;

  const label = current.worldTitle
    ? `${current.clientName} — ${current.worldTitle}`
    : current.clientName;
  const { client, token } = addClient({
    origin: current.origin,
    surface: current.surface,
    label,
  });
  current.status = "approved";
  current.token = token;
  // The surface travels with the result so the caller can switch it on. It is
  // fixed at pairing (see auth.ts) and never re-claimed per request, so this is
  // the same value every later call is judged against.
  return { token, clientId: client.id, surface: current.surface };
}

export function denyPairing(requestId: string): boolean {
  sweep();
  if (!current || current.status !== "pending" || current.id !== requestId) return false;
  current.status = "denied";
  denials.set(current.origin, now() + DENIAL_COOLDOWN_MS);
  return true;
}

/** Lets the dashboard undo an accidental Deny without waiting out the cooldown
 *  or restarting the app. */
export function clearDenials(): void {
  denials.clear();
}

export interface PairingStatusResult {
  status: PairingStatus;
  /** Present exactly once, on the first read after approval. */
  token?: string;
}

/**
 * What happened to a request, and — once — the token it earned.
 *
 * The token is cleared as it is handed over. The polling client is the only
 * party that should ever hold it, and a second reader is by definition not that
 * client.
 */
export function pairingStatus(requestId: string): PairingStatusResult {
  sweep();
  if (!current || current.id !== requestId) return { status: "unknown" };
  if (current.status === "approved" && current.token) {
    const token = current.token;
    delete current.token;
    return { status: "approved", token };
  }
  return { status: current.status };
}

/** Test seam. Pairing state is process-global by design; the suite needs to be
 *  able to start from nothing. */
export function _resetPairingForTests(): void {
  current = null;
  denials.clear();
}
