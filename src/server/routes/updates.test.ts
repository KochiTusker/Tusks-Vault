// The updater is the sharpest route in the app: /apply spawns git and
// rewrites the working tree, /restart kills the process. Both must refuse a
// non-loopback peer.
//
// This is a regression test for a real gap. hostOriginGuard's cross-origin
// check reads `if (raw && ...)` — it only fires when an Origin or Referer is
// actually present, which is true of a browser and false of curl. With the
// documented HOST=0.0.0.0 bind that left the updater reachable from the LAN:
// GET /check hands out the remote sha, and `confirmSha` asks for exactly that
// sha back, so it never defended against anything but a stale tab.
//
// The peer address is faked rather than the socket: binding a real listener to
// a LAN interface would make the test depend on the machine having one.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("../util/updater", () => ({
  // If the gate ever fails open, these throw rather than letting a test run
  // git against the working tree.
  applyUpdate: vi.fn(() => {
    throw new Error("applyUpdate must not be reachable from a non-loopback peer");
  }),
  getUpdateStatus: vi.fn(async () => ({ blockedReason: null, remoteHead: { sha: "deadbeef" } })),
  scheduleRestart: vi.fn(() => {
    throw new Error("scheduleRestart must not be reachable from a non-loopback peer");
  }),
}));

const { updatesRouter } = await import("./updates");

/** Serves the router with every request presenting `peer` as its source. */
function appWithPeer(peer: string) {
  const app = express();
  app.use((req, _res, next) => {
    Object.defineProperty(req.socket, "remoteAddress", { value: peer, configurable: true });
    next();
  });
  app.use(updatesRouter);
  return app;
}

async function listen(app: express.Express) {
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}

let lan: Awaited<ReturnType<typeof listen>>;
let local: Awaited<ReturnType<typeof listen>>;

beforeAll(async () => {
  lan = await listen(appWithPeer("192.168.1.50"));
  local = await listen(appWithPeer("127.0.0.1"));
});

afterAll(async () => {
  await new Promise<void>(resolve => lan.server.close(() => resolve()));
  await new Promise<void>(resolve => local.server.close(() => resolve()));
});

describe("updater routes are loopback-only", () => {
  it("refuses /api/updates/apply from a LAN peer", async () => {
    const res = await fetch(`${lan.base}/api/updates/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The sha a LAN caller would have read straight out of /check.
      body: JSON.stringify({ confirmSha: "deadbeef" }),
    });
    expect(res.status).toBe(403);
  });

  it("refuses /api/updates/restart from a LAN peer", async () => {
    // This one had no guard of any kind: no auth, no confirmation, no gate.
    const res = await fetch(`${lan.base}/api/updates/restart`, { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("refuses /api/updates/check from a LAN peer", async () => {
    // Gated too, because it is what makes the others reachable: it runs a
    // git fetch and reports the install's exact position on request.
    const res = await fetch(`${lan.base}/api/updates/check`);
    expect(res.status).toBe(403);
  });

  it("still serves the host itself", async () => {
    const res = await fetch(`${local.base}/api/updates/check`);
    expect(res.status).not.toBe(403);
  });
});
