#!/usr/bin/env node
// Forge an Obsidian vault from a lore folder — the mechanical pass.
//
// This is stages 1, 2 (auto-accepted), 4 and 5 of the plan in workstream H,
// with stage 3 (agent authoring) deliberately absent. That is the useful
// order to build in: the mechanical pass RESTRUCTURES, copying every body
// verbatim, so it cannot invent anything. It proves the shape of the output
// and the linking, and leaves the one stage that carries hallucination risk
// for after the structure is known to be right.
//
// Run with tsx, because it imports the typed modules directly:
//   npx tsx scripts/lore-forge.mjs <lore-dir> [--out <dir>] [--force]

import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";

const { sectionDocument } = await import("../src/server/knowledge/units.ts");
const { splitFrontmatter, parseDeclaredEntities, applyDeclarations } = await import(
  "../src/server/knowledge/doc-frontmatter.ts"
);
const { planForge, buildIndexNotes } = await import("../src/server/forge/plan.ts");
const { renderNote } = await import("../src/server/forge/schema.ts");
const { linkAll } = await import("../src/server/forge/link.ts");
const { FORGED_VAULT_MARKER } = await import("../src/server/knowledge/loader.ts");
const { deleteVaultMap } = await import("../src/server/knowledge/obsidian/map.ts");

/** Marks a directory as this tool's output. Two jobs: the forge refuses to
 *  write into a non-empty folder that lacks it — the target could be
 *  somebody's vault, and "it looked empty enough" is not a safe basis for
 *  writing into a folder of irreplaceable notes — and the lore walker skips
 *  any directory carrying it, so a vault forged inside the lore folder is not
 *  then ingested as lore alongside the documents it was built from. */
const MARKER = FORGED_VAULT_MARKER;

const argv = process.argv.slice(2);
const loreDir = argv.find(a => !a.startsWith("--"));
const outFlag = argv.indexOf("--out");
const force = argv.includes("--force");
// Sessions are IN by default. Holding them back was a one-off for the first
// trial; with the vault as the live retrieval source, a vault without session
// records answers "what happened last session" from whatever fragments it has
// and gets it wrong. Reading them is not modifying them — the forge only ever
// writes into its own output directory.
const withSessions = !argv.includes("--no-sessions");
if (!loreDir) {
  console.log("usage: npx tsx scripts/lore-forge.mjs <lore-dir> [--out <dir>] [--force]");
  process.exit(1);
}
// A plainly visible folder inside the lore directory. It stays out of the
// corpus because the walker honours the marker file, not because it is
// hidden — a vault nobody can see in their file manager is a vault they
// cannot open in Obsidian or point the dashboard at.
const outDir = outFlag !== -1 ? argv[outFlag + 1] : path.join(loreDir, "Vault");

const SESSION_RE = /(^|\/)sessions?(\/|$)/i;
const isSessionMaterial = rel => SESSION_RE.test(rel.replace(/\\/g, "/"));

// ── read the corpus ──────────────────────────────────────────────────────
function walk(root, rel = "", out = []) {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name.startsWith("~$")) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name === "logs") continue;
      // Never read a forged vault as source. Re-running would otherwise feed
      // the previous run's notes back in and forge notes about notes.
      if (fs.existsSync(path.join(root, childRel, MARKER))) continue;
      walk(root, childRel, out);
    } else if (e.isFile()) {
      out.push(childRel);
    }
  }
  return out;
}

const INGESTIBLE = new Set([".md", ".markdown", ".txt", ".docx"]);
const files = walk(loreDir).filter(f => INGESTIBLE.has(path.extname(f).toLowerCase()));

const units = [];
const bodies = new Map();
let declared = 0;
let attached = 0;
for (const rel of files) {
  const ext = path.extname(rel).toLowerCase();
  let raw;
  try {
    raw =
      ext === ".docx"
        ? (await mammoth.extractRawText({ buffer: fs.readFileSync(path.join(loreDir, rel)) })).value
        : fs.readFileSync(path.join(loreDir, rel), "utf-8");
  } catch (err) {
    console.warn(`  ! could not read ${rel}: ${err.message}`);
    continue;
  }
  const { frontmatter, body } = splitFrontmatter(raw);
  const mine = sectionDocument(rel, body);
  const decls = parseDeclaredEntities(frontmatter);
  declared += decls.length;
  attached += applyDeclarations(mine, decls).matched;
  for (const u of mine) {
    units.push(u);
    bodies.set(u.id, body.slice(u.start, u.end));
  }
}

console.log(`read ${files.length} document(s) → ${units.length} unit(s)`);
console.log(`declarations: ${declared} found, ${attached} attached\n`);

// ── plan ─────────────────────────────────────────────────────────────────
const plan = planForge(units, {
  skip: u =>
    !withSessions && isSessionMaterial(u.file)
      ? "session material — held back by --no-sessions"
      : null,
});

console.log(`proposed notes: ${plan.notes.length}`);
for (const [type, n] of Object.entries(plan.byType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${type}`);
}
console.log(`\nheld back: ${plan.skipped.length} unit(s) (session material)`);
console.log(`needing a type decision: ${plan.needsDecision}`);

// ── link ─────────────────────────────────────────────────────────────────
// A note reassembled from several units carries all their text, in order —
// with the heading back above any form field that was folded into it.
for (const note of plan.notes) {
  note.body = note.segments
    .map(s => {
      const text = (bodies.get(s.unitId) ?? "").trim();
      return s.heading && text ? `## ${s.heading}\n\n${text}` : text;
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
const linked = linkAll(
  plan.notes.map(n => ({
    id: n.unitId,
    title: n.title,
    aliases: n.frontmatter.aliases,
    body: n.body,
  }))
);
for (const note of plan.notes) note.body = linked.bodies.get(note.unitId) ?? note.body;
console.log(`\nlinks written: ${linked.totalLinks}   notes nothing links to: ${linked.orphans.length}`);

// ── write ────────────────────────────────────────────────────────────────
if (fs.existsSync(outDir)) {
  const existing = fs.readdirSync(outDir);
  if (existing.length > 0 && !fs.existsSync(path.join(outDir, MARKER)) && !force) {
    console.error(
      `\n✗ ${outDir} is not empty and was not created by this tool.\n` +
        `  Refusing to write into it. Use --force only if you are certain.`
    );
    process.exit(1);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, MARKER),
  "Generated by scripts/lore-forge.mjs. Safe to delete; safe to regenerate.\n"
);

const all = [...plan.notes, ...buildIndexNotes(plan)];
let bytes = 0;
for (const note of all) {
  const full = path.join(outDir, note.relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const text = renderNote(note);
  bytes += text.length;
  fs.writeFileSync(full, text);
}

// ── verify ───────────────────────────────────────────────────────────────
const written = walk(outDir).filter(f => f.endsWith(".md"));
const titles = new Set(all.map(n => n.title));
let broken = 0;
for (const rel of written) {
  const text = fs.readFileSync(path.join(outDir, rel), "utf-8");
  for (const m of text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    if (!titles.has(m[1])) broken++;
  }
}

// Every source unit that was planned must have produced a file, and the
// content must have survived: this is the check that the restructure lost
// nothing, which is the only guarantee the mechanical pass actually offers.
const plannedChars = plan.notes.reduce((n, x) => n + x.unitIds.reduce((m, id) => m + (bodies.get(id) ?? "").length, 0), 0);
const heldChars = plan.skipped.reduce((n, s) => n + (bodies.get(s.unitId) ?? "").length, 0);

// The previous map describes notes this run may have deleted. A stale map
// makes the bot cite files the user cannot open, so drop it and let the
// vault-map build put it back.
deleteVaultMap(outDir);

console.log(`\n✓ wrote ${all.length} note(s), ${(bytes / 1024).toFixed(0)} KB → ${outDir}`);
console.log(`  files on disk        : ${written.length}`);
console.log(`  broken wikilinks     : ${broken}`);
console.log(`  source chars planned : ${plannedChars.toLocaleString()}`);
console.log(`  source chars held    : ${heldChars.toLocaleString()} (session material)`);
if (linked.orphans.length > 0) {
  console.log(`\n  nothing links to ${linked.orphans.length} note(s) — usually a subject named`);
  console.log(`  differently elsewhere, worth an alias:`);
  for (const o of linked.orphans.slice(0, 10)) console.log(`    · ${o}`);
  if (linked.orphans.length > 10) console.log(`    … ${linked.orphans.length - 10} more`);
}
