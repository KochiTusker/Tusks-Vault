// Write site/grades.json from the measurements this build ships with.
//
//   npm run grades:emit
//
// The measurement modules stay the source of truth. This turns them into the
// feed the docs site publishes and installs refresh from, so grading a model
// is: run the graders, update the measurements, emit, republish the site.
// Existing installs pick it up within a day and nobody waits for a release.
//
// Run through tsx because the measurements are TypeScript and there is exactly
// one copy of them. Generating this by hand, or keeping a parallel JSON, is
// how the two drift into disagreeing about what a model scored.

import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "site", "grades.json");

const { bundledGrades } = await import("../src/server/llm/grades-feed.ts");
const feed = bundledGrades();

const models = new Set([...Object.keys(feed.accuracy), ...Object.keys(feed.maturity)]);
if (models.size === 0) {
  console.error("\n✖ No measurements found — refusing to publish an empty feed.\n");
  process.exit(1);
}

// Stable key order, so re-emitting an unchanged measurement set produces a
// byte-identical file and the diff shows only what actually moved.
const sortRecord = (r) =>
  Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));

const out = {
  version: feed.version,
  measuredAt: feed.measuredAt,
  accuracyMethod: feed.accuracyMethod,
  maturityMethod: feed.maturityMethod,
  accuracy: sortRecord(feed.accuracy),
  maturity: sortRecord(feed.maturity),
};

const json = JSON.stringify(out, null, 2) + "\n";
const before = (() => {
  try {
    return readFileSync(OUT, "utf-8");
  } catch {
    return null;
  }
})();

writeFileSync(OUT, json);

console.log(`\n✓ ${path.relative(ROOT, OUT)}`);
console.log(`  ${models.size} model(s) — ${Object.keys(out.accuracy).length} accuracy, ${Object.keys(out.maturity).length} maturity`);
console.log(`  measured ${out.measuredAt}`);
console.log(before === json ? "  unchanged\n" : "  CHANGED — commit it, then republish the site\n");
