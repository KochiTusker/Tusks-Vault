// Is this question STABLE on this model?
//
//   npm run probe:refusal -- --models sonnet,opus,haiku --passes 3 --prompt "..."
//   npm run probe:refusal -- --models sonnet --prompt-file question.txt --out probe.json
//
// Sampling on the Claude Code CLI cannot be pinned — it exposes no
// temperature, top-p or seed flag — so a question sitting near a model's own
// refusal boundary is answered on one run and declined on the next. That
// produces the worst possible user experience: not a consistent "no", which a
// DM can design around, but a coin-flip that looks like the bot being
// unreliable.
//
// This runs the same question N times per model and reports how often it was
// declined, using the same llm/refusal.ts detector the live path uses. The
// number that matters is not "did it refuse" but "did it do the same thing
// every time".
//
// Three outcomes are counted, not two, and the distinction matters more than
// it looks. A model can fail to answer WITHOUT declining: Rule 3 makes a
// question that cannot be sourced return the lore-gap phrase, and a judgement
// question ("which of them is most X") is never in the sources by
// construction. Collapsing that into "answered" reports a model that never
// answers as perfectly cooperative.
//
//   answered   Gave a real answer.
//   declined   Said no, in its own voice. llm/refusal.ts detected it.
//   lore-gap   Emitted Rule 3's phrase. Not a refusal — and usually a sign
//              Speculative Mode is off rather than anything about safety.
//
// The verdict is about CONSISTENCY. Always-declines is designable-around;
// varying between runs is not.
//
// Answers the model to the REAL configured lore source, because a question
// about a specific campaign cannot be probed against a fixture corpus. Output
// therefore contains campaign material — write it somewhere untracked.
//
// Run under tsx, not node: it imports the app's TypeScript directly, so the
// prompt is the one a Discord message actually produces.

import fs from "node:fs";

const { assemblePromptParts, buildSystemInstruction, retrievalOpts } = await import(
  "../src/server/prompt/assemble.ts"
);
const { DEFAULT_SYSTEM_INSTRUCTION, SPECULATIVE_OVERRIDE, buildGuardrailsNudge } =
  await import("../src/server/prompt/system.ts");
const { getAdapter } = await import("../src/server/llm/registry.ts");
const { getSettings } = await import("../src/server/config/settings.ts");
const { detectRefusal } = await import("../src/server/llm/refusal.ts");
const { responseContainsLoreGapTrigger } = await import("../src/server/lore-gaps/store.ts");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const provider = arg("provider", "claudeCode");
const models = (arg("models") ?? "").split(",").map(s => s.trim()).filter(Boolean);
const passes = Math.max(1, Number(arg("passes", "3")) || 3);
// --engagement off drops the standing ENGAGEMENT clause. Run a question both
// ways and the difference is the clause's effect on THAT question, which is
// the only way to know whether it is earning its place rather than being
// assumed to.
const engagement = arg("engagement", "on") !== "off";
// Overrides the stored Speculative Mode for this run only — nothing is
// written back. It is the single most informative variable for a judgement
// question, because Rule 3 and a safety refusal look identical from the
// outside and are fixed by completely different things.
const specArg = arg("speculative");

const promptFile = arg("prompt-file");
const prompt = promptFile ? fs.readFileSync(promptFile, "utf-8").trim() : arg("prompt");
const outPath = arg("out");

if (models.length === 0 || !prompt) {
  console.error(
    "Usage: npm run probe:refusal -- --models <a,b,c> --prompt \"<question>\" " +
      "[--prompt-file f] [--passes N] [--provider p] [--out results.json]"
  );
  process.exit(1);
}

const settings = getSettings();
// The prompt a real message produces, including whatever the DM has toggled —
// probing a different prompt than the bot sends would measure nothing useful.
const systemPrompt = buildSystemInstruction(settings.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION, {
  botName: settings.botName,
  speculativeMode: specArg === null ? settings.speculativeMode : specArg !== "off",
  speculativeOverride: SPECULATIVE_OVERRIDE,
  guardrailsNudge: buildGuardrailsNudge(settings.guardrails),
  engagementClause: engagement ? undefined : "",
});

console.log(`Provider:   ${provider}   Models: ${models.join(", ")}`);
console.log(`Passes:     ${passes} each   Engagement clause: ${engagement ? "ON (as shipped)" : "OFF"}`);
console.log(`Speculative: ${(specArg === null ? settings.speculativeMode : specArg !== "off") ? "on" : "off"}${specArg !== null ? " (overridden)" : ""}   Guardrails: ${
  Object.values(settings.guardrails ?? {}).some(Boolean) ? "some on" : "all off"
}`);
console.log(`Prompt:     ${JSON.stringify(prompt.slice(0, 90))}\n`);

const report = { measuredAt: new Date().toISOString(), provider, passes, prompt, byModel: {} };

for (const model of models) {
  console.log(`── ${model} ${"─".repeat(Math.max(0, 56 - model.length))}`);
  const { adapter } = getAdapter(
    { ...settings, proModel: model, flashModel: model },
    { explicitProvider: provider }
  );

  const runs = [];
  for (let pass = 1; pass <= passes; pass++) {
    const parts = await assemblePromptParts(prompt, retrievalOpts(settings));
    const t0 = Date.now();
    let text = "";
    let error = null;
    try {
      const out = await adapter.generate({
        systemPrompt,
        userParts: parts,
        tier: settings.defaultTier ?? "flash",
        modelOverride: model,
      });
      text = out.text ?? "";
    } catch (err) {
      error = err.message ?? String(err);
    }
    const ms = Date.now() - t0;

    // Three outcomes, not two. A decline and a lore-gap punt are BOTH
    // non-answers, and collapsing the punt into "answered" was wrong in a way
    // that inverted a real conclusion: a model that emits Rule 3's phrase
    // every time looks perfectly cooperative in a two-state summary while
    // never actually answering the question.
    //
    // An error is a third thing again — delivery failing, not the model
    // deciding anything. Reporting a quota exhaustion as a censorious model
    // would blame the wrong component.
    const refusal = error ? { refused: false } : detectRefusal(text);
    const loreGap = !error && !refusal.refused && responseContainsLoreGapTrigger(text);
    const outcome = error ? "error" : refusal.refused ? "declined" : loreGap ? "loregap" : "answered";
    runs.push({ pass, ms, error, outcome, kind: refusal.kind, text });

    const mark = { error: "ERR ", declined: "NO  ", loregap: "GAP ", answered: "OK  " }[outcome];
    const note = {
      error: (error ?? "").slice(0, 60),
      declined: `declined (${refusal.kind})`,
      loregap: "no answer — emitted the lore-gap phrase",
      answered: "answered",
    }[outcome];
    console.log(`  ${mark} pass ${pass}  ${String(ms).padStart(6)}ms  ${note}`);
  }

  const usable = runs.filter(r => r.outcome !== "error");
  const count = o => usable.filter(r => r.outcome === o).length;
  const declined = count("declined");
  const gaps = count("loregap");
  const answered = count("answered");

  // "Stable" is about doing the SAME thing every time, whatever that thing is.
  // A model that always declines is designable-around; one that varies is not.
  const distinct = ["declined", "loregap", "answered"].filter(o => count(o) > 0);
  const verdict =
    usable.length === 0
      ? "no data"
      : distinct.length > 1
        ? "UNSTABLE — varies between runs"
        : { declined: "STABLE — always declines", loregap: "STABLE — never answers (lore gap)", answered: "STABLE — answers" }[distinct[0]];

  report.byModel[model] = { runs, answered, declined, gaps, usable: usable.length, verdict };
  console.log(
    `  → ${answered} answered / ${declined} declined / ${gaps} lore-gap of ${usable.length}   ${verdict}\n`
  );
}

console.log("Summary");
for (const [model, r] of Object.entries(report.byModel)) {
  console.log(
    `  ${model.padEnd(10)} answered ${r.answered}  declined ${r.declined}  lore-gap ${r.gaps}   ${r.verdict}`
  );
}

if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath} — contains campaign material; keep it untracked.`);
}
