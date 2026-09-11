import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A child that spawns, accepts the prompt, and then never says anything again
// — the shape of a real hang: a network stall, or the CLI waiting on a TTY
// prompt that is a pipe. Before the wall-clock guard this made runClaudeCode's
// promise unsettleable, which held the surface's only queue slot forever.
const spawned: Array<{ killed: boolean; args: string[] }> = [];

function makeStuckChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter & { write: () => boolean; end: () => void };
    kill: () => boolean;
    pid: number;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const stdin = new EventEmitter() as EventEmitter & { write: () => boolean; end: () => void };
  stdin.write = () => true;
  stdin.end = () => {};
  child.stdin = stdin;
  child.pid = 4242;
  const record = { killed: false, args: [] as string[] };
  child.kill = () => {
    record.killed = true;
    return true;
  };
  spawned.push(record);
  return { child, record };
}

vi.mock("child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: vi.fn((cmd: string, args: string[]) => {
      // taskkill is the tree-kill on Windows, not the CLI itself.
      if (cmd === "taskkill") {
        const noop = new EventEmitter() as EventEmitter & { unref?: () => void };
        if (spawned.length > 0) spawned[spawned.length - 1].killed = true;
        return noop as never;
      }
      const { child, record } = makeStuckChild();
      record.args = args;
      return child as never;
    }),
  };
});

const { runClaudeCode, ClaudeCodeError } = await import("./claude-code-cli");

beforeEach(() => {
  spawned.length = 0;
});

describe("runClaudeCode — wall-clock guard", () => {
  it("rejects instead of hanging forever when the CLI never responds", async () => {
    const started = Date.now();
    await expect(
      runClaudeCode({ prompt: "who is Alric?", timeoutMs: 60 })
    ).rejects.toBeInstanceOf(ClaudeCodeError);
    // The point is that it settles at all. A generous ceiling here so a loaded
    // CI box does not turn this into a flake.
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("says plainly that it timed out, and classifies it as a CLI failure", async () => {
    await expect(runClaudeCode({ prompt: "who is Alric?", timeoutMs: 60 })).rejects.toMatchObject({
      kind: "cli_failed",
    });
    await expect(runClaudeCode({ prompt: "who is Alric?", timeoutMs: 60 })).rejects.toThrow(
      /did not respond within/i
    );
  });

  it("kills the stuck child rather than leaving it spending the subscription", async () => {
    await expect(runClaudeCode({ prompt: "who is Alric?", timeoutMs: 60 })).rejects.toThrow();
    expect(spawned.length).toBeGreaterThan(0);
    expect(spawned[0].killed, "a timed-out child must be terminated").toBe(true);
  });

  it("does not fire when the CLI answers in time", async () => {
    // Behaviour guard: the timeout must be invisible to a working install.
    const { spawn } = await import("child_process");
    (spawn as unknown as { mockImplementationOnce: (f: unknown) => void }).mockImplementationOnce(
      () => {
        const { child } = makeStuckChild();
        setTimeout(() => {
          child.stdout.emit(
            "data",
            Buffer.from(JSON.stringify({ result: "Alric is the steward.", total_cost_usd: 0.01 }))
          );
          child.emit("close", 0, null);
        }, 5);
        return child as never;
      }
    );
    const result = await runClaudeCode({ prompt: "who is Alric?", timeoutMs: 5_000 });
    expect(result.text).toContain("Alric is the steward.");
    expect(spawned[0].killed, "a healthy call must not be killed").toBe(false);
  });
});
