import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Which routers carry `loopbackOnly()`.
 *
 * The rule is written down in CLAUDE.md and repeated in two user-facing docs:
 * every route that acts on the HOST is gated on the peer address, because
 * `hostOriginGuard`'s remaining check reads `Origin`, and it only fires when
 * one is present — which a browser sends and `curl` does not.
 *
 * Nothing enforced it. `updates.ts` says in its own comment that it "was the
 * one place the code disagreed with the policy"; it was not. Under
 * `HOST=0.0.0.0` a LAN peer could POST /api/diagnostics/bundle — which spawns
 * `git` and writes two files — read every resolved absolute path including the
 * key store under the OS user's profile, read the captured log, and DELETE it.
 *
 * A source-level assertion rather than a request-level one, deliberately: the
 * failure mode is a NEW host-acting router added without the gate, and that is
 * a question about the file, not about a response. Route-level behaviour is
 * `loopback-only.test.ts`'s job.
 */
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

/** Routers that act on the host: spawn a process, read or write a path the
 *  user chose, or administer the install. Each must apply the gate. */
const MUST_BE_GATED = [
  "claude-code.ts", // spawns the Claude Code CLI
  "model-probe.ts", // also spawns it, to test a Claude Code model
  "obsidian.ts", // reads an arbitrary absolute path
  "forge.ts", // browses and writes the filesystem
  "integrations.ts", // resolves the Tomes/lore folder
  "updates.ts", // runs the updater
  "dev-credential.ts", // holds a GitHub PAT for the updater
  "diagnostics.ts", // spawns git, writes a bundle, discloses absolute paths
  "logs.ts", // the log names the key-store path; DELETE wipes it
];

describe("host-acting routes are gated on the peer address", () => {
  it.each(MUST_BE_GATED)("%s applies loopbackOnly() on EVERY route", (file) => {
    const src = readFileSync(path.join(HERE, file), "utf-8");
    expect(src).toContain("loopbackOnly");
    // Imported AND applied — an unused import would satisfy a bare substring
    // check while gating nothing.
    expect(src).toMatch(/loopbackOnly\(\)/);

    // Per ROUTE, not merely per file. A file-level substring check passes as
    // long as ONE handler is gated, which is how GET /api/claude-code/status
    // stayed open while POST /generate beside it was closed — and `?force=1`
    // there spawns a process on every call.
    //
    // Two shapes both count, and both are in use here:
    //   router.use("/api/x", loopbackOnly())   — covers the whole prefix, and
    //                                            covers a route added later
    //   router.get("/api/x/y", loopbackOnly()) — covers that one route
    const mountGates = [...src.matchAll(/\.use\(\s*"([^"]+)"\s*,\s*loopbackOnly\(\)/g)].map(m => m[1]);
    const blanketGate = /\.use\(\s*loopbackOnly\(\)/.test(src);

    const routes = [...src.matchAll(
      /\b\w+Router\.(get|post|put|patch|delete)\(\s*"([^"]+)"([\s\S]{0,200}?)=>/g,
    )];
    expect(routes.length).toBeGreaterThan(0);

    // A route the pattern above cannot READ is silently skipped, and a skipped
    // route reads as a gated one — the exact failure this test was rewritten to
    // fix, one level up. The pattern only understands a double-quoted path
    // followed by an arrow function within 200 characters, so a named handler,
    // a single-quoted or template-literal path, or a router not named `*Router`
    // all vanish. Counting raw registrations and demanding the numbers match
    // turns "I could not parse it" into a failure instead of a pass.
    const rawRegistrations = [
      ...src.matchAll(/\b\w+Router\.(get|post|put|patch|delete)\(/g),
    ].length;
    expect(
      routes.length,
      `${file}: ${rawRegistrations - routes.length} route(s) are in a shape this check cannot ` +
        `parse, so it cannot tell whether they are gated. Write them as ` +
        `\`someRouter.get("/path", ... => {\` or widen the pattern above — but do not leave a ` +
        `route this file cannot see.`
    ).toBe(rawRegistrations);

    for (const [, verb, routePath, head] of routes) {
      const covered =
        blanketGate ||
        head.includes("loopbackOnly()") ||
        mountGates.some(prefix => routePath === prefix || routePath.startsWith(prefix + "/"));
      expect(covered, `${file}: ${verb.toUpperCase()} ${routePath} is not gated`).toBe(true);
    }
  });

  it("forces a decision when a router is added or removed", () => {
    // The other direction: a new host-acting router mounted in index.ts and
    // never considered here. Most routers are ordinary data routes and do not
    // belong on MUST_BE_GATED, so this cannot decide for you — it just refuses
    // to let the set change silently.
    //
    // If this fails: work out whether the new router spawns a process, touches
    // a path the CALLER chose, or administers the install. If any of those,
    // add it to MUST_BE_GATED and gate it. Then update this number.
    const index = readFileSync(path.join(HERE, "index.ts"), "utf-8");
    const mounted = [...index.matchAll(/app\.use\((\w+)\)/g)].map((m) => m[1]);
    expect(mounted.length).toBeGreaterThanOrEqual(MUST_BE_GATED.length);
    expect(mounted.length).toBe(23);
  });

  it("settings gates its host-acting FIELDS, since only some of them are", () => {
    // /api/settings is not router-gated and must not be: a LAN visitor is
    // meant to change the model or the persona. But loreSource,
    // obsidianVaultPath and tomesSessionsPath each name a directory on the
    // host, so those three are gated inside the handler on the peer address —
    // the same property loopbackOnly() checks, applied per field.
    const src = readFileSync(path.join(HERE, "settings.ts"), "utf-8");
    expect(src).toContain("_isLoopbackAddress");
    // The peer address, not a header. A header is attacker-controlled.
    expect(src).toMatch(/_isLoopbackAddress\(\s*req\.socket\?\.remoteAddress\s*\)/);
    for (const field of ["loreSource", "obsidianVaultPath"]) {
      expect(src).toContain(field);
    }
  });
});
