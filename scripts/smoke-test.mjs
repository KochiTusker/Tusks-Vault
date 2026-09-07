#!/usr/bin/env node
// End-to-end smoke test against a RUNNING Tusk's Vault server.
//
// This is the "is my install actually working" command — run it after setup
// and before a release. It talks to live provider APIs through the stored
// keys, so it is deliberately NOT part of `npm run verify` and never runs
// in CI.
//
//   node scripts/smoke-test.mjs             # against http://localhost:3000
//   SMOKE_BASE_URL=http://localhost:3001 node scripts/smoke-test.mjs

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

let failures = 0;
function ok(label, detail = "") {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
}
function bad(label, detail = "") {
  failures++;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
}
function note(label, detail = "") {
  console.log(`  · ${label}${detail ? ` — ${detail}` : ""}`);
}

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(30_000) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

console.log(`Smoke-testing the Vault at ${BASE}\n`);

// 1. Server up + bot state.
try {
  const { status, body } = await getJson("/api/status");
  if (status !== 200) throw new Error(`HTTP ${status}`);
  ok("server responds", `bot=${body.botName ?? "?"} status=${body.status ?? "?"} guilds=${body.guilds ?? "?"}`);
} catch (err) {
  bad("server responds", String(err?.message ?? err));
  console.error(`\nNothing else can run without the server. Start it with: npm run dev`);
  process.exit(1);
}

// 2. Lore folder resolved and readable.
try {
  const { status, body } = await getJson("/api/integrations/tusks-lore");
  if (status !== 200) throw new Error(`HTTP ${status}`);
  body.loreRootExists
    ? ok("lore folder resolved", `${body.loreRoot} (${body.resolution})`)
    : bad("lore folder resolved", `${body.loreRoot} does not exist`);
} catch (err) {
  bad("lore folder resolved", String(err?.message ?? err));
}

// 3. Knowledge base loads.
try {
  const { status, body } = await getJson("/api/knowledge");
  if (status !== 200 || !Array.isArray(body)) throw new Error(`HTTP ${status}`);
  (body.length > 0 ? ok : note)("knowledge base", `${body.length} document(s) indexed`);
} catch (err) {
  bad("knowledge base", String(err?.message ?? err));
}

// 4. Every stored key answers its provider's live check.
try {
  const { status, body } = await getJson("/api/keys");
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const keys = body.keys ?? [];
  if (keys.length === 0) {
    note("stored keys", "none configured — the bot can only use env-var keys or Ollama");
  } else {
    for (const k of keys) {
      const res = await fetch(`${BASE}/api/keys/${k.id}/test`, {
        method: "POST",
        signal: AbortSignal.timeout(45_000),
      });
      const verdict = await res.json().catch(() => null);
      verdict?.ok
        ? ok(`key "${k.label}" (${k.provider})`, `${verdict.modelCount} model(s) reachable`)
        : bad(`key "${k.label}" (${k.provider})`, verdict?.error ?? `HTTP ${res.status}`);
    }
  }
} catch (err) {
  bad("stored keys", String(err?.message ?? err));
}

// 5. OpenRouter catalogue reachable (works with no key at all).
try {
  const { status, body } = await getJson("/api/openrouter/models");
  if (status !== 200) throw new Error(body?.error ?? `HTTP ${status}`);
  ok("OpenRouter catalogue", `${body.models?.length ?? 0} models, ${body.policies?.length ?? 0} host policies`);
} catch (err) {
  bad("OpenRouter catalogue", String(err?.message ?? err));
}

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All smoke checks passed.");
