import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyUpdate, sortReleaseTagsDesc } from "./updater";

// Each test creates a tmpdir and drops a small node script inside. We point
// applyUpdate at the absolute path so it works regardless of cwd, and we
// avoid touching the real scripts/update.mjs (which would invoke git).
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-vault-updater-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("applyUpdate — wall-clock timeout", () => {
  it("kills a child that hangs past timeoutMs and resolves with code 124", async () => {
    const hangScript = path.join(tmpDir, "hang.mjs");
    // `setTimeout` keeps the event loop alive — node will sit on this forever
    // unless we kill it. We give applyUpdate 250 ms to call it quits.
    fs.writeFileSync(hangScript, "setTimeout(() => {}, 60_000);\n", "utf-8");

    const lines: string[] = [];
    const result = await applyUpdate(
      ({ stream, line }) => { lines.push(`${stream}: ${line}`); },
      { timeoutMs: 250, scriptPath: hangScript },
    );

    expect(result.code).toBe(124);
    expect(result.output).toContain("Wall-clock timeout");
    expect(lines.some(l => l.includes("Wall-clock timeout"))).toBe(true);
  }, 15_000);

  it("does NOT mark timeoutfor a script that completes within timeoutMs", async () => {
    const fastScript = path.join(tmpDir, "fast.mjs");
    fs.writeFileSync(fastScript, "console.log('done');\nprocess.exit(0);\n", "utf-8");

    const result = await applyUpdate(undefined, { timeoutMs: 30_000, scriptPath: fastScript });

    expect(result.code).toBe(0);
    expect(result.output).toContain("done");
    expect(result.output).not.toContain("Wall-clock timeout");
  }, 15_000);

  it("propagates a non-zero script exit code unchanged", async () => {
    const failScript = path.join(tmpDir, "fail.mjs");
    fs.writeFileSync(failScript, "console.error('boom');\nprocess.exit(17);\n", "utf-8");

    const result = await applyUpdate(undefined, { timeoutMs: 30_000, scriptPath: failScript });

    expect(result.code).toBe(17);
    expect(result.output).toContain("boom");
  }, 15_000);

  it("passes targetRef to the child as TUSKS_VAULT_UPDATE_TARGET", async () => {
    // The child script prints the env var so we can assert the wiring works.
    const echoScript = path.join(tmpDir, "echo-target.mjs");
    fs.writeFileSync(
      echoScript,
      "console.log('TARGET=' + (process.env.TUSKS_VAULT_UPDATE_TARGET ?? '<unset>'));\n",
      "utf-8",
    );
    const result = await applyUpdate(undefined, {
      timeoutMs: 30_000,
      scriptPath: echoScript,
      targetRef: "v0.2.0",
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain("TARGET=v0.2.0");
  }, 15_000);

  it("leaves TUSKS_VAULT_UPDATE_TARGET unset when targetRef is omitted (main-mode pull stays default)", async () => {
    const echoScript = path.join(tmpDir, "echo-target.mjs");
    fs.writeFileSync(
      echoScript,
      "console.log('TARGET=' + (process.env.TUSKS_VAULT_UPDATE_TARGET ?? '<unset>'));\n",
      "utf-8",
    );
    const result = await applyUpdate(undefined, { timeoutMs: 30_000, scriptPath: echoScript });
    expect(result.output).toContain("TARGET=<unset>");
  }, 15_000);

  it("passes remote to the child as TUSKS_VAULT_UPDATE_REMOTE (dev-mode toggle)", async () => {
    const echoScript = path.join(tmpDir, "echo-remote.mjs");
    fs.writeFileSync(
      echoScript,
      "console.log('REMOTE=' + (process.env.TUSKS_VAULT_UPDATE_REMOTE ?? '<unset>'));\n",
      "utf-8",
    );
    const result = await applyUpdate(undefined, {
      timeoutMs: 30_000,
      scriptPath: echoScript,
      remote: "dev",
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain("REMOTE=dev");
  }, 15_000);

  it("leaves TUSKS_VAULT_UPDATE_REMOTE unset when remote is omitted (script defaults to origin)", async () => {
    const echoScript = path.join(tmpDir, "echo-remote.mjs");
    fs.writeFileSync(
      echoScript,
      "console.log('REMOTE=' + (process.env.TUSKS_VAULT_UPDATE_REMOTE ?? '<unset>'));\n",
      "utf-8",
    );
    const result = await applyUpdate(undefined, { timeoutMs: 30_000, scriptPath: echoScript });
    expect(result.output).toContain("REMOTE=<unset>");
  }, 15_000);

  it("passes authHeader to the child as TUSKS_VAULT_UPDATE_AUTH_HEADER (dev-mode PAT)", async () => {
    const echoScript = path.join(tmpDir, "echo-auth.mjs");
    fs.writeFileSync(
      echoScript,
      "console.log('AUTH=' + (process.env.TUSKS_VAULT_UPDATE_AUTH_HEADER ?? '<unset>'));\n",
      "utf-8",
    );
    const authHeader = "Authorization: Basic b2F1dGgyOmdocF9mYWtlVG9rZW4xMjM=";

    const result = await applyUpdate(undefined, {
      timeoutMs: 30_000,
      scriptPath: echoScript,
      authHeader,
    });

    expect(result.code).toBe(0);
    expect(result.output).toContain(`AUTH=${authHeader}`);
  }, 15_000);

  it("leaves TUSKS_VAULT_UPDATE_AUTH_HEADER unset when authHeader is omitted (no auth in public path)", async () => {
    const echoScript = path.join(tmpDir, "echo-auth.mjs");
    fs.writeFileSync(
      echoScript,
      "console.log('AUTH=' + (process.env.TUSKS_VAULT_UPDATE_AUTH_HEADER ?? '<unset>'));\n",
      "utf-8",
    );

    const result = await applyUpdate(undefined, { timeoutMs: 30_000, scriptPath: echoScript });

    expect(result.output).toContain("AUTH=<unset>");
  }, 15_000);

  it("does NOT expose the auth header value on the child's argv (PAT stays out of ps aux)", async () => {
    // The child receives the header via env var, never via command-line arg.
    // We verify by reading process.argv inside the child — the auth header
    // string should NOT appear there.
    const argvScript = path.join(tmpDir, "echo-argv.mjs");
    fs.writeFileSync(
      argvScript,
      "console.log('ARGV=' + JSON.stringify(process.argv));\n",
      "utf-8",
    );
    const sensitiveHeader = "Authorization: Basic SECRETSHOULDNOTAPPEARINARGV";

    const result = await applyUpdate(undefined, {
      timeoutMs: 30_000,
      scriptPath: argvScript,
      authHeader: sensitiveHeader,
    });

    expect(result.code).toBe(0);
    // Argv contains: node executable + script path. Neither should embed
    // the auth header.
    expect(result.output).not.toContain("SECRETSHOULDNOTAPPEARINARGV");
    expect(result.output).toMatch(/ARGV=\[/); // sanity: argv was actually captured
  }, 15_000);
});

describe("sortReleaseTagsDesc — semver ordering", () => {
  it("sorts newest-first by major, minor, patch", () => {
    expect(sortReleaseTagsDesc(["v1.0.0", "v2.1.0", "v1.2.3", "v2.0.0"])).toEqual([
      "v2.1.0",
      "v2.0.0",
      "v1.2.3",
      "v1.0.0",
    ]);
  });

  it("breaks ties on minor when major is equal", () => {
    expect(sortReleaseTagsDesc(["v1.0.5", "v1.2.0", "v1.1.10"])).toEqual([
      "v1.2.0",
      "v1.1.10",
      "v1.0.5",
    ]);
  });

  it("breaks ties on patch when major + minor are equal (numeric not lexical)", () => {
    // Lexical would put v1.0.10 < v1.0.9. Verify numeric ordering.
    expect(sortReleaseTagsDesc(["v1.0.9", "v1.0.10", "v1.0.2"])).toEqual([
      "v1.0.10",
      "v1.0.9",
      "v1.0.2",
    ]);
  });

  it("drops non-semver tags silently (caller's responsibility to pre-filter, but defensive)", () => {
    expect(sortReleaseTagsDesc(["v1.0.0", "release-2024", "v2.0.0", "main"])).toEqual([
      "v2.0.0",
      "v1.0.0",
    ]);
  });

  it("returns empty for an empty input", () => {
    expect(sortReleaseTagsDesc([])).toEqual([]);
  });
});
