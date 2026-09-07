#!/usr/bin/env node
// Model bake-off — how well does each model do Vault's actual job?
//
//   npm run grade -- --models haiku,sonnet --provider claudeCode
//   npm run grade -- --models google/gemini-2.5-flash,openai/gpt-4.1-mini --provider openrouter
//   npm run grade -- --models mistral:latest --provider ollama
//
// Runs the REAL prompt path — the same assemblePromptParts, the same system
// instruction, the same adapter — against a fixture corpus in
// scripts/grading/corpus/. Nothing is mocked, because the thing being measured
// is how a model behaves on the prompt Vault actually sends.
//
// Grading is deterministic (scripts/grading/grade.mjs): substring checks
// against a corpus we wrote, no judge model. See cases.mjs for why.
//
// Costs real money on a paid provider — one call per model per case. It is
// NOT part of `npm run verify` and never runs in CI. The grader's own logic
// is unit-tested there instead.
//
// Run under tsx, not node: it imports the app's TypeScript directly, so the
// grades come from the same code path a Discord message takes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, "grading", "corpus");

// The corpus has to be in place BEFORE the app's path module is imported —
// it resolves the lore directory once, at load.
process.env.TUSKS_VAULT_LORE_PATH = CORPUS;

const { CASES, gradeCase, summarise } = await import("./grading/grade.mjs");
const { assemblePromptParts, buildSystemInstruction } = await import("../src/server/prompt/assemble.ts");
const { DEFAULT_SYSTEM_INSTRUCTION } = await import("../src/server/prompt/system.ts");
const { getAdapter } = await import("../src/server/llm/registry.ts");
const { getSettings } = await import("../src/server/config/settings.ts");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const provider = arg("provider", "claudeCode");
const models = (arg("models") ?? "").split(",").map(s => s.trim()).filter(Boolean);
const only = arg("only");
const outPath = arg("out");

if (models.length === 0) {
  console.error("Usage: npm run grade -- --provider <p> --models <a,b,c> [--only <caseId>] [--out results.json]");
  process.exit(1);
}

const cases = only ? CASES.filter(c => c.id === only) : CASES;
if (cases.length === 0) {
  console.error(`No case with id "${only}".`);
  process.exit(1);
}

console.log(`Corpus: ${CORPUS}`);
console.log(`Files:  ${fs.readdirSync(CORPUS).join(", ")}`);
console.log(`Cases:  ${cases.length}   Provider: ${provider}   Models: ${models.join(", ")}\n`);

const settings = { ...getSettings(), provider };
const systemPrompt = buildSystemInstruction(DEFAULT_SYSTEM_INSTRUCTION, { botName: "Tusk" });

/** @type {Record<string, {summary: object, results: object[], answers: Record<string,string>}>} */
const byModel = {};

for (const model of models) {
  console.log(`── ${model} ${"─".repeat(Math.max(0, 56 - model.length))}`);
  // explicitProvider, not settings.provider: an active key OUTRANKS that
  // field inside getAdapter, so on any install with a stored key `--provider
  // claudeCode` was silently ignored and the run graded whatever key happened
  // to be active — using the OTHER provider's model ids. A grading tool that
  // quietly measures a different model than the one named is worse than one
  // that refuses to run.
  const { adapter } = getAdapter(
    { ...settings, proModel: model, flashModel: model },
    { explicitProvider: provider }
  );
  const results = [];
  const answers = {};

  for (const c of cases) {
    let text = "";
    let error = null;
    const t0 = Date.now();
    try {
      const parts = await assemblePromptParts(c.question, {});
      const out = await adapter.generate({ systemPrompt, userParts: parts, tier: "flash", modelOverride: model });
      text = out.text ?? "";
    } catch (err) {
      error = err.message ?? String(err);
    }
    const ms = Date.now() - t0;

    // A call that threw is not a wrong answer — it is no answer, and grading
    // it as a content failure would blame the model for a network or quota
    // problem. Recorded distinctly.
    const r = error
      ? { id: c.id, answered: false, correct: null, cited: null, citedRight: null, gapHandled: null, failures: [`error: ${error.slice(0, 120)}`] }
      : gradeCase(c, text);
    results.push(r);
    answers[c.id] = error ? `<error> ${error}` : text;

    const mark = r.failures.length === 0 ? "✓" : "✗";
    console.log(`  ${mark} ${c.id.padEnd(22)} ${String(ms).padStart(6)}ms  ${r.failures.join("; ")}`);
  }

  const summary = summarise(results);
  byModel[model] = { summary, results, answers };
  console.log("");
}

// ── report ───────────────────────────────────────────────────────────────

const pct = v => (v === null ? "  n/a" : `${(v * 100).toFixed(0).padStart(4)}%`);

console.log("\n" + "═".repeat(84));
console.log("MODEL".padEnd(34) + "ANSWERED  ACCURACY  CITED  CITE-OK  GAP-DISCIPLINE  FAILS");
console.log("─".repeat(84));
for (const [model, { summary: s }] of Object.entries(byModel)) {
  console.log(
    model.slice(0, 33).padEnd(34) +
      pct(s.answered).padStart(8) +
      pct(s.accuracy).padStart(10) +
      pct(s.citation).padStart(7) +
      pct(s.citationPrecision).padStart(9) +
      pct(s.gapDiscipline).padStart(16) +
      String(s.failures).padStart(7)
  );
}
console.log("═".repeat(84));
console.log(
  "\nACCURACY is retrieval and comprehension. GAP-DISCIPLINE is refusal: whether the\n" +
    "model declines to invent when the corpus genuinely does not say. They are reported\n" +
    "separately because they fail independently — a model can be accurate and a fabulist."
);

if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify({ provider, cases: cases.map(c => c.id), byModel }, null, 2));
  console.log(`\nFull answers written to ${outPath}`);
}
