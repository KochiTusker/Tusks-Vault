// The MCP endpoint, driven over real HTTP.
//
// Foundry cannot run in CI, so anything not covered here is untested forever.
// That makes this suite the whole safety net for a pre-auth surface, and it is
// written against a listening socket rather than mocked req/res objects on
// purpose: the things most likely to break — the guard's delegated-path list,
// CORS headers, status codes, header casing — only exist once a real HTTP stack
// is involved.

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
      foundry: { enabled: true, allowPlayers: false },
      mcp: { enabled: true },
    },
  } as Record<string, unknown>,
  askImpl: null as unknown,
}));

vi.mock("../config/settings", () => ({
  getSettings: () => state.settings,
  // Approval switches the paired surface on, so the route writes settings. The
  // mock mutates the same object getSettings hands out, which is what the real
  // pair does — a no-op stub would make the assertion below pass for the wrong
  // reason.
  saveSettings: (s: unknown) => {
    state.settings = s as Record<string, unknown>;
  },
}));

vi.mock("../chat/ask", () => ({
  ask: (q: unknown) => (state.askImpl as (q: unknown) => unknown)(q),
}));

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-mcp-"));
process.env.TUSKS_VAULT_CONFIG_DIR = configDir;

const { hostOriginGuard } = await import("../util/host-origin-guard");
const { mcpApiRouter, _resetRateLimitForTests } = await import("../routes/mcp");
const { mcpRouter, _resetSessionsForTests, LATEST_PROTOCOL_VERSION } = await import("./server");
const { _resetPairingForTests } = await import("./pairing");
const { revokeAllClients, listClients } = await import("./auth");

const FOUNDRY_ORIGIN = "http://localhost:30000";

const app = express();
// Mirrors src/server/index.ts exactly. The delegated-path list is part of what
// is under test: get it wrong and the Foundry module cannot reach Vault at all.
app.use(
  hostOriginGuard({
    bindHost: "127.0.0.1",
    crossOriginPaths: ["/mcp", "/api/mcp/pair/request", "/api/mcp/pair/status"],
  })
);
app.use(mcpApiRouter);
app.use(mcpRouter);

const server = http.createServer(app);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(configDir, { recursive: true, force: true });
});

beforeEach(() => {
  _resetPairingForTests();
  _resetSessionsForTests();
  _resetRateLimitForTests();
  revokeAllClients();
  state.settings = {
    surfaces: {
      discord: { enabled: true },
      foundry: { enabled: true, allowPlayers: false },
      mcp: { enabled: true },
    },
  };
  state.askImpl = async () => ({
    answered: true,
    text: "The strongbox holds a signet ring. [Session-04.md]",
    modelUsed: "test-model",
  });
});

/** Run the pairing handshake and return the bearer token, the way the Foundry
 *  module does it. */
async function pair(opts: { origin?: string; surface?: string } = {}): Promise<string> {
  const origin = opts.origin ?? FOUNDRY_ORIGIN;
  const requested = await fetch(`${base}/api/mcp/pair/request`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      surface: opts.surface ?? "foundry",
      clientName: "Tusk's Vault (Foundry)",
      worldTitle: "Test World",
      foundryVersion: "14.365",
    }),
  });
  const { requestId, code } = await requested.json();
  expect(code).toMatch(/^\d{6}$/);

  const approved = await fetch(`${base}/api/mcp/pair/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId }),
  });
  expect(approved.status).toBe(200);

  const status = await fetch(`${base}/api/mcp/pair/status?requestId=${requestId}`, {
    headers: { origin },
  });
  const { token } = await status.json();
  expect(typeof token).toBe("string");
  return token;
}

interface RpcOpts {
  token?: string;
  origin?: string;
  sessionId?: string;
  protocolVersion?: string;
}

async function rpc(body: unknown, opts: RpcOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`;
  if (opts.origin !== undefined) headers.origin = opts.origin;
  if (opts.sessionId !== undefined) headers["mcp-session-id"] = opts.sessionId;
  if (opts.protocolVersion !== undefined) headers["mcp-protocol-version"] = opts.protocolVersion;
  return fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "t", version: "1" } },
};

/** Pair, initialize, and return everything needed to make further calls.
 *  `origin: ""` models a non-browser client — the stdio shim, an agent on this
 *  machine — which sends no Origin and whose token is therefore not bound to
 *  one. */
async function connect(opts: { surface?: string; origin?: string } = {}) {
  const origin = opts.origin ?? FOUNDRY_ORIGIN;
  const token = await pair({ surface: opts.surface, origin });
  const res = await rpc(INITIALIZE, { token, origin });
  expect(res.status).toBe(200);
  const sessionId = res.headers.get("mcp-session-id")!;
  expect(sessionId).toBeTruthy();
  return { token, sessionId, origin };
}

describe("discovery", () => {
  it("answers the hello probe without a token", async () => {
    const res = await fetch(`${base}/api/mcp/hello`, { headers: { origin: FOUNDRY_ORIGIN } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.app).toBe("tusks-vault");
    expect(body.protocolVersions).toContain(LATEST_PROTOCOL_VERSION);
    expect(body.pairing).toBe("open");
  });

  it("reveals nothing about the campaign or the install's configuration", async () => {
    const res = await fetch(`${base}/api/mcp/hello`);
    const body = await res.json();
    // The probe answers before any trust exists, so its payload is a contract:
    // "Vault is running here", and not one field more.
    expect(Object.keys(body).sort()).toEqual(["app", "pairing", "protocolVersions", "version"]);
  });
});

describe("pairing", () => {
  it("mints a token only after the dashboard approves", async () => {
    const requested = await fetch(`${base}/api/mcp/pair/request`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: FOUNDRY_ORIGIN },
      body: JSON.stringify({ surface: "foundry", clientName: "Foundry" }),
    });
    const { requestId } = await requested.json();

    // Before approval there is no token, however often the client asks.
    const early = await (await fetch(`${base}/api/mcp/pair/status?requestId=${requestId}`)).json();
    expect(early.status).toBe("pending");
    expect(early.token).toBeUndefined();

    await fetch(`${base}/api/mcp/pair/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId }),
    });

    const after = await (await fetch(`${base}/api/mcp/pair/status?requestId=${requestId}`)).json();
    expect(after.status).toBe("approved");
    expect(after.token).toBeTruthy();
  });

  // Regression: the Foundry surface ships OFF, and the module proves its
  // credential the instant pairing completes. Without this, EVERY first pairing
  // succeeded and then reported "paired, but the first call failed" — the one
  // confusing step in an otherwise clean setup.
  it("switches the approved surface on, so the module's verify call succeeds", async () => {
    const surfaces = state.settings.surfaces as Record<string, { enabled: boolean }>;
    surfaces.foundry.enabled = false;

    const requested = await fetch(`${base}/api/mcp/pair/request`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: FOUNDRY_ORIGIN },
      body: JSON.stringify({ surface: "foundry", clientName: "Foundry" }),
    });
    const { requestId } = await requested.json();

    const approved = await fetch(`${base}/api/mcp/pair/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId }),
    });
    expect(await approved.json()).toMatchObject({ ok: true, surfaceEnabled: "foundry" });

    // The surface the GM approved is on; the ones they did not are untouched.
    expect((state.settings.surfaces as Record<string, { enabled: boolean }>).foundry.enabled).toBe(true);

    // And the credential actually works now — the assertion that would have
    // caught the original bug, because it is the call the module makes next.
    const { token } = await (
      await fetch(`${base}/api/mcp/pair/status?requestId=${requestId}`)
    ).json();
    const init = await rpc(INITIALIZE, { token, origin: FOUNDRY_ORIGIN });
    expect(init.status).toBe(200);
  });

  it("never switches a surface the GM did not approve", async () => {
    const surfaces = state.settings.surfaces as Record<string, { enabled: boolean }>;
    surfaces.foundry.enabled = false;
    surfaces.mcp.enabled = false;

    const requested = await fetch(`${base}/api/mcp/pair/request`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: FOUNDRY_ORIGIN },
      body: JSON.stringify({ surface: "mcp", clientName: "Claude Desktop" }),
    });
    const { requestId } = await requested.json();
    await fetch(`${base}/api/mcp/pair/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId }),
    });

    expect((state.settings.surfaces as Record<string, { enabled: boolean }>).mcp.enabled).toBe(true);
    expect((state.settings.surfaces as Record<string, { enabled: boolean }>).foundry.enabled).toBe(false);
  });

  it("hands the token over exactly once", async () => {
    const token = await pair();
    const requestId = (await (await fetch(`${base}/api/mcp/pair/pending`)).json()).pending;
    expect(requestId).toBeNull();
    // A second poller is by definition not the client that asked.
    const clients = listClients();
    expect(clients).toHaveLength(1);
    expect(clients[0].tokenHash).not.toContain(token);
  });

  it("shows the dashboard the same code it gave the client", async () => {
    const requested = await fetch(`${base}/api/mcp/pair/request`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: FOUNDRY_ORIGIN },
      body: JSON.stringify({ surface: "foundry", clientName: "Foundry" }),
    });
    const { code } = await requested.json();
    const { pending } = await (await fetch(`${base}/api/mcp/pair/pending`)).json();
    // If these ever diverge, the user cannot tell which request they approve.
    expect(pending.code).toBe(code);
    expect(pending.origin).toBe(FOUNDRY_ORIGIN);
  });

  it("refuses a second request while one is outstanding", async () => {
    await fetch(`${base}/api/mcp/pair/request`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: FOUNDRY_ORIGIN },
      body: JSON.stringify({ clientName: "First" }),
    });
    const second = await fetch(`${base}/api/mcp/pair/request`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify({ clientName: "Second" }),
    });
    expect(second.status).toBe(409);
    expect((await second.json()).reason).toBe("busy");
  });

  it("remembers a denial so a page cannot re-prompt", async () => {
    const first = await fetch(`${base}/api/mcp/pair/request`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify({ clientName: "Nuisance" }),
    });
    const { requestId } = await first.json();
    await fetch(`${base}/api/mcp/pair/deny`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId }),
    });

    const retry = await fetch(`${base}/api/mcp/pair/request`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify({ clientName: "Nuisance" }),
    });
    expect(retry.status).toBe(409);
    expect((await retry.json()).reason).toBe("denied");
  });

  it("refuses approval from a stale dashboard tab", async () => {
    const res = await fetch(`${base}/api/mcp/pair/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(409);
  });

  it("keeps the approval route same-origin — a page cannot approve itself", async () => {
    const requested = await fetch(`${base}/api/mcp/pair/request`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify({ clientName: "Self-service" }),
    });
    const { requestId } = await requested.json();

    // The delegated-path list covers /pair/request but NOT /pair/approve, so
    // the global guard refuses this outright. This is the single most important
    // assertion in the file.
    const approve = await fetch(`${base}/api/mcp/pair/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify({ requestId }),
    });
    expect(approve.status).toBe(403);
    expect(listClients()).toHaveLength(0);
  });
});

describe("authentication", () => {
  it("refuses a call with no token", async () => {
    // Pair first, so the origin gate is satisfied and the missing token is the
    // only thing left to refuse on.
    await pair();
    const res = await rpc(INITIALIZE, { origin: FOUNDRY_ORIGIN });
    expect(res.status).toBe(401);
  });

  it("refuses an unpaired origin before it ever looks at a token", async () => {
    const res = await rpc(INITIALIZE, { origin: FOUNDRY_ORIGIN });
    expect(res.status).toBe(403);
  });

  it("refuses a call with the wrong token", async () => {
    await pair();
    const res = await rpc(INITIALIZE, { token: "not-the-token", origin: FOUNDRY_ORIGIN });
    expect(res.status).toBe(401);
  });

  it("gives the same answer for an absent and a wrong token", async () => {
    await pair();
    const absent = await rpc(INITIALIZE, { origin: FOUNDRY_ORIGIN });
    const wrong = await rpc(INITIALIZE, { token: "nope", origin: FOUNDRY_ORIGIN });
    expect(absent.status).toBe(wrong.status);
    expect(await absent.json()).toEqual(await wrong.json());
  });

  it("never echoes the token back in an error", async () => {
    const token = await pair();
    const res = await rpc(INITIALIZE, { token: `${token}x`, origin: FOUNDRY_ORIGIN });
    expect(JSON.stringify(await res.json())).not.toContain(token);
  });

  it("refuses an origin that never paired", async () => {
    const token = await pair();
    const res = await rpc(INITIALIZE, { token, origin: "http://evil.example" });
    expect(res.status).toBe(403);
  });

  it("refuses a valid token presented from a different paired origin", async () => {
    const token = await pair({ origin: FOUNDRY_ORIGIN });
    _resetPairingForTests();
    await pair({ origin: "http://localhost:40000" });
    // The second origin is now paired, so the origin allow-list alone would let
    // this through. The token's own binding is what stops it.
    const res = await rpc(INITIALIZE, { token, origin: "http://localhost:40000" });
    expect(res.status).toBe(403);
  });

  it("allows a non-browser client that sends no Origin", async () => {
    const token = await pair({ origin: "", surface: "mcp" });
    const res = await rpc(INITIALIZE, { token });
    expect(res.status).toBe(200);
  });

  it("stops working the instant the client is revoked", async () => {
    const { token, sessionId } = await connect();
    const [client] = listClients();

    // A second client on the SAME origin, so revoking the first does not also
    // un-pair the origin. Without it the origin gate refuses first and this
    // test would pass without the token check doing anything.
    _resetPairingForTests();
    await pair();

    const before = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { token, origin: FOUNDRY_ORIGIN, sessionId });
    expect(before.status).toBe(200);

    const deleted = await fetch(`${base}/api/mcp/clients/${client.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);

    const after = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { token, origin: FOUNDRY_ORIGIN, sessionId });
    expect(after.status).toBe(401);
  });

  it("refuses when the surface is switched off", async () => {
    const token = await pair();
    (state.settings.surfaces as Record<string, { enabled: boolean }>).foundry.enabled = false;
    const res = await rpc(INITIALIZE, { token, origin: FOUNDRY_ORIGIN });
    expect(res.status).toBe(403);
  });

  it("does not let an mcp client inherit the foundry surface", async () => {
    // Surface is bound at pairing, so a token minted as `mcp` is governed by the
    // mcp toggle no matter what a later request claims.
    const token = await pair({ surface: "mcp" });
    (state.settings.surfaces as Record<string, { enabled: boolean }>).mcp.enabled = false;
    const res = await rpc(INITIALIZE, { token, origin: FOUNDRY_ORIGIN });
    expect(res.status).toBe(403);
  });
});

describe("protocol", () => {
  it("completes the initialize handshake and issues a session id", async () => {
    const token = await pair();
    const res = await rpc(INITIALIZE, { token, origin: FOUNDRY_ORIGIN });
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
    const body = await res.json();
    expect(body.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    expect(body.result.serverInfo.name).toBe("tusks-vault");
  });

  it("requires a session id after initialize", async () => {
    const token = await pair();
    await rpc(INITIALIZE, { token, origin: FOUNDRY_ORIGIN });
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { token, origin: FOUNDRY_ORIGIN });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown session id", async () => {
    const { token } = await connect();
    const res = await rpc(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { token, origin: FOUNDRY_ORIGIN, sessionId: "made-up" }
    );
    expect(res.status).toBe(404);
  });

  it("rejects a protocol version it does not speak", async () => {
    const { token, sessionId } = await connect();
    const res = await rpc(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { token, origin: FOUNDRY_ORIGIN, sessionId, protocolVersion: "1999-01-01" }
    );
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON-RPC", async () => {
    const { token, sessionId } = await connect();
    const res = await rpc({ id: 2, method: "tools/list" }, { token, origin: FOUNDRY_ORIGIN, sessionId });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32600);
  });

  it("rejects a batched request", async () => {
    const { token, sessionId } = await connect();
    const res = await rpc([INITIALIZE], { token, origin: FOUNDRY_ORIGIN, sessionId });
    expect(res.status).toBe(400);
  });

  it("answers a notification with 202 and no body", async () => {
    const { token, sessionId } = await connect();
    const res = await rpc(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { token, origin: FOUNDRY_ORIGIN, sessionId }
    );
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("returns method-not-found for an unknown method", async () => {
    const { token, sessionId } = await connect();
    const res = await rpc(
      { jsonrpc: "2.0", id: 9, method: "resources/list" },
      { token, origin: FOUNDRY_ORIGIN, sessionId }
    );
    expect((await res.json()).error.code).toBe(-32601);
  });

  it("answers GET with 405 rather than an empty stream", async () => {
    const res = await fetch(`${base}/mcp`, { headers: { origin: FOUNDRY_ORIGIN } });
    expect(res.status).toBe(405);
  });

  it("sends CORS headers only to a paired origin", async () => {
    await pair();
    const allowed = await fetch(`${base}/mcp`, { method: "OPTIONS", headers: { origin: FOUNDRY_ORIGIN } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(FOUNDRY_ORIGIN);
    expect(allowed.headers.get("access-control-expose-headers")).toContain("Mcp-Session-Id");

    const refused = await fetch(`${base}/mcp`, { method: "OPTIONS", headers: { origin: "http://evil.example" } });
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("tools", () => {
  it("lists exactly the three lore tools", async () => {
    const { token, sessionId } = await connect();
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { token, origin: FOUNDRY_ORIGIN, sessionId });
    const names = (await res.json()).result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["ask_lore", "list_sources", "search_lore"]);
  });

  it("round-trips ask_lore", async () => {
    const { token, sessionId } = await connect();
    const res = await rpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "ask_lore",
          arguments: {
            question: "What is in the strongbox?",
            asker: { id: "u1", displayName: "GM", isGM: true },
          },
        },
      },
      { token, origin: FOUNDRY_ORIGIN, sessionId }
    );
    const body = await res.json();
    expect(body.result.content[0].text).toContain("signet ring");
    expect(body.result.isError).toBeFalsy();
    expect(body.result._meta["tusks-vault"].modelUsed).toBe("test-model");
  });

  it("passes the credential's surface to ask(), not one from the payload", async () => {
    let seen: { surface?: string } = {};
    state.askImpl = async (q: { surface: string }) => {
      seen = q;
      return { answered: true, text: "ok", modelUsed: "m" };
    };
    const { token, sessionId } = await connect({ surface: "mcp", origin: "" });
    await rpc(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "ask_lore", arguments: { question: "hi", surface: "foundry" } },
      },
      { token, sessionId }
    );
    expect(seen.surface).toBe("mcp");
  });

  it("refuses a player question until the install opts in", async () => {
    const { token, sessionId } = await connect();
    const call = {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "ask_lore",
        arguments: { question: "What is in the strongbox?", asker: { id: "p1", displayName: "Player", isGM: false } },
      },
    };

    const blocked = await rpc(call, { token, origin: FOUNDRY_ORIGIN, sessionId });
    expect((await blocked.json()).result.content[0].text).toContain("answers only the GM");

    (state.settings.surfaces as Record<string, { allowPlayers?: boolean }>).foundry.allowPlayers = true;
    const allowed = await rpc(call, { token, origin: FOUNDRY_ORIGIN, sessionId });
    expect((await allowed.json()).result.content[0].text).toContain("signet ring");
  });

  it("treats an absent isGM as not-a-GM", async () => {
    const { token, sessionId } = await connect();
    const res = await rpc(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "ask_lore", arguments: { question: "q", asker: { id: "x", displayName: "X" } } },
      },
      { token, origin: FOUNDRY_ORIGIN, sessionId }
    );
    expect((await res.json()).result.content[0].text).toContain("answers only the GM");
  });

  it("does not apply the Foundry player ceiling to an mcp client", async () => {
    const { token, sessionId } = await connect({ surface: "mcp", origin: "" });
    const res = await rpc(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "ask_lore", arguments: { question: "q" } },
      },
      { token, sessionId }
    );
    expect((await res.json()).result.content[0].text).toContain("signet ring");
  });

  it("reports a thrown tool as isError rather than a protocol failure", async () => {
    state.askImpl = async () => {
      throw new Error("provider key rejected");
    };
    const { token, sessionId } = await connect();
    const res = await rpc(
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "ask_lore", arguments: { question: "q", asker: { id: "u", displayName: "GM", isGM: true } } },
      },
      { token, origin: FOUNDRY_ORIGIN, sessionId }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.isError).toBe(true);
    // The SHAPE is the contract the module depends on — isError plus a string
    // in content[0].text — and it is unchanged. What the string says is not:
    // the module prints it into the Foundry chat log, which every connected
    // player reads, so the provider's own words must not survive the trip.
    expect(typeof body.result.content[0].text).toBe("string");
    expect(body.result.content[0].text).not.toContain("provider key rejected");
    expect(body.result.content[0].text.length).toBeGreaterThan(10);
  });

  it("rejects an unknown tool", async () => {
    const { token, sessionId } = await connect();
    const res = await rpc(
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "delete_everything" } },
      { token, origin: FOUNDRY_ORIGIN, sessionId }
    );
    expect((await res.json()).error.code).toBe(-32601);
  });
});
