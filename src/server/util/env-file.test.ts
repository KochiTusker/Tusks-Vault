import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setEnvVar } from "./env-file";

// Each test swaps cwd to a tmpdir so .env.local writes land somewhere
// disposable and we never touch the repo's real .env.local. env-file resolves
// its path lazily (via envLocalPath()) so a per-test chdir takes effect.
let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-vault-envfile-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  // Clean up the test value we may have leaked into process.env.
  delete process.env.TEST_TOKEN;
  delete process.env.DISCORD_TOKEN_TEST;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("setEnvVar — newline / NUL injection guard", () => {
  it("rejects values containing \\n", () => {
    expect(() => setEnvVar("TEST_TOKEN", "valid\nNODE_OPTIONS=--require=/tmp/evil.js"))
      .toThrow(/newlines or NUL/);
  });

  it("rejects values containing \\r", () => {
    expect(() => setEnvVar("TEST_TOKEN", "valid\rEXTRA=1")).toThrow(/newlines or NUL/);
  });

  it("rejects values containing NUL", () => {
    expect(() => setEnvVar("TEST_TOKEN", "valid\x00bad")).toThrow(/newlines or NUL/);
  });

  it("does NOT write to .env.local when the value is rejected", () => {
    try { setEnvVar("TEST_TOKEN", "x\ny"); } catch { /* expected */ }
    const envPath = path.join(process.cwd(), ".env.local");
    if (fs.existsSync(envPath)) {
      expect(fs.readFileSync(envPath, "utf-8")).not.toContain("TEST_TOKEN=");
    }
  });
});

describe("setEnvVar — happy path", () => {
  it("writes a KEY=VALUE line for a fresh file", () => {
    setEnvVar("TEST_TOKEN", "abc123.def.ghi");
    const envPath = path.join(process.cwd(), ".env.local");
    expect(fs.readFileSync(envPath, "utf-8")).toMatch(/^TEST_TOKEN=abc123\.def\.ghi$/m);
  });

  it("updates process.env so the next consumer sees it", () => {
    setEnvVar("TEST_TOKEN", "abc123.def.ghi");
    expect(process.env.TEST_TOKEN).toBe("abc123.def.ghi");
  });

  it("replaces an existing line in-place rather than appending a duplicate", () => {
    setEnvVar("TEST_TOKEN", "first");
    setEnvVar("TEST_TOKEN", "second");
    const envPath = path.join(process.cwd(), ".env.local");
    const content = fs.readFileSync(envPath, "utf-8");
    expect((content.match(/^TEST_TOKEN=/gm) ?? []).length).toBe(1);
    expect(content).toContain("TEST_TOKEN=second");
    expect(content).not.toContain("TEST_TOKEN=first");
  });

  it("rejects invalid env-var keys (control chars, spaces, dashes)", () => {
    expect(() => setEnvVar("9BAD", "x")).toThrow(/invalid env key/);
    expect(() => setEnvVar("bad key", "x")).toThrow(/invalid env key/);
    expect(() => setEnvVar("bad-key", "x")).toThrow(/invalid env key/);
  });

  it.skipIf(process.platform === "win32")(
    "locks .env.local to owner-only (0o600) on POSIX",
    () => {
      setEnvVar("TEST_TOKEN", "abc123");
      const envPath = path.join(process.cwd(), ".env.local");
      const mode = fs.statSync(envPath).mode & 0o777;
      expect(mode).toBe(0o600);
    },
  );
});
