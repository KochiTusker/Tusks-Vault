// The wire contract between this repo and the Foundry module.
//
// The module lives in its own repository now (`Tusks-Vault-Foundry`), so nothing in
// this repo compiles, imports or tests it. That is a deliberate split — see
// docs/tooling/foundry-contract.md for why — but it removes the one mechanism that used
// to keep the two ends honest: a change here that broke the module used to fail
// this repo's suite, and now it cannot.
//
// This file is the replacement. Every assertion below corresponds to a line in
// the module that would break if the assertion stopped holding, and the module
// repo carries a mirror suite asserting it SENDS what these tests accept. The
// pair is the contract; docs/tooling/foundry-contract.md is its prose.
//
// The rule that makes it work: **a change to anything asserted here is a change
// to both repositories.** If an assertion below has to be edited to make a
// change land, the module needs a matching change and a version bump, and this
// file is where you find out — not a GM whose chat command stopped working.
//
// Driven over real HTTP for the same reason as server.test.ts: the parts most
// likely to break are header casing, CORS exposure and status codes, none of
// which exist until a socket does.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";

/** What the module declares as its `PROTOCOL_VERSION`. It refuses to pair when
 *  Vault does not advertise this exact string. */
const MODULE_PROTOCOL_VERSION = "2025-06-18";

/** The origin a Foundry page has: a DIFFERENT PORT on the same machine, which
 *  is the common local setup (Foundry serves on :30000, Vault on :3000).
 *
 *  Note what this is not. `localhost:30000` is still a loopback HOSTNAME, so
 *  the host/origin guard treats it as same-machine and permits writes from it —
 *  including /pair/approve. The genuinely cross-origin case is a hosted Foundry
 *  on a real domain, and the assertion that a page cannot approve its own
 *  pairing uses `http://evil.example` for exactly that reason. Do not "simplify"
 *  the two into one constant: they exercise opposite sides of the guard. */
const FOUNDRY_ORIGIN = "http://localhost:30000";

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  askImpl: null as unknown,
}));

vi.mock("../config/settings", () => ({ getSettings: () => state.settings }));
vi.mock("../chat/ask", () => ({
  ask: (q: unknown) => (state.askImpl as (q: unknown) => unknown)(q),
}));

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-contract-"));
process.env.TUSKS_VAULT_CONFIG_DIR = configDir;

const { hostOriginGuard } = await import("../util/host-origin-guard");
const { mcpApiRouter, _resetRateLimitForTests } = await import("../routes/mcp");
const { mcpRouter, _resetSessionsForTests, SUPPORTED_PROTOCOL_VERSIONS } = await import("./server");
const { _resetPairingForTests } = await import("./pairing");
const { revokeAllClients } = await import("./auth");

const app = express();
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
      foundry: { enabled: true, allowPlayers: true },
      mcp: { enabled: false },
    },
  };
  state.askImpl = async () => ({ answered: true, text: "An answer.", modelUsed: "test-model" });
});

/** The handshake, performed exactly as the module performs it. */
async function pair(): Promise<string> {
  const requested = await fetch(`${base}/api/mcp/pair/request`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: FOUNDRY_ORIGIN },
    // Verbatim from the module's runPairing().
    body: JSON.stringify({
      surface: "foundry",
      clientName: "Foundry VTT",
      worldTitle: "A World",
      foundryVersion: "14.365",
    }),
  });
  const { requestId } = await requested.json();
  await fetch(`${base}/api/mcp/pair/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId }),
  });
  const status = await fetch(`${base}/api/mcp/pair/status?requestId=${requestId}`, {
    headers: { origin: FOUNDRY_ORIGIN },
  });
  return (await status.json()).token;
}

async function rpc(body: unknown, opts: { token?: string; sessionId?: string } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: FOUNDRY_ORIGIN,
    // The module sends this on every request.
    "mcp-protocol-version": MODULE_PROTOCOL_VERSION,
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.sessionId) headers["mcp-session-id"] = opts.sessionId;
  return fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
}

async function connect() {
  const token = await pair();
  const res = await rpc(
    {
      jsonrpc: "2.0",
      id: "rid",
      method: "initialize",
      params: {
        protocolVersion: MODULE_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "foundry-vtt", version: "14.365" },
      },
    },
    { token }
  );
  return { token, sessionId: res.headers.get("Mcp-Session-Id")!, res };
}

describe("discovery — what the module probes 20 ports for", () => {
  it("identifies itself with the exact string the module matches on", async () => {
    // The module discards any port whose reply is not `app === "tusks-vault"`.
    // Rename this and discovery finds nothing, on every install, silently.
    const body = await (await fetch(`${base}/api/mcp/hello`)).json();
    expect(body.app).toBe("tusks-vault");
  });

  it("advertises the protocol revision the module speaks", async () => {
    // The module refuses to pair unless this exact string is present, and says
    // "update Tusk's Vault". Dropping it is a breaking change for every install.
    const body = await (await fetch(`${base}/api/mcp/hello`)).json();
    expect(body.protocolVersions).toContain(MODULE_PROTOCOL_VERSION);
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(MODULE_PROTOCOL_VERSION);
  });

  it("answers a plain cross-origin GET, with no preflight to satisfy", async () => {
    // The module probes with a bare fetch and no custom headers, precisely so
    // this stays a simple request. Requiring a header here would turn every
    // probe into a preflight and break discovery on hosted Foundry.
    const res = await fetch(`${base}/api/mcp/hello`, { headers: { origin: FOUNDRY_ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(FOUNDRY_ORIGIN);
  });

  it("says whether a prompt is already waiting, so the module can explain itself", async () => {
    const body = await (await fetch(`${base}/api/mcp/hello`)).json();
    expect(["open", "busy"]).toContain(body.pairing);
  });
});

describe("pairing — the fields the module sends and reads", () => {
  it("accepts the module's request body and returns a displayable code", async () => {
    const res = await fetch(`${base}/api/mcp/pair/request`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: FOUNDRY_ORIGIN },
      body: JSON.stringify({
        surface: "foundry",
        clientName: "Foundry VTT",
        worldTitle: "A World",
        foundryVersion: "14.365",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.requestId).toBe("string");
    // Six digits, because the human compares it with what Foundry displays.
    expect(body.code).toMatch(/^\d{6}$/);
  });

  it("reports a status the module knows how to act on", async () => {
    // The module treats exactly these as terminal; anything else it keeps
    // polling, so a new status string would hang the pairing dialog until the
    // deadline rather than reporting anything.
    const requested = await fetch(`${base}/api/mcp/pair/request`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: FOUNDRY_ORIGIN },
      body: JSON.stringify({ surface: "foundry", clientName: "Foundry VTT" }),
    });
    const { requestId } = await requested.json();
    const status = await (
      await fetch(`${base}/api/mcp/pair/status?requestId=${requestId}`, {
        headers: { origin: FOUNDRY_ORIGIN },
      })
    ).json();
    expect(["pending", "approved", "denied", "expired", "unknown"]).toContain(status.status);
  });

  it("hands the token over exactly once, to the poller", async () => {
    const token = await pair();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
  });

  it("refuses approval from a remote origin", async () => {
    // The module never calls approve — the dashboard does. Approve is kept off
    // the guard's delegated-path list precisely so a page cannot both raise a
    // pairing prompt and grant it.
    //
    // NOTE the limit of what this proves. The guard's rule is "loopback origins
    // may write", and `localhost` on ANY port is loopback — so a page served
    // from another local port, Foundry's own :30000 included, is NOT refused
    // here. Reaching that position needs code already running on the machine
    // (a hostile Foundry module, say), which is a real vector but a different
    // one. See docs/tooling/foundry-contract.md; tightening this to a true same-origin
    // check is tracked there, not silently assumed.
    const requested = await fetch(`${base}/api/mcp/pair/request`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: FOUNDRY_ORIGIN },
      body: JSON.stringify({ surface: "foundry", clientName: "Foundry VTT" }),
    });
    const { requestId } = await requested.json();
    const approved = await fetch(`${base}/api/mcp/pair/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ requestId }),
    });
    expect(approved.status).toBe(403);
  });
});

describe("the session — what the module reads off initialize", () => {
  it("returns a session id in a header the browser is allowed to read", async () => {
    // Cross-origin, a header is invisible to script unless it is named in
    // Access-Control-Expose-Headers. Without that the module sees `null`,
    // throws "Vault did not issue a session", and never asks anything.
    const { res, sessionId } = await connect();
    expect(sessionId).toBeTruthy();
    expect(res.headers.get("access-control-expose-headers")).toContain("Mcp-Session-Id");
  });

  it("accepts the headers the module sends on every call", async () => {
    const { token } = await connect();
    const res = await rpc({ jsonrpc: "2.0", id: "p", method: "ping" }, { token });
    // A preflight has to allow them too, or the browser never sends the request.
    const preflight = await fetch(`${base}/mcp`, {
      method: "OPTIONS",
      headers: {
        origin: FOUNDRY_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,authorization,mcp-protocol-version",
      },
    });
    const allowed = (preflight.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    for (const header of ["content-type", "authorization", "mcp-session-id", "mcp-protocol-version"]) {
      expect(allowed).toContain(header);
    }
    expect(res.status).toBeLessThan(500);
  });

  it("answers 404 for a lapsed session, which is the module's retry signal", async () => {
    // The module re-initializes exactly once on a 404 and retries, so a Vault
    // restart mid-session is invisible to the table. Any other status turns
    // that into a visible failure.
    const { token } = await connect();
    _resetSessionsForTests();
    const res = await rpc(
      { jsonrpc: "2.0", id: "t", method: "tools/call", params: { name: "ask_lore", arguments: { question: "x" } } },
      { token, sessionId: "00000000-0000-0000-0000-000000000000" }
    );
    expect(res.status).toBe(404);
  });
});

describe("ask_lore — the shape the module sends and renders", () => {
  it("offers exactly the three tools, under the names the module calls", async () => {
    const { token, sessionId } = await connect();
    const res = await rpc({ jsonrpc: "2.0", id: "l", method: "tools/list" }, { token, sessionId });
    const names = (await res.json()).result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(["ask_lore", "search_lore", "list_sources"]);
  });

  it("accepts the asker object the module builds from the chat document", async () => {
    let seen: Record<string, unknown> | null = null;
    state.askImpl = async (q: Record<string, unknown>) => {
      seen = q.asker as Record<string, unknown>;
      return { answered: true, text: "An answer.", modelUsed: "m" };
    };
    const { token, sessionId } = await connect();
    await rpc(
      {
        jsonrpc: "2.0",
        id: "a",
        method: "tools/call",
        params: {
          name: "ask_lore",
          // Verbatim from the module's createChatMessage relay.
          arguments: {
            question: "who runs the harbour?",
            asker: { id: "p1", displayName: "A Player", isGM: false },
          },
        },
      },
      { token, sessionId }
    );
    expect(seen).toMatchObject({ id: "p1", displayName: "A Player", isGM: false });
  });

  it("returns text where the module looks for it", async () => {
    // The module does result.content.map(part => part.text).join("\n").
    const { token, sessionId } = await connect();
    const res = await rpc(
      {
        jsonrpc: "2.0",
        id: "a",
        method: "tools/call",
        params: { name: "ask_lore", arguments: { question: "who runs the harbour?" } },
      },
      { token, sessionId }
    );
    const result = (await res.json()).result;
    expect(Array.isArray(result.content)).toBe(true);
    expect(typeof result.content[0].text).toBe("string");
  });

  it("carries the meta flags the module turns into CSS classes", async () => {
    // `is-declined` and `is-gap` style the answer differently. They are read
    // from _meta["tusks-vault"]; renaming either silently drops the styling.
    state.askImpl = async () => ({
      answered: true,
      text: "I do not know.",
      modelUsed: "m",
      declined: true,
      loreGapRecorded: true,
    });
    const { token, sessionId } = await connect();
    const res = await rpc(
      {
        jsonrpc: "2.0",
        id: "a",
        method: "tools/call",
        params: { name: "ask_lore", arguments: { question: "unknown thing?" } },
      },
      { token, sessionId }
    );
    const meta = (await res.json()).result._meta["tusks-vault"];
    expect(meta.declined).toBe(true);
    expect(meta.loreGapRecorded).toBe(true);
  });

  it("reports a refusal as prose, not as a broken tool", async () => {
    // The player ceiling refusal IS the answer. isError would make the module
    // style it as a failure and tell the GM something broke.
    state.settings = {
      surfaces: { foundry: { enabled: true, allowPlayers: false }, discord: {}, mcp: {} },
    };
    const { token, sessionId } = await connect();
    const res = await rpc(
      {
        jsonrpc: "2.0",
        id: "a",
        method: "tools/call",
        params: {
          name: "ask_lore",
          arguments: { question: "secrets?", asker: { id: "p1", displayName: "P", isGM: false } },
        },
      },
      { token, sessionId }
    );
    const result = (await res.json()).result;
    expect(result.isError).toBeFalsy();
    expect(result._meta["tusks-vault"].refusedBy).toBe("allowPlayers");
  });

  // The ceiling is a property of the CREDENTIAL and its surface, so it has to
  // hold on every tool that credential can reach. It used to sit only in
  // ask_lore, which left two doors around it: search_lore returns matching DM
  // clarifications — the GM's own written answers to lore gaps, which is
  // exactly what allowPlayers:false withholds — and list_sources returns the
  // document list. Neither takes an `asker`, so neither has a GM claim to
  // exempt and the ceiling decides alone.
  it.each(["search_lore", "list_sources"])(
    "applies the same ceiling to %s, which carries no asker to exempt",
    async (name) => {
      state.settings = {
        surfaces: { foundry: { enabled: true, allowPlayers: false }, discord: {}, mcp: {} },
      };
      const { token, sessionId } = await connect();
      const res = await rpc(
        {
          jsonrpc: "2.0",
          id: "a",
          method: "tools/call",
          params: { name, arguments: name === "search_lore" ? { query: "secrets" } : {} },
        },
        { token, sessionId }
      );
      const result = (await res.json()).result;
      expect(result._meta["tusks-vault"].refusedBy).toBe("allowPlayers");
      expect(result.isError).toBeFalsy();
    }
  );

  it.each(["search_lore", "list_sources"])(
    "lets %s through once the table has opted in",
    async (name) => {
      // The other direction, so the fix cannot be "always refuse".
      state.settings = {
        surfaces: { foundry: { enabled: true, allowPlayers: true }, discord: {}, mcp: {} },
      };
      const { token, sessionId } = await connect();
      const res = await rpc(
        {
          jsonrpc: "2.0",
          id: "a",
          method: "tools/call",
          params: { name, arguments: name === "search_lore" ? { query: "secrets" } : {} },
        },
        { token, sessionId }
      );
      const result = (await res.json()).result;
      expect(result._meta?.["tusks-vault"]?.refusedBy).toBeUndefined();
    }
  );
});

describe("errors — the module renders `error` as a string", () => {
  it("reports a switched-off surface as a readable sentence", async () => {
    // The module prints res.body.error verbatim into the GM's whisper. An
    // object here renders as "[object Object]"; an absent field falls back to
    // a message that blames the connection instead of naming the cause.
    const token = await pair();
    state.settings = {
      surfaces: { foundry: { enabled: false }, discord: {}, mcp: {} },
    };
    const res = await rpc(
      {
        jsonrpc: "2.0",
        id: "i",
        method: "initialize",
        params: { protocolVersion: MODULE_PROTOCOL_VERSION, capabilities: {}, clientInfo: {} },
      },
      { token }
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error).toMatch(/foundry/i);
  });

  it("reports a bad token as a string too", async () => {
    // Pair first: origin is checked BEFORE the token, deliberately, so that an
    // unpaired page is turned away without its guess ever being compared
    // against a stored credential. Without pairing this is a 403 about the
    // origin and the token is never reached.
    await pair();
    const res = await rpc(
      { jsonrpc: "2.0", id: "i", method: "initialize", params: {} },
      { token: "not-a-real-token" }
    );
    expect(res.status).toBe(401);
    expect(typeof (await res.json()).error).toBe("string");
  });
});
