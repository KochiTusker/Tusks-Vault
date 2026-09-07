// Who may talk to the MCP endpoint, and how they earned the right.
//
// The endpoint is a pre-auth surface reachable from any page the GM happens to
// have open, so this module carries three independent defences and none of them
// is decorative:
//
//   1. A bearer token, minted here, stored only as a SHA-256 hash, compared in
//      constant time. This is the real gate — a non-browser process on the
//      machine can send whatever Origin header it likes.
//   2. An Origin allow-list, narrowed to the exact origins that completed
//      pairing. The MCP transport spec makes this mandatory rather than
//      optional, and it is what stops a drive-by page: a browser sets Origin
//      itself and a page cannot forge it.
//   3. A pairing handshake with a matching code, so approving a connection is
//      specific to the thing that asked rather than to whatever happened to
//      fire a request at the same moment.
//
// The token is stored hashed, not encrypted-and-recoverable, because nothing
// ever needs to read it back: pairing hands it to the client once. That makes a
// stolen mcp-clients.json worthless on its own, and it makes a lost token a
// re-pair (one click) rather than a recovery flow.

import crypto from "crypto";
import fs from "fs";
import { configFile, ensureConfigDir } from "../config/app-data";
import { writeJsonAtomic } from "../util/atomic-write";
import type { SurfaceId } from "../chat/types";

/** Surfaces reachable over MCP. Discord is not one of them — it arrives over
 *  its own gateway and never touches this endpoint. */
export type McpSurface = Extract<SurfaceId, "foundry" | "mcp">;

export function isMcpSurface(value: unknown): value is McpSurface {
  return value === "foundry" || value === "mcp";
}

/** A client that completed pairing. The token itself is NOT here — only its
 *  hash — so this record is safe to read, to log the shape of, and to back up. */
export interface PairedClient {
  id: string;
  /** SHA-256 of the bearer token, hex. Never the token. */
  tokenHash: string;
  /** Exact scheme://host[:port] this client pairs from. Empty for a non-browser
   *  client (the stdio shim, an agent on this machine), which sends no Origin. */
  origin: string;
  /**
   * Which surface this credential speaks for — fixed at pairing, never taken
   * from the request.
   *
   * It decides the enable toggle, the provider override and the `allowPlayers`
   * ceiling that apply, so a per-request claim would let a caller pick its own
   * policy: asking as `mcp` would step around the Foundry ceiling entirely.
   * Binding it to the credential means the human approving the pairing is the
   * one who decides what the token may be, and it cannot change afterwards.
   */
  surface: McpSurface;
  /** Human label for the paired-clients list in the dashboard. */
  label: string;
  createdAt: string;
  lastSeenAt?: string;
}

interface ClientStoreFile {
  version: 1;
  clients: PairedClient[];
}

function storePath(): string {
  return configFile("mcp-clients.json");
}

function isClientRecord(c: unknown): c is PairedClient {
  const r = c as Partial<PairedClient>;
  return (
    !!r &&
    typeof r.id === "string" &&
    typeof r.tokenHash === "string" &&
    typeof r.origin === "string" &&
    typeof r.label === "string" &&
    // A record without a recognised surface is dropped rather than defaulted.
    // Guessing here would hand an unknown credential a policy it was never
    // approved for, and the cost of being wrong is one re-pair.
    isMcpSurface(r.surface)
  );
}

function readStore(): ClientStoreFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf-8")) as Partial<ClientStoreFile>;
    if (!Array.isArray(parsed?.clients)) return { version: 1, clients: [] };
    return { version: 1, clients: parsed.clients.filter(isClientRecord) };
  } catch {
    // Absent and unparseable both mean "nothing is paired". A corrupt store has
    // to fail closed — no client authenticates — rather than throw on every
    // request and take the dashboard down with it.
    return { version: 1, clients: [] };
  }
}

function writeStore(store: ClientStoreFile): void {
  ensureConfigDir();
  writeJsonAtomic(storePath(), store);
}

export function listClients(): PairedClient[] {
  return readStore().clients;
}

/** 32 bytes of CSPRNG, base64url. Long enough that the hash needs no slow KDF —
 *  there is no low-entropy secret here to brute-force. */
export function mintToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf-8").digest("hex");
}

/** Constant-time compare of two hex digests. Both are fixed-length hex, so the
 *  length guard can never leak anything about the secret — it only ever fires
 *  on malformed stored input. */
function digestsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export interface NewClient {
  client: PairedClient;
  /** The only moment the plaintext token exists. Hand it to the caller and
   *  forget it — nothing can read it back afterwards. */
  token: string;
}

export function addClient(opts: { origin: string; label: string; surface: McpSurface }): NewClient {
  const token = mintToken();
  const client: PairedClient = {
    id: crypto.randomUUID(),
    tokenHash: hashToken(token),
    origin: opts.origin,
    surface: opts.surface,
    label: opts.label,
    createdAt: new Date().toISOString(),
  };
  const store = readStore();
  store.clients.push(client);
  writeStore(store);
  return { client, token };
}

/** Drop a client. False when the id was already gone, so the caller can answer
 *  404 rather than report a revocation that did not happen. */
export function revokeClient(id: string): boolean {
  const store = readStore();
  const before = store.clients.length;
  store.clients = store.clients.filter(c => c.id !== id);
  if (store.clients.length === before) return false;
  writeStore(store);
  return true;
}

export function revokeAllClients(): number {
  const store = readStore();
  const n = store.clients.length;
  if (n === 0) return 0;
  writeStore({ version: 1, clients: [] });
  return n;
}

/** Record that a client was seen. Best-effort: a failed write must never fail
 *  the request it was decorating. */
export function touchClient(id: string): void {
  try {
    const store = readStore();
    const client = store.clients.find(c => c.id === id);
    if (!client) return;
    client.lastSeenAt = new Date().toISOString();
    writeStore(store);
  } catch {
    /* telemetry, not correctness */
  }
}

/** Pull the bearer token out of an Authorization header. Empty string for
 *  anything that is not exactly `Bearer <token>`. */
export function bearerToken(authorization: string | undefined): string {
  const m = /^Bearer +(\S+)$/.exec((authorization ?? "").trim());
  return m ? m[1] : "";
}

/**
 * Resolve a bearer token to the client holding it.
 *
 * Compares against EVERY stored client instead of short-circuiting on the first
 * match, so the work done is a function of how many clients are paired and not
 * of which one the presented token belongs to.
 */
export function authenticateToken(token: string): PairedClient | null {
  if (!token) return null;
  const candidate = hashToken(token);
  let found: PairedClient | null = null;
  for (const client of listClients()) {
    if (digestsEqual(client.tokenHash, candidate)) found = client;
  }
  return found;
}

/**
 * Normalise an Origin header to scheme://host[:port].
 *
 * Empty string means "no usable origin", which covers both an absent header and
 * the literal `null` a sandboxed iframe sends. `null` deliberately collapses to
 * the same value as absent and is then handled by the caller — it is not an
 * origin that can be allow-listed, so it must never match a paired one.
 */
export function normaliseOrigin(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (!value || value === "null") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

/**
 * May a request carrying this (already normalised) Origin reach the
 * authenticated endpoint?
 *
 * An absent Origin is allowed: a non-browser MCP client — the stdio shim, an
 * agent running on this machine — does not send one, and for that caller the
 * token is doing the whole job. A browser always sends Origin on a cross-origin
 * POST and cannot forge it, so a present-but-unpaired Origin is a drive-by and
 * is refused.
 *
 * The list is the paired set rather than a configured string: an origin becomes
 * allowed by completing pairing, and stops being allowed the instant its client
 * is revoked.
 */
export function isOriginAllowed(origin: string): boolean {
  if (!origin) return true;
  return listClients().some(c => c.origin && c.origin === origin);
}
