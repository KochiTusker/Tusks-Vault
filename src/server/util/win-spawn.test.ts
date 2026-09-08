import { describe, expect, it, vi, afterEach } from "vitest";
import { quoteForCmd, shellSafeSpawn } from "./win-spawn";

/**
 * process.platform is read-only; redefine it for the duration of a test.
 *
 * `await fn()`, not `fn()`. With a synchronous call an async callback would
 * return its promise immediately, `finally` would restore the real platform,
 * and every assertion inside would then run against the host — passing on
 * Windows and failing on the Linux CI leg. That is exactly the defect v1.0.3
 * exists to fix, and all three call sites here being synchronous today is not
 * a reason to leave the trap armed for the fourth.
 */
async function onPlatform<T>(platform: string, fn: () => T | Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

afterEach(() => vi.restoreAllMocks());

describe("quoteForCmd", () => {
  it("leaves ordinary arguments alone, so process lists stay readable", () => {
    expect(quoteForCmd("--version")).toBe("--version");
    expect(quoteForCmd("claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  it("quotes anything cmd.exe would interpret", () => {
    expect(quoteForCmd("two words")).toBe('"two words"');
    for (const ch of ["&", "|", "<", ">", "(", ")", "^", "%", "!"]) {
      expect(quoteForCmd(`a${ch}b`)).toBe(`"a${ch}b"`);
    }
  });

  it("doubles embedded quotes — cmd's escape is not a backslash", () => {
    expect(quoteForCmd('say "hi"')).toBe('"say ""hi"""');
  });

  it("keeps an empty argument as an occupied slot", () => {
    // Dropping it would shift every later argument left by one, silently.
    expect(quoteForCmd("")).toBe('""');
  });
});

describe("shellSafeSpawn", () => {
  it("hands Windows a pre-quoted string and an EMPTY args array", async () => {
    // The empty array is the whole point: DEP0190 fires on shell:true WITH
    // args, because Node concatenates them unescaped. Nothing to concatenate,
    // nothing to warn about.
    await onPlatform("win32", () => {
      const s = shellSafeSpawn("claude", ["-p", "--model", "claude-sonnet-5"]);
      expect(s.args).toEqual([]);
      expect(s.shell).toBe(true);
      expect(s.command).toBe("claude -p --model claude-sonnet-5");
    });
  });

  it("quotes a Windows argument that needs it, rather than splitting the call", async () => {
    await onPlatform("win32", () => {
      expect(shellSafeSpawn("my tool", ["a b"]).command).toBe('"my tool" "a b"');
    });
  });

  it("does not reach for a shell at all off Windows", async () => {
    await onPlatform("linux", () => {
      const s = shellSafeSpawn("claude", ["--version"]);
      expect(s).toEqual({ command: "claude", args: ["--version"], shell: false });
    });
  });
});
