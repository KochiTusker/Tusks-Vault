// The port walk is the difference between "the dashboard opened on 3001" and
// "the program did not start". It had one gap: it only treated EADDRINUSE as a
// reason to try the next candidate.
//
// On Windows that is the wrong half of the problem. Hyper-V, WSL2 and Docker
// Desktop reserve blocks of TCP ports with the OS (visible via
// `netsh interface ipv4 show excludedportrange protocol=tcp`), and binding
// inside a reserved block fails with EACCES, not EADDRINUSE — verified on
// Windows 11. So a user whose reservation covered 3000 got a hard
// `listen EACCES` on the first attempt and the other nineteen candidates were
// never tried, which is precisely the case the fallback was written for.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

// http is mocked because the failures under test cannot be provoked for real:
// EACCES needs an OS-level port reservation, which a test cannot create.
//
// vi.hoisted, because vi.mock is lifted above the module body — a plain
// `const` here would not exist yet when the factory runs.
const state = vi.hoisted(() => ({
  listenAttempts: [] as number[],
  failures: {} as Record<number, string>,
}));
const listenAttempts = state.listenAttempts;

vi.mock("http", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeServer extends EventEmitter {
    listen(port: number, _host: string) {
      state.listenAttempts.push(port);
      const code = state.failures[port];
      // setImmediate: the real listen is async, and resolving synchronously
      // would let a broken implementation that ignores the event pass.
      setImmediate(() => {
        if (code) {
          const err = new Error(`listen ${code}: fake failure on ${port}`) as NodeJS.ErrnoException;
          err.code = code;
          this.emit("error", err);
        } else {
          this.emit("listening");
        }
      });
      return this;
    }
    close() {}
  }
  return { default: { createServer: () => new FakeServer() } };
});

// Imported after the mock is registered, and dynamically so the module picks
// the mocked http up.
const { bindWithFallback } = await import("./port");

const app = {} as import("express").Express;

beforeEach(() => {
  // writeRuntimePort writes `<cwd>/.port-runtime` through a module-level
  // constant, so an unmocked run overwrites the real file at the repo root
  // with a fake port — and `npm test` alongside `npm run dev` then leaves a
  // bogus port on disk for anything that reads it.
  vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
});

afterEach(() => {
  listenAttempts.length = 0;
  state.failures = {};
  vi.restoreAllMocks();
});

describe("bindWithFallback", () => {
  it("binds the preferred port when it is free", async () => {
    const { port } = await bindWithFallback(app, 3000);
    expect(port).toBe(3000);
    expect(listenAttempts).toEqual([3000]);
  });

  it("walks past a port held by another process (EADDRINUSE)", async () => {
    state.failures = { 3000: "EADDRINUSE", 3001: "EADDRINUSE" };
    const { port } = await bindWithFallback(app, 3000);
    expect(port).toBe(3002);
  });

  it("walks past a Windows-reserved port (EACCES) instead of giving up", async () => {
    // The regression. Before the fix this rejected on the first attempt and
    // 3001..3019 were never tried.
    state.failures = { 3000: "EACCES" };
    const { port } = await bindWithFallback(app, 3000);
    expect(port).toBe(3001);
    expect(listenAttempts).toEqual([3000, 3001]);
  });

  it("walks past a whole reserved block, mixed with ports in use", async () => {
    // What a Docker Desktop machine actually looks like: a contiguous reserved
    // range, then something already listening just past it.
    state.failures = {
      3000: "EACCES", 3001: "EACCES", 3002: "EACCES",
      3003: "EACCES", 3004: "EADDRINUSE",
    };
    const { port } = await bindWithFallback(app, 3000);
    expect(port).toBe(3005);
  });

  it("does not walk on an error the next port cannot fix", async () => {
    // A bad HOST yields EADDRNOTAVAIL on every candidate. Trying twenty of
    // them buries the real cause under a range summary.
    state.failures = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [3000 + i, "EADDRNOTAVAIL"])
    );
    await expect(bindWithFallback(app, 3000)).rejects.toThrow(/EADDRNOTAVAIL/);
    expect(listenAttempts).toEqual([3000]);
  });

  it("gives up after the whole range and names the range", async () => {
    state.failures = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [3000 + i, "EADDRINUSE"])
    );
    await expect(bindWithFallback(app, 3000)).rejects.toThrow(/3000\.\.3019/);
    expect(listenAttempts).toHaveLength(20);
  });

  // The EACCES hint is platform-specific, so these override process.platform
  // rather than reading it. An earlier version asserted the Windows wording
  // unconditionally: it passed on the maintainer's machine and failed on the
  // Linux CI leg — a test that only checks the host it happens to run on is
  // half a test, and on a cross-platform project it is the wrong half.
  async function messageOnPlatform(platform: string): Promise<string> {
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    try {
      state.failures = Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [3000 + i, "EACCES"])
      );
      return await bindWithFallback(app, 3000).then(
        // Throw rather than return a sentinel string. A sentinel is caught only
        // by each test's POSITIVE assertion; the POSIX case's
        // `not.toMatch(/netsh/)` would happily pass on it, so reordering or
        // dropping one line would turn this into a silent pass.
        () => { throw new Error("bindWithFallback resolved; expected it to reject"); },
        (err: Error) => err.message
      );
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  }

  it("points at the Windows reservation list when the range dies of EACCES", async () => {
    // The diagnosis is not guessable from "could not bind": the ports are not
    // in use, they are administratively excluded, and the fix is a different
    // PORT rather than closing something.
    const message = await messageOnPlatform("win32");
    expect(message).toMatch(/excludedportrange/);
    expect(message).toMatch(/3000\.\.3019/);
  });

  it("points POSIX users at privileged ports instead, not at netsh", async () => {
    // Same errno, unrelated cause. Telling a Linux user who set PORT=80 to run
    // a Windows networking command sends them nowhere.
    const message = await messageOnPlatform("linux");
    expect(message).toMatch(/below 1024 need root/);
    expect(message).not.toMatch(/netsh|excludedportrange/);
  });
});
