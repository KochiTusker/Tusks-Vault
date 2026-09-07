// The MCP dashboard half is gated on the PEER ADDRESS, not on a header.
//
// Why this file exists, and why it is written against a fake peer address
// rather than a fake Origin:
//
// mcp.ts's header comment said the dashboard half was "same-origin only,
// enforced by the global host/origin guard". mcp/server.test.ts asserts that,
// and it passes — but it asserts it by SENDING an Origin. The guard's
// cross-origin check only fires when an Origin or Referer header is present
// (host-origin-guard.ts), so a client that simply omits both met no check at
// all. Under the documented HOST=0.0.0.0 option that left this chain open to
// any device on the LAN:
//
//   POST /api/mcp/pair/request   -> { requestId, code }, origin bound to ""
//   POST /api/mcp/pair/approve   -> approvePairing() checks only that the
//                                   requestId matches the pending one, which
//                                   the caller was just handed. Mints the
//                                   client AND switches the surface on.
//   GET  /api/mcp/pair/status    -> hands back the bearer token
//   POST /mcp                    -> ask_lore against the entire campaign
//
// Both origin checks in authorise() are `if (origin && ...)`, so an empty
// bound origin skips them. No browser is involved at any step, which is why
// every existing origin-based assertion stayed green.
//
// The peer address is the right check for the reason the rest of the codebase
// already uses it: headers are attacker-controlled and it is not.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";

const state = vi.hoisted(() => ({
  settings: {
    surfaces: {
      discord: { enabled: true },
      foundry: { enabled: false, allowPlayers: false },
      mcp: { enabled: false },
    },
  } as Record<string, unknown>,
}));

vi.mock("../config/settings", () => ({
  getSettings: () => state.settings,
  saveSettings: (s: unknown) => {
    state.settings = s as Record<string, unknown>;
  },
}));

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-mcp-gate-"));
process.env.TUSKS_VAULT_CONFIG_DIR = configDir;

const { hostOriginGuard } = await import("../util/host-origin-guard");
const { mcpApiRouter, _resetRateLimitForTests } = await import("./mcp");
const { _resetPairingForTests } = await import("../mcp/pairing");
const { revokeAllClients, listClients } = await import("../mcp/auth");

/** Pretend every request arrives from a LAN device rather than the host.
 *  `remoteAddress` is a prototype getter on the real socket, so it is shadowed
 *  with an own property — which is exactly what the middleware reads. */
const LAN_PEER = "192.168.1.50";
function fakeLanPeer(req: express.Request, _res: express.Response, next: express.NextFunction) {
  Object.defineProperty(req.socket, "remoteAddress", {
    value: LAN_PEER,
    configurable: true,
  });
  next();
}

const app = express();
app.use(fakeLanPeer);
// Mirrors src/server/index.ts. Under HOST=0.0.0.0 `bindHost` is not loopback,
// so the guard's Host check does not fire — which is the configuration this
// whole file is about.
app.use(
  hostOriginGuard({
    bindHost: "0.0.0.0",
    crossOriginPaths: ["/mcp", "/api/mcp/pair/request", "/api/mcp/pair/status"],
  })
);
app.use(mcpApiRouter);

const server = http.createServer(app);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

afterAll(() => {
  server.close();
  fs.rmSync(configDir, { recursive: true, force: true });
});

beforeEach(() => {
  _resetPairingForTests?.();
  _resetRateLimitForTests?.();
  revokeAllClients();
  state.settings = {
    surfaces: {
      discord: { enabled: true },
      foundry: { enabled: false, allowPlayers: false },
      mcp: { enabled: false },
    },
  };
});

/** No Origin, no Referer — the shape that previously met no check at all. */
const headerless = { "content-type": "application/json" };

describe("the MCP dashboard half refuses a non-loopback peer", () => {
  it("blocks the whole self-pairing chain at the approve step", async () => {
    // Step 1 must still succeed: a GM's Foundry page is not on loopback, so
    // requesting a pairing from off-host is legitimate and stays open.
    const requested = await fetch(`${base}/api/mcp/pair/request`, {
      method: "POST",
      headers: headerless,
      body: JSON.stringify({ surface: "mcp", clientName: "LAN device" }),
    });
    expect(requested.status).toBe(200);
    const { requestId } = await requested.json();
    expect(requestId).toBeTruthy();

    // Step 2 is where it has to stop. This is the assertion the whole file
    // exists for.
    const approve = await fetch(`${base}/api/mcp/pair/approve`, {
      method: "POST",
      headers: headerless,
      body: JSON.stringify({ requestId }),
    });
    expect(approve.status).toBe(403);

    // No credential was minted, and the surface was NOT switched on — approving
    // is what enables it, so a refused approval must leave it off.
    expect(listClients()).toHaveLength(0);
    expect((state.settings.surfaces as Record<string, { enabled: boolean }>).mcp.enabled).toBe(
      false
    );

    // And the token never becomes readable.
    const status = await fetch(`${base}/api/mcp/pair/status?requestId=${requestId}`);
    expect(status.status).toBe(200);
    expect((await status.json()).token).toBeUndefined();
  });

  it.each([
    ["GET", "/api/mcp/pair/pending"],
    ["POST", "/api/mcp/pair/deny"],
    ["POST", "/api/mcp/pair/clear-denials"],
    ["GET", "/api/mcp/clients"],
    ["POST", "/api/mcp/clients/revoke-all"],
  ])("refuses %s %s", async (method, route) => {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: headerless,
      ...(method === "POST" ? { body: JSON.stringify({}) } : {}),
    });
    expect(res.status).toBe(403);
  });

  it("refuses DELETE on a specific client, not just the collection", async () => {
    const res = await fetch(`${base}/api/mcp/clients/some-id`, {
      method: "DELETE",
      headers: headerless,
    });
    expect(res.status).toBe(403);
  });

  it("leaves the four pre-trust routes reachable, or Foundry cannot pair at all", async () => {
    // These MUST stay open to a non-loopback peer. If a future change gates the
    // whole router, this fails and says why.
    const hello = await fetch(`${base}/api/mcp/hello`);
    expect(hello.status).toBe(200);

    const requested = await fetch(`${base}/api/mcp/pair/request`, {
      method: "POST",
      headers: headerless,
      body: JSON.stringify({ surface: "foundry", clientName: "Foundry" }),
    });
    expect(requested.status).toBe(200);

    const { requestId } = await requested.json();
    const status = await fetch(`${base}/api/mcp/pair/status?requestId=${requestId}`);
    expect(status.status).toBe(200);
  });
});
