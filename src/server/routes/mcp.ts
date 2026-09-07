// Discovery, pairing, and the paired-client list.
//
// Split into two halves with very different trust:
//
//   PRE-TRUST   /api/mcp/hello, /api/mcp/pair/request, /api/mcp/pair/status
//               Reachable cross-origin and without a token, because they have
//               to answer before any trust exists. Rate-limited, and they hand
//               out nothing but a code the user must confirm out-of-band.
//
//   DASHBOARD   everything else — pending, approve, deny, clients, revoke.
//               Same-origin only, enforced by the global host/origin guard,
//               which is why the delegated-path list in that guard names exact
//               paths from the first group and nothing else. A page that could
//               both request AND approve a pairing would have paired itself.

import { Router } from "express";
import express from "express";
import { listClients, revokeClient, revokeAllClients } from "../mcp/auth";
import { dropSessionsForClient, SUPPORTED_PROTOCOL_VERSIONS } from "../mcp/server";
import {
  approvePairing,
  clearDenials,
  denyPairing,
  pairingStatus,
  pendingPairing,
  requestPairing,
} from "../mcp/pairing";
import { normaliseOrigin } from "../mcp/auth";
import { appVersion } from "../util/app-version";
import { getSettings, saveSettings } from "../config/settings";
import { loopbackOnly } from "../util/loopback-only";

export const mcpApiRouter = Router();

// Fixed-window limiter for the unauthenticated half. Not a general-purpose rate
// limiter — it exists so a script cannot grind the pairing endpoints.
//
// Two budgets, because the two kinds of call have very different shapes and one
// number cannot serve both. `pair/request` CREATES state and a human only ever
// does it a handful of times, so it is tight. `hello` and `pair/status` are
// cheap reads that a pairing client makes on a timer — a client polling every
// two seconds across the two-minute approval window legitimately makes ~60
// calls, so a budget below that would break the very flow it is protecting.
const WINDOW_MS = 60_000;
const READ_BUDGET = 180;
const WRITE_BUDGET = 10;

const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, budget: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > budget;
}

/** Test seam — the limiter is keyed on the peer address, and every test in a
 *  suite shares one. */
export function _resetRateLimitForTests(): void {
  hits.clear();
}

/** Keyed on the peer address, not on anything the caller sends. A header-keyed
 *  limiter is a limiter the caller resets at will. */
function limiterKey(req: express.Request): string {
  return req.socket?.remoteAddress ?? "unknown";
}

function allowPreTrustOrigin(req: express.Request, res: express.Response): void {
  // These three must answer a page whose origin is not yet paired — that is the
  // whole point of discovery. Echoing the caller's origin rather than "*" keeps
  // the response uncacheable across origins and leaves the door open to
  // credentialed requests later without a second pass over this file.
  const origin = normaliseOrigin(req.headers.origin as string | undefined);
  res.setHeader("Vary", "Origin");
  if (!origin) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
}

function serverVersion(): string {
  // One source of truth with the dashboard's About page and /api/status.
  return appVersion();
}

// ─── Pre-trust ────────────────────────────────────────────────────────────────

mcpApiRouter.options("/api/mcp/hello", (req, res) => {
  allowPreTrustOrigin(req, res);
  res.status(204).end();
});

/**
 * The discovery probe.
 *
 * A browser cannot read `.port-runtime` and has no mDNS, so the Foundry module
 * finds Vault by walking the same bounded port range Vault itself binds and
 * asking each one whether it is here.
 *
 * Deliberately the only unauthenticated GET, and deliberately boring. It says
 * "Tusk's Vault is running on this port" and the protocol it speaks — enough to
 * pair, and a small fingerprint that is the price of zero-configuration
 * discovery. It does NOT report which surfaces are enabled, how much lore is
 * loaded, or anything about the campaign: everything past this point needs a
 * token.
 */
mcpApiRouter.get("/api/mcp/hello", (req, res) => {
  allowPreTrustOrigin(req, res);
  if (rateLimited(`read:${limiterKey(req)}`, READ_BUDGET)) {
    res.status(429).json({ error: "Too many requests." });
    return;
  }
  res.json({
    app: "tusks-vault",
    version: serverVersion(),
    protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
    // "busy" means another pairing is already awaiting approval, so the module
    // can say that instead of silently failing to raise a prompt.
    pairing: pendingPairing() ? "busy" : "open",
  });
});

mcpApiRouter.options("/api/mcp/pair/request", (req, res) => {
  allowPreTrustOrigin(req, res);
  res.status(204).end();
});

mcpApiRouter.post("/api/mcp/pair/request", express.json({ limit: "4kb" }), (req, res) => {
  allowPreTrustOrigin(req, res);
  if (rateLimited(`write:${limiterKey(req)}`, WRITE_BUDGET)) {
    res.status(429).json({ error: "Too many requests." });
    return;
  }

  const origin = normaliseOrigin(req.headers.origin as string | undefined);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const outcome = requestPairing({
    origin,
    surface: body.surface,
    clientName: body.clientName,
    worldTitle: body.worldTitle,
    foundryVersion: body.foundryVersion,
  });

  if (!outcome.ok) {
    res.status(409).json({
      error:
        outcome.reason === "busy"
          ? "Another pairing request is already waiting for approval in Tusk's Vault."
          : "This origin was refused recently. Clear it in Tusk's Vault under Surfaces to try again.",
      reason: outcome.reason,
    });
    return;
  }

  // The code goes back to the caller so Foundry can DISPLAY it. That is the
  // point: the user compares what Foundry shows with what the dashboard shows.
  // It is not a secret and it grants nothing on its own.
  res.json({ requestId: outcome.requestId, code: outcome.code, expiresAt: outcome.expiresAt });
});

mcpApiRouter.options("/api/mcp/pair/status", (req, res) => {
  allowPreTrustOrigin(req, res);
  res.status(204).end();
});

/** Polled by the pairing client. The requestId is an unguessable UUID and the
 *  token is returned exactly once, so a late poller gets `approved` with no
 *  token rather than a second copy of the credential. */
mcpApiRouter.get("/api/mcp/pair/status", (req, res) => {
  allowPreTrustOrigin(req, res);
  if (rateLimited(`read:${limiterKey(req)}`, READ_BUDGET)) {
    res.status(429).json({ error: "Too many requests." });
    return;
  }
  const requestId = String(req.query.requestId ?? "");
  res.json(pairingStatus(requestId));
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

// The dashboard half is an ADMINISTRATIVE act on the host: approving mints a
// whole-corpus credential AND switches the surface on. The header comment above
// says this half is "same-origin only, enforced by the global host/origin
// guard" — that was not sufficient, because the guard's cross-origin check only
// fires when an Origin or Referer header is PRESENT. A headerless client (curl,
// any non-browser HTTP client) met no check at all, so under HOST=0.0.0.0 a LAN
// device could POST /pair/request, POST /pair/approve with the requestId it had
// just been handed, read the token from /pair/status, and query the whole
// campaign through ask_lore — the exact "requested AND approved its own
// pairing" failure the comment above names, reached without a browser.
//
// The peer address is the right check here for the reason the rest of the
// codebase already uses it: headers are attacker-controlled and it is not.
//
// These stay ungated deliberately — a GM's Foundry page is not on loopback and
// must reach them: /api/mcp/hello, /api/mcp/pair/request, /api/mcp/pair/status,
// and POST /mcp itself (which is gated by the bearer token instead).
//
// Registered BEFORE the routes below, because Express runs middleware in
// registration order and a `.use()` added after a route never runs for it.
for (const dashboardPath of [
  "/api/mcp/pair/pending",
  "/api/mcp/pair/approve",
  "/api/mcp/pair/deny",
  "/api/mcp/pair/clear-denials",
  "/api/mcp/clients",
]) {
  mcpApiRouter.use(dashboardPath, loopbackOnly());
}

mcpApiRouter.get("/api/mcp/pair/pending", (_req, res) => {
  res.json({ pending: pendingPairing() });
});

mcpApiRouter.post("/api/mcp/pair/approve", express.json({ limit: "4kb" }), (req, res) => {
  const requestId = String((req.body ?? {}).requestId ?? "");
  const approved = approvePairing(requestId);
  if (!approved) {
    res.status(409).json({ error: "That pairing request is no longer waiting for approval." });
    return;
  }
  // Approving a pairing IS the consent to answer on that surface, so switch it
  // on. Without this every first pairing succeeds and then fails its own
  // verification call — the module proves the credential immediately, the
  // surface is off by default, and the GM is told "paired, but the first call
  // failed" one second after clicking Allow. Only ever turns a surface ON, and
  // only for the surface the GM just approved: a later manual switch-off is a
  // deliberate act and re-pairing is what undoes it.
  const settings = getSettings();
  if (!settings.surfaces[approved.surface].enabled) {
    settings.surfaces[approved.surface].enabled = true;
    saveSettings(settings);
  }
  // The token goes to the pairing client via /pair/status and NOWHERE else.
  // Returning it here would put a live credential in the dashboard's network
  // log for no reason — the dashboard never needs to hold it.
  res.json({ ok: true, clientId: approved.clientId, surfaceEnabled: approved.surface });
});

mcpApiRouter.post("/api/mcp/pair/deny", express.json({ limit: "4kb" }), (req, res) => {
  const requestId = String((req.body ?? {}).requestId ?? "");
  res.json({ ok: denyPairing(requestId) });
});

mcpApiRouter.post("/api/mcp/pair/clear-denials", (_req, res) => {
  clearDenials();
  res.json({ ok: true });
});

/** The paired-client list. Token hashes are stripped — the dashboard has no use
 *  for them, and a hash in a UI is a hash in a screenshot. */
mcpApiRouter.get("/api/mcp/clients", (_req, res) => {
  res.json({
    clients: listClients().map(c => ({
      id: c.id,
      label: c.label,
      origin: c.origin,
      surface: c.surface,
      createdAt: c.createdAt,
      lastSeenAt: c.lastSeenAt,
    })),
  });
});

mcpApiRouter.delete("/api/mcp/clients/:id", (req, res) => {
  const id = String(req.params.id ?? "");
  const removed = revokeClient(id);
  // Sessions die with the credential. A revocation that leaves the holder
  // connected until the next restart is not a revocation.
  if (removed) dropSessionsForClient(id);
  res.status(removed ? 200 : 404).json({ ok: removed });
});

mcpApiRouter.post("/api/mcp/clients/revoke-all", (_req, res) => {
  for (const c of listClients()) dropSessionsForClient(c.id);
  res.json({ revoked: revokeAllClients() });
});
