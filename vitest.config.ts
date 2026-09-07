import { defineConfig } from "vitest/config";

// Vitest config for the test suite. Coverage is server-side plus the pure
// helpers under src/lib/; React components remain untested — see
// docs/troubleshooting/known-issues.md for the wider backlog.
//
// Kept separate from vite.config.ts so test settings don't intermingle with
// the frontend build.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/server/**/*.test.ts",
      // Shared pure helpers used by the frontend. No DOM needed, so they run
      // in the same node environment as everything else.
      "src/lib/**/*.test.ts",
      // Repo-maintenance scripts are plain .mjs but ship with their own
      // vitest suites so changes to shared script modules are caught by
      // `npm test`.
      "scripts/**/*.test.mjs",
    ],
    // Keep test runs deterministic — no parallel file execution by default.
    // Individual suites are still parallelized within a file.
    fileParallelism: false,

    // Vitest defaults (5s test / 10s hook) are too tight for this suite, which
    // does real filesystem work rather than mocking it — the Obsidian vault
    // tests write ~120 notes and build a vault map in a `beforeEach`, so that
    // runs once per test in the block.
    //
    // This is not hypothetical tuning: that hook completes in well under a
    // second on an idle machine and still blew the 10s default when the suite
    // ran alongside another heavy task. CI runs this matrix on windows-latest,
    // where writing 121 files is slower again and a noisy neighbour is normal,
    // so the margin needed to be real rather than nominal.
    //
    // Deliberately generous rather than just-enough. These are backstops
    // against a genuine hang, not performance budgets — nothing here is
    // *expected* to take seconds, so a test that approaches these numbers is
    // telling you something regardless of whether it passes.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
