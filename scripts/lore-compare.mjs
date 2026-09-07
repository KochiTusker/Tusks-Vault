#!/usr/bin/env node
// Side-by-side: what does one question cost against a flat lore folder, and
// against the same lore atomised into a vault?
//
// Deterministic — no model is called to produce these numbers. The prompt
// footprint IS the cost, and it can be computed exactly, so the comparison
// does not inherit a model's variance or a network's mood. Answer quality is
// a separate test; this one answers "how many tokens", which is the question
// that decides whether a campaign fits in a model at all.
//
//   npx tsx scripts/lore-compare.mjs <flat-lore-dir> <vault-dir> [questions...]

import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";

const { sectionDocument } = await import("../src/server/knowledge/units.ts");
const { splitFrontmatter, parseDeclaredEntities, applyDeclarations } = await import(
  "../src/server/knowledge/doc-frontmatter.ts"
);
const { buildSurfaceIndex, resolveQuestion, extractCandidateNames, surfaceIndexOfNames, mergeSurfaceIndexes, unresolvedUnitId } =
  await import("../src/server/knowledge/surface-index.ts");
const { buildMentionIndex, unitsMentioning } = await import("../src/server/knowledge/mention-index.ts");
const { extractPassages } = await import("../src/server/knowledge/passages.ts");
const { findSessions, resolveTemporalQuery } = await import("../src/server/knowledge/sessions.ts");
const { detectCohortQuery, resolveCohort } = await import("../src/server/knowledge/cohort.ts");
const { CHARS_PER_TOKEN } = await import("../src/server/knowledge/corpus-stats.ts");

const tok = chars => Math.ceil(chars / CHARS_PER_TOKEN);
const k = chars => `${(tok(chars) / 1000).toFixed(1)}k`;

const SEP = "=".repeat(78);
const [flatDir, vaultDir, ...rest] = process.argv.slice(2);
if (!flatDir || !vaultDir) {
  console.log("usage: npx tsx scripts/lore-compare.mjs <flat-lore-dir> <vault-dir> [questions...]");
  process.exit(1);
}

// Flags must not become questions: `--answer` was being asked as one.
const questionArgs = rest.filter(a => !a.startsWith("--"));
const QUESTIONS = questionArgs.length > 0 ? questionArgs : [
  "Who is the harbourmaster?",
  "What happened last session?",
  "Which of the party is the most reckless?",
];

const INGESTIBLE = new Set([".md", ".markdown", ".txt", ".docx"]);

/** Walk a corpus. `allowDotRoot` lets the vault live in a dot-directory
 *  without being skipped as scaffolding. */
function walk(root, rel = "", out = []) {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name.startsWith("~$") || e.name === "logs") continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, childRel, out);
    else if (e.isFile() && INGESTIBLE.has(path.extname(e.name).toLowerCase())) out.push(childRel);
  }
  return out;
}

async function loadCorpus(dir) {
  const units = [];
  const bodies = new Map();
  let rawChars = 0;
  for (const rel of walk(dir)) {
    let raw;
    try {
      raw =
        path.extname(rel).toLowerCase() === ".docx"
          ? (await mammoth.extractRawText({ buffer: fs.readFileSync(path.join(dir, rel)) })).value
          : fs.readFileSync(path.join(dir, rel), "utf-8");
    } catch {
      continue;
    }
    rawChars += raw.length;
    const { frontmatter, body } = splitFrontmatter(raw);
    const mine = sectionDocument(rel, body);
    applyDeclarations(mine, parseDeclaredEntities(frontmatter));
    for (const u of mine) {
      units.push(u);
      bodies.set(u.id, body.slice(u.start, u.end));
    }
  }
  const surface = buildSurfaceIndex(units);
  const mentions = buildMentionIndex(units, surface, id => bodies.get(id) ?? null);
  return { dir, units, bodies, surface, mentions, rawChars, sessions: findSessions(units) };
}

/** Every form belonging to a resolved subject, so aliases are followed. */
function formsOfSubject(corpus, s) {
  const forms = new Set([s.form]);
  for (const [form, entry] of corpus.surface.forms) {
    if (entry.unitIds.some(id => s.unitIds.includes(id))) forms.add(form);
  }
  return [...forms];
}

/** The one-line-per-unit map: what the model needs to know EXISTS. */
function mapChars(corpus) {
  return corpus.units.map(u => `- ${u.id} [${u.type ?? "?"}] — ${u.title}`).join("\n").length;
}

/**
 * The retrieval plan's footprint for one question.
 *
 * Mirrors the tiers in workstream G: resolved subjects in full, mention
 * passages, temporal sessions, cohort members. Reported per tier so a
 * surprising total can be attributed rather than guessed at.
 */
function planFootprint(corpus, question) {
  const subjects = resolveQuestion(corpus.surface, question);
  const candidates = extractCandidateNames(corpus.surface, question);
  const adhoc = surfaceIndexOfNames(candidates);
  const scanIndex = mergeSurfaceIndexes(corpus.surface, adhoc);
  const subjIds = new Set([...subjects.flatMap(s => s.unitIds), ...candidates.map(unresolvedUnitId)]);
  const realIds = new Set(subjects.flatMap(s => s.unitIds));

  let subjectChars = 0;
  for (const id of realIds) subjectChars += (corpus.bodies.get(id) ?? "").length;

  // Temporal tier
  const temporal = resolveTemporalQuery(question, corpus.sessions);
  let sessionChars = 0;
  for (const s of temporal.sessions) {
    for (const id of s.unitIds) sessionChars += (corpus.bodies.get(id) ?? "").length;
  }

  // Cohort tier
  const cohortQ = detectCohortQuery(question);
  let cohortChars = 0;
  let cohortSize = 0;
  if (cohortQ.isCohort) {
    const sessionTexts = corpus.sessions.map(s => ({
      session: `${s.campaign}#${s.number}`,
      text: s.unitIds.map(id => corpus.bodies.get(id) ?? "").join("\n"),
    }));
    const cohort = resolveCohort({ sessionTexts, surface: corpus.surface });
    cohortSize = cohort.members.length;
    for (const m of cohort.members) {
      if (m.unitId) cohortChars += Math.min((corpus.bodies.get(m.unitId) ?? "").length, 4000);
    }
  }

  // Mention passages
  let passageChars = 0;
  let passages = 0;
  if (subjIds.size > 0) {
    const mentioning = unitsMentioning(
      corpus.mentions,
      subjects.map(s => ({ id: s.unitIds[0], forms: formsOfSubject(corpus, s) })),
      realIds
    );
    if (candidates.length > 0) {
      const seen = new Set(mentioning.map(m => m.unitId));
      for (const u of corpus.units) {
        if (seen.has(u.id) || realIds.has(u.id)) continue;
        const b = corpus.bodies.get(u.id);
        if (b && extractPassages(b, adhoc, { limit: 1 }).length > 0) {
          mentioning.push({ unitId: u.id, count: 1, subjectsMatched: 1 });
        }
      }
    }
    for (const m of mentioning.slice(0, 40)) {
      const b = corpus.bodies.get(m.unitId);
      if (!b) continue;
      const ps = extractPassages(b, scanIndex, { subjects: subjIds, limit: 4 });
      passages += ps.length;
      passageChars += ps.reduce((n, p) => n + p.text.length + 40, 0);
    }
  }

  return {
    resolved: subjects.length + candidates.length,
    subjectChars,
    passageChars,
    passages,
    sessionChars,
    sessions: temporal.sessions.length,
    cohortChars,
    cohortSize,
    total: subjectChars + passageChars + sessionChars + cohortChars,
  };
}

const flat = await loadCorpus(flatDir);
const vault = await loadCorpus(vaultDir);

console.log(`FLAT   ${flatDir}`);
console.log(`  ${flat.units.length} unit(s), ${flat.rawChars.toLocaleString()} raw chars ~${k(flat.rawChars)} tokens`);
console.log(`VAULT  ${vaultDir}`);
console.log(`  ${vault.units.length} unit(s), ${vault.rawChars.toLocaleString()} raw chars ~${k(vault.rawChars)} tokens`);
console.log(`  whole-vault map: ${k(mapChars(vault))} tokens (flat map would be ${k(mapChars(flat))})`);

// Today's behaviour: concatenate everything, capped.
const KB_CAP = 500_000;
const todayChars = Math.min(flat.rawChars, KB_CAP);
console.log(`\nTODAY (concatenate + 500k cap): ${k(todayChars)} tokens per question`);
console.log(`  ${flat.rawChars > KB_CAP ? `${(((flat.rawChars - KB_CAP) / flat.rawChars) * 100).toFixed(0)}% of the corpus never reaches the model` : "whole corpus fits"}`);

console.log(`\n${"=".repeat(78)}`);
const rows = [];
for (const q of QUESTIONS) {
  const f = planFootprint(flat, q);
  const v = planFootprint(vault, q);
  rows.push({ q, f, v });
  console.log(`\nQ: ${q}`);
  const line = (label, p) =>
    `  ${label.padEnd(7)} subj ${k(p.subjectChars).padStart(6)}  pass ${k(p.passageChars).padStart(6)} (${String(p.passages).padStart(3)})  sess ${k(p.sessionChars).padStart(6)} (${p.sessions})  cohort ${k(p.cohortChars).padStart(6)} (${p.cohortSize})  =  ${k(p.total).padStart(6)}`;
  console.log(line("flat", f));
  console.log(line("vault", v));
  const vs = v.total > 0 ? (todayChars / v.total).toFixed(0) : "—";
  console.log(`  vs today: ${vs}x smaller` + (v.total > f.total ? `   (vault costs ${(v.total / f.total).toFixed(2)}x the flat plan)` : v.total < f.total ? `   (vault is ${(f.total / v.total).toFixed(2)}x cheaper than the flat plan)` : ""));
}

// ── optional: actually ask a model, through the Claude Code subscription ──
if (process.argv.includes("--answer")) {
  const { runClaudeCode } = await import("../src/server/llm/claude-code-cli.ts");
  const { buildPlanPrompt, buildFullPrompt, ask } = await import("./lib/answer-compare.mjs");

  const deps = {
    resolveQuestion,
    extractCandidateNames,
    surfaceIndexOfNames,
    mergeSurfaceIndexes,
    unresolvedUnitId,
    unitsMentioning,
    extractPassages,
    resolveTemporalQuery,
    detectCohortQuery,
    resolveCohort,
    formsOfSubject,
  };

  console.log(SEP);
  console.log("ANSWER COMPARISON - Claude Code subscription (model: sonnet)");
  console.log(SEP);
  for (const q of QUESTIONS) {
    console.log("");
    console.log("Q: " + q);
    console.log("-".repeat(78));
    const runs = [
      await ask(runClaudeCode, "today (whole corpus)", buildFullPrompt(flat, q)),
      await ask(runClaudeCode, "flat + retrieval", buildPlanPrompt(flat, q, deps)),
      await ask(runClaudeCode, "vault + retrieval", buildPlanPrompt(vault, q, deps)),
    ];
    for (const r of runs) {
      console.log("");
      console.log("--- " + r.label + " - " + k(r.chars) + " tokens, " + (r.ms / 1000).toFixed(1) + "s");
      const indented = r.text.slice(0, 900).split(String.fromCharCode(10)).map(l => "    " + l);
      console.log(indented.join(String.fromCharCode(10)));
    }
  }
}

const sum = key => rows.reduce((n, r) => n + r[key].total, 0);
console.log(`\n${"=".repeat(78)}`);
console.log(`across ${rows.length} question(s):`);
console.log(`  today, concatenated : ${k(todayChars * rows.length)} tokens`);
console.log(`  flat + retrieval    : ${k(sum("f"))} tokens  (${(todayChars * rows.length / Math.max(1, sum("f"))).toFixed(0)}x better)`);
console.log(`  vault + retrieval   : ${k(sum("v"))} tokens  (${(todayChars * rows.length / Math.max(1, sum("v"))).toFixed(0)}x better)`);
