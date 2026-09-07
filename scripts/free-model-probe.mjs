#!/usr/bin/env node
// Are free OpenRouter models actually usable, and what does the output look
// like when they are?
//
// Three things are being tested at once, because they fail independently:
//
//   REACHABLE   does the request route at all? Under Vault's privacy floor
//               most `:free` variants do not — they are free *because* the
//               host keeps prompts. This runs them under the per-model
//               data-sharing opt-in, which is the only way to reach them.
//   ANSWERS     is there any content? A reasoning model given a small output
//               budget can spend all of it thinking and return an empty
//               string, which is a success as far as HTTP is concerned.
//   CLEAN       is the reasoning kept OUT of the answer? Some models put
//               their chain of thought in `content` rather than the separate
//               `reasoning` field, and that lands in a Discord reply.
//
//   npx tsx scripts/free-model-probe.mjs [limit]

const { getCatalogue, isTextModel } = await import("../src/server/llm/openrouter-catalogue.ts");
const { routingFor } = await import("../src/server/llm/openrouter.ts");
const { resolveKeyForProvider } = await import("../src/server/keys/store.ts");

const limit = Number(process.argv[2] ?? 6);
const key = resolveKeyForProvider("openrouter");
if (!key) {
  console.error("✗ no OpenRouter key configured — add one in the dashboard first.");
  process.exit(1);
}

const catalogue = await getCatalogue(false);
const free = (catalogue?.models ?? [])
  .filter(m => m.id.endsWith(":free") || (m.inputPerM === 0 && m.outputPerM === 0))
  // The catalogue's own text-model test rather than a guess from the id. A
  // music model advertises a price of zero and will happily "answer" a lore
  // question — in audio-caption timestamps. It is not a cheap chat model, it
  // is a different product that the price filter alone cannot tell apart.
  .filter(isTextModel)
  .sort((a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0))
  .slice(0, limit);

console.log(`catalogue: ${catalogue?.models?.length ?? 0} models, ${free.length} free candidates tested\n`);

// A tiny lore-shaped question: enough to need the source, small enough that
// a failure is about the model rather than about the prompt.
const SOURCE = `[SOURCE DOCUMENT: Ledger.md]
The harbour at Aldermarch is run by a woman called Sera Vance. She keeps the
tide-ledger and refuses bribes, which has made her unpopular with the
smuggling houses.`;
const QUESTION =
  "You are a lore assistant. Answer ONLY from the source, cite [filename], be brief.\n\n" +
  `${SOURCE}\n\nQUESTION: Who runs the harbour, and why is she unpopular?`;

const rows = [];
for (const model of free) {
  const started = Date.now();
  let verdict = "";
  let detail = "";
  let content = "";
  let reasoning = "";
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: "user", content: QUESTION }],
        max_tokens: 400,
        // The opt-in path: this is what reaching a free model costs.
        provider: routingFor(model.id, [model.id]),
      }),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      verdict = "UNREACHABLE";
      detail = (json.error?.message ?? `HTTP ${res.status}`).slice(0, 90);
    } else {
      const choice = json.choices?.[0]?.message ?? {};
      content = (choice.content ?? "").trim();
      reasoning = (choice.reasoning ?? "").trim();
      if (!content) {
        verdict = "EMPTY";
        detail = reasoning ? `all output went to reasoning (${reasoning.length} chars)` : "no content, no reasoning";
      } else if (/^\s*(<think>|Okay, |Let me |First, I|I need to)/i.test(content)) {
        verdict = "LEAKS";
        detail = "reasoning appears inside content";
      } else {
        verdict = "OK";
        detail = `${content.length} chars${reasoning ? `, reasoning kept separate (${reasoning.length})` : ""}`;
      }
    }
  } catch (err) {
    verdict = "ERROR";
    detail = String(err.message).slice(0, 90);
  }
  const ms = Date.now() - started;
  rows.push({ model, verdict, detail, ms, content });
  console.log(`  ${verdict.padEnd(11)} ${String(ms).padStart(6)}ms  ${model.id}`);
  console.log(`              ${detail}`);
  if (verdict === "OK") console.log(`              "${content.replace(/\s+/g, " ").slice(0, 120)}"`);
}

const by = v => rows.filter(r => r.verdict === v).length;
console.log(`\nreachable and usable : ${by("OK")}/${rows.length}`);
console.log(`empty content        : ${by("EMPTY")}`);
console.log(`reasoning leaked     : ${by("LEAKS")}`);
console.log(`unreachable          : ${by("UNREACHABLE") + by("ERROR")}`);
