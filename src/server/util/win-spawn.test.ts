import { describe, expect, it, vi, afterEach } from "vitest";
import { quoteForCmd, shellSafeSpawn } from "./win-spawn";

/** process.platform is read-only; redefine it for the duration of a test. */
function onPlatform(platform: string, fn: () => void) {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    fn();
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
  it("hands Windows a pre-quoted string and an EMPTY args array", () => {
    // The empty array is the whole point: DEP0190 fires on shell:true WITH
    // args, because Node concatenates them unescaped. Nothing to concatenate,
    // nothing to warn about.
    onPlatform("win32", () => {
      const s = shellSafeSpawn("claude", ["-p", "--model", "claude-sonnet-5"]);
      expect(s.args).toEqual([]);
      expect(s.shell).toBe(true);
      expect(s.command).toBe("claude -p --model claude-sonnet-5");
    });
  });

  it("quotes a Windows argument that needs it, rather than splitting the call", () => {
    onPlatform("win32", () => {
      expect(shellSafeSpawn("my tool", ["a b"]).command).toBe('"my tool" "a b"');
    });
  });

  it("does not reach for a shell at all off Windows", () => {
    onPlatform("linux", () => {
      const s = shellSafeSpawn("claude", ["--version"]);
      expect(s).toEqual({ command: "claude", args: ["--version"], shell: false });
    });
  });
});
