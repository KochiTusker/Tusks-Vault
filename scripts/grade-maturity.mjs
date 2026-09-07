// Mature-narration bake-off — the six-axis suite, run for real.
//
//   npm run grade:maturity -- --models sonnet --provider claudeCode
//   npm run grade:maturity -- --models sonnet,opus --passes 2 --out maturity.json
//   npm run grade:maturity -- --models sonnet --engagement off   (measure the model bare)
//
// Why this exists: the grades shipped in llm/maturity-measurements.ts cover
// OpenRouter ids only, and the script that produced them was never committed,
// so `sonnet` / `opus` / `haiku` — the models answering on a subscription —
// have no measured grade at all. That is the one provider a user cannot
// evaluate before choosing it.
//
// An axis counts only if the model delivered it in EVERY pass, which is why
// --passes defaults to 2. For a bot answering live in a channel, an axis that
// works two times in three is an axis that fails in front of the table.
//
// --engagement off drops the standing ENGAGEMENT clause from the system
// prompt. Run it both ways and the difference IS the clause's effect, which
// is the only honest way to know whether it earns its place. Note that the
// recorded OpenRouter numbers predate the clause entirely, so `off` is the
// comparable setting and `on` is what users actually get.
//
// Costs real quota: models x passes x 6 calls. On a subscription that is the
// usage window rather than money, but it is not free.
//
// Run under tsx, not node: it imports the app's TypeScript directly, so the
// prompt is the one a Discord message actually produces.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, "grading", "corpus");

// Must be set before the app's path module is imported — it resolves the lore
// directory once, at load.
process.env.TUSKS_VAULT_LORE_PATH = CORPUS;

const { MATURITY_CASES, SANITISED_MARKERS } = await import("./grading/maturity-cases.mjs");
const { assemblePromptParts, buildSystemInstruction } = await import("../src/server/prompt/assemble.ts");
const { DEFAULT_SYSTEM_INSTRUCTION } = await import("../src/server/prompt/system.ts");
const { getAdapter } = await import("../src/server/llm/registry.ts");
const { getSettings } = await import("../src/server/config/settings.ts");
const { detectRefusal } = await import("../src/server/llm/refusal.ts");
const { scoreMaturity, AXIS_LABEL } = await import("../src/server/llm/maturity-grade.ts");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const provider = arg("provider", "claudeCode");
const models = (arg("models") ?? "").split(",").map(s => s.trim()).filter(Boolean);
const passes = Math.max(1, Number(arg("passes", "2")) || 2);
const engagement = arg("engagement", "on") !== "off";
const onlyAxis = arg("axis");
const outPath = arg("out");

if (models.length === 0) {
  console.error(
    "Usage: npm run grade:maturity -- --provider <p> --models <a,b,c> " +
      "[--passes N] [--axis <axis>] [--engagement on|off] [--out results.json]"
  );
  process.exit(1);
}

const cases = onlyAxis ? MATURITY_CASES.filter(c => c.axis === onlyAxis) : MATURITY_CASES;
if (cases.length === 0) {
  console.error(`No axis "${onlyAxis}". Known: ${MATURITY_CASES.map(c => c.axis).join(", ")}`);
  process.exit(1);
}

console.log(`Corpus:     ${CORPUS}`);
console.log(`Axes:       ${cases.map(c => c.axis).join(", ")}`);
console.log(`Provider:   ${provider}   Models: ${models.join(", ")}`);
console.log(`Passes:     ${passes}   Engagement clause: ${engagement ? "ON (as shipped)" : "OFF (bare model)"}\n`);

const settings = getSettings();
const systemPrompt = buildSystemInstruction(DEFAULT_SYSTEM_INSTRUCTION, {
  botName: "Tusk",
  // "" removes the clause entirely; undefined keeps the shipped default.
  engagementClause: engagement ? undefined : "",
});

/**
 * Classify one answer into an AxisOutcome.
 *
 * Order matters. A refusal outranks everything — the model said no, and that
 * is a property worth grading harshly. Empty is kept separate because a
 * truncated or dropped response is the PROVIDER failing, and reporting a
 * flaky host as a censorious model would be a lie about which thing to fix.
 * Sanitised is last because it can only be judged on text that exists.
 */
function classify(text, testCase) {
  if (!text || text.trim().length < 20) return "empty";
  if (detectRefusal(text).refused) return "refused";
  if (SANITISED_MARKERS.some(re => re.test(text))) return "sanitised";
  const hits = testCase.engaged.filter(re => re.test(text)).length;
  return hits >= (testCase.minHits ?? 1) ? "engaged" : "sanitised";
}

const report = { measuredAt: new Date().toISOString(), provider, passes, engagement, byModel: {} };

for (const model of models) {
  console.log(`── ${model} ${"─".repeat(Math.max(0, 56 - model.length))}`);
  const { adapter } = getAdapter(
    { ...settings, proModel: model, flashModel: model },
    { explicitProvider: provider }
  );

  const runs = [];
  const answers = {};

  for (let pass = 1; pass <= passes; pass++) {
    const outcomes = {};
    for (const c of cases) {
      const parts = await assemblePromptParts(c.prompt, {});
      let text = "";
      let error = null;
      const t0 = Date.now();
      try {
        const out = await adapter.generate({
          systemPrompt,
          userParts: parts,
          tier: "flash",
          modelOverride: model,
          // A reasoning model can otherwise spend the whole budget thinking
          // and return nothing, which scores as a refusal it never made.
          maxOutputTokens: 1200,
        });
        text = out.text ?? "";
      } catch (err) {
        error = err.message ?? String(err);
      }
      const ms = Date.now() - t0;

      // A thrown call is delivery failing, not the model declining. Recording
      // it as an outcome would blame the model for a quota or network fault.
      const outcome = error ? "empty" : classify(text, c);
      outcomes[c.axis] = outcome;
      answers[`${c.axis}#${pass}`] = error ? `<error> ${error}` : text;

      const mark = { engaged: "OK  ", sanitised: "soft", refused: "NO  ", empty: "--  " }[outcome];
      console.log(`  ${mark} pass ${pass}  ${c.axis.padEnd(11)} ${ms}ms${error ? `  ${error}` : ""}`);
    }
    runs.push({ outcomes });
  }

  // Scored over the axes actually RUN. Defaulting to all six would report the
  // five that --axis skipped as flaky, which reads as a failing model rather
  // than a partial run.
  const score = scoreMaturity(runs, cases.map(c => c.axis));
  report.byModel[model] = { runs, score, answers };

  console.log(
    `\n  Grade ${score.grade} — ${score.reliable}/${score.axes} axes reliable across ${passes} pass(es)`
  );
  if (score.refused.length) console.log(`  Refused: ${score.refused.map(a => AXIS_LABEL[a]).join(", ")}`);
  if (score.flaky.length) console.log(`  Flaky:   ${score.flaky.map(a => AXIS_LABEL[a]).join(", ")}`);
  console.log();
}

if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Wrote ${outPath}`);
}

console.log(
  "Scoring is mechanical and is a FIRST PASS — read the answers before publishing a grade.\n" +
    "Every response is in the --out JSON. The borderline call is always sanitised-vs-engaged;\n" +
    "refusals and empties are reliable."
);
