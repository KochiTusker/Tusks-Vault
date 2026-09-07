// Pins `npm run verify`, the pre-push hook and CI to one definition of "the
// gates". The hook and CI drifting apart is not hypothetical: a hook that
// runs a strict subset of CI goes green locally and red remotely on
// failures nothing local could have caught. This suite fails the moment any
// of the three stops agreeing.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = f => readFileSync(path.join(ROOT, f), "utf-8");

describe("verify parity", () => {
  const pkg = JSON.parse(read("package.json"));

  it("`verify` runs typecheck, tests, the dev-mode tree audit and the contracts audit", () => {
    const verify = pkg.scripts.verify;
    expect(verify).toContain("npm run lint");
    expect(verify).toContain("npm test");
    expect(verify).toContain("audit-current-tree.mjs --dev-mode");
    expect(verify).toContain("audit-security-contracts.mjs");
  });

  it("the canonical pre-push hook calls `npm run verify`, not its own command list", () => {
    const hook = read("scripts/hooks/pre-push");
    expect(hook).toMatch(/npm run --silent verify/);
    // The hook must not re-list individual gates — that is how the drift
    // starts. (`npm run verify` naming the gates in a comment is fine; a
    // second `vitest`/`tsc` invocation is not.)
    expect(hook).not.toMatch(/\bnpx vitest\b|\btsc\b/);
  });

  it("the hook's stage-2 scanner and its fail-closed behaviour are intact", () => {
    const hook = read("scripts/hooks/pre-push");
    expect(hook).toContain("audit-push-range.mjs");
    // Missing scanner refuses the push instead of silently skipping.
    expect(hook).toMatch(/Refusing the push/);
    // Both public-destination matchers: remote name and URL shape.
    expect(hook).toContain('"public"');
    expect(hook).toContain("tusks-vault-dev");
  });

  it("CI runs the same gates as verify (plus its own npm-audit step)", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("npm run lint");
    expect(ci).toContain("npm test");
    expect(ci).toContain("audit-current-tree.mjs --dev-mode");
    expect(ci).toContain("audit-security-contracts.mjs");
  });

  it("CI's dependency gate is the exception-aware one, not a weakened audit", () => {
    // The raw `npm audit --omit=dev --audit-level=high` began failing on two
    // advisories with no fixed release inside their parent's range. The two
    // obvious ways to get CI green again — lowering --audit-level, or
    // appending `|| true` — silence every FUTURE advisory as well, which is
    // how a gate becomes decoration. audit-dependencies.mjs keeps the scan
    // and makes each exception carry a reason and a date.
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("npm run audit:deps");
    expect(ci).not.toMatch(/npm audit[^\n]*\|\|\s*true/);
    expect(ci).not.toMatch(/--audit-level=(low|info|moderate)/);
    expect(pkg.scripts["audit:deps"]).toContain("audit-dependencies.mjs");
  });

  it("CI covers Windows — the platform users actually run", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("windows-latest");
    expect(ci).toContain("ubuntu-latest");
    expect(ci).toMatch(/fail-fast:\s*false/);
  });
});
