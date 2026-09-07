// Running the forge: documents in, a vault out.
//
// The pipeline the CLI script had, lifted into the server so a button can
// drive it. One implementation, two callers — the script and the route — so
// what a user gets from the dashboard is exactly what a maintainer gets from
// the terminal.
//
// Still the MECHANICAL pass: every note body is copied from its source
// verbatim, so nothing here can invent lore. The agent-authoring stage is
// deliberately absent (see workstream H) and belongs after the structure is
// known to be right.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { FORGED_VAULT_MARKER } from "../knowledge/loader";
import { deleteVaultMap } from "../knowledge/obsidian/map";
import { isSessionMaterial } from "../knowledge/sessions";
import { applyDeclarations, parseDeclaredEntities, splitFrontmatter } from "../knowledge/doc-frontmatter";
import { sectionDocument, type LoreUnit } from "../knowledge/units";
import { buildIndexNotes, planForge, type ProposedNote } from "./plan";
import { renderNote } from "./schema";
import { linkAll } from "./link";

const require = createRequire(import.meta.url);
const mammoth = require("mammoth");
const pdf = require("pdf-parse");

/** Formats worth reading as prose. Images and archives are not lore. */
const READABLE = new Set([".md", ".markdown", ".txt", ".docx", ".pdf"]);

// Lives in the knowledge layer now — the forge depends on that layer, and
// the context measurement needs the same predicate. Re-exported because
// callers have been importing it from here.
export { isSessionMaterial } from "../knowledge/sessions";

export interface ForgeProgress {
  phase: "reading" | "planning" | "linking" | "writing" | "verifying" | "done";
  done: number;
  total: number;
  detail?: string;
}

export interface ForgeResult {
  outDir: string;
  documentsRead: number;
  unitsFound: number;
  notesWritten: number;
  linksWritten: number;
  brokenLinks: number;
  /** Notes whose type nobody declared and no document implied. The review
   *  queue — the number a user actually has to act on. */
  needsDecision: number;
  byType: Record<string, number>;
  /** Notes nothing links to. Usually a subject named differently elsewhere. */
  orphans: string[];
  heldBack: number;
  bytesWritten: number;
}

export interface ForgeOptions {
  /** Defaults to `<loreDir>/Vault`. */
  outDir?: string;
  /** Session records are included by default: a vault without them answers
   *  "what happened last session" from fragments and gets it wrong. */
  includeSessions?: boolean;
  /** Overwrite a non-empty target that this tool did not create. Off by
   *  default — the target could be somebody's real vault. */
  force?: boolean;
  onProgress?: (p: ForgeProgress) => void;
}

function walk(root: string, rel = "", out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name.startsWith("~$")) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "logs") continue;
      // Never read a forged vault as source: a re-run would feed the previous
      // run's notes back in and forge notes about notes.
      if (fs.existsSync(path.join(root, childRel, FORGED_VAULT_MARKER))) continue;
      walk(root, childRel, out);
    } else if (entry.isFile() && READABLE.has(path.extname(entry.name).toLowerCase())) {
      out.push(childRel);
    }
  }
  return out;
}

async function readDocument(abs: string, ext: string): Promise<string> {
  if (ext === ".docx") {
    return (await mammoth.extractRawText({ buffer: fs.readFileSync(abs) })).value as string;
  }
  if (ext === ".pdf") {
    return ((await pdf(fs.readFileSync(abs))) as { text: string }).text;
  }
  return fs.readFileSync(abs, "utf-8");
}

/** Refuse to write into a directory that is not ours and is not empty.
 *
 *  Flat shape rather than a discriminated union: strictNullChecks is off in
 *  this project, so a union does not narrow and `reason` would not typecheck
 *  at the call site. */
export interface TargetCheck {
  ok: boolean;
  reason?: string;
}

export function targetIsSafe(outDir: string): TargetCheck {
  if (!fs.existsSync(outDir)) return { ok: true };
  let entries: string[];
  try {
    entries = fs.readdirSync(outDir);
  } catch {
    return { ok: false, reason: "That folder exists but cannot be read." };
  }
  if (entries.length === 0) return { ok: true };
  if (fs.existsSync(path.join(outDir, FORGED_VAULT_MARKER))) return { ok: true };
  return {
    ok: false,
    reason:
      "That folder already has files in it and was not created by this tool. " +
      "Pick an empty folder, or a vault this tool built previously.",
  };
}

export async function runForge(loreDir: string, opts: ForgeOptions = {}): Promise<ForgeResult> {
  const outDir = opts.outDir ?? path.join(loreDir, "Vault");
  const includeSessions = opts.includeSessions !== false;
  const report = opts.onProgress ?? (() => {});

  const safe = targetIsSafe(outDir);
  if (!safe.ok && !opts.force) throw new Error(safe.reason ?? "Cannot write to that folder.");

  // ── read ───────────────────────────────────────────────────────────────
  const files = walk(loreDir);
  const units: LoreUnit[] = [];
  const bodies = new Map<string, string>();
  let read = 0;
  for (const rel of files) {
    report({ phase: "reading", done: read++, total: files.length, detail: rel });
    let raw: string;
    try {
      raw = await readDocument(path.join(loreDir, rel), path.extname(rel).toLowerCase());
    } catch (err) {
      // One unreadable document must not abort a whole vault build.
      console.warn(`[forge] could not read ${rel}:`, (err as Error).message);
      continue;
    }
    const { frontmatter, body } = splitFrontmatter(raw);
    const mine = sectionDocument(rel, body);
    applyDeclarations(mine, parseDeclaredEntities(frontmatter));
    for (const u of mine) {
      units.push(u);
      bodies.set(u.id, body.slice(u.start, u.end));
    }
  }

  // ── plan ───────────────────────────────────────────────────────────────
  report({ phase: "planning", done: 0, total: units.length });
  const plan = planForge(units, {
    skip: u =>
      !includeSessions && isSessionMaterial(u.file) ? "session material — excluded" : null,
  });

  // ── link ───────────────────────────────────────────────────────────────
  report({ phase: "linking", done: 0, total: plan.notes.length });
  for (const note of plan.notes) {
    // A folded form field re-emits its heading; a split part continues the
    // section above it. Without the distinction a character's note reads as
    // one undifferentiated wall of text.
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

  // ── write ──────────────────────────────────────────────────────────────
  const all: ProposedNote[] = [...plan.notes, ...buildIndexNotes(plan)];
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, FORGED_VAULT_MARKER),
    "Generated by Tusk's Vault. Safe to delete; safe to regenerate.\n"
  );

  let bytes = 0;
  let written = 0;
  for (const note of all) {
    report({ phase: "writing", done: written++, total: all.length, detail: note.relPath });
    const full = path.join(outDir, note.relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const text = renderNote(note);
    bytes += text.length;
    fs.writeFileSync(full, text);
  }

  // ── verify ─────────────────────────────────────────────────────────────
  report({ phase: "verifying", done: 0, total: all.length });
  const titles = new Set(all.map(n => n.title));
  let broken = 0;
  for (const rel of walk(outDir).filter(f => f.endsWith(".md"))) {
    const text = fs.readFileSync(path.join(outDir, rel), "utf-8");
    for (const m of text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
      if (!titles.has(m[1])) broken++;
    }
  }

  // The old map describes the vault that WAS here. Left in place it tells the
  // model that notes exist which this run deleted, and the model duly cites
  // them — a citation to a file the user cannot open is worse than no map at
  // all. Dropped rather than rebuilt: rebuilding needs a provider and time,
  // and retrieval already falls back cleanly to whole-vault mode and says so.
  deleteVaultMap(outDir);

  report({ phase: "done", done: all.length, total: all.length });
  return {
    outDir,
    documentsRead: files.length,
    unitsFound: units.length,
    notesWritten: all.length,
    linksWritten: linked.totalLinks,
    brokenLinks: broken,
    needsDecision: plan.needsDecision,
    byType: plan.byType,
    orphans: linked.orphans,
    heldBack: plan.skipped.length,
    bytesWritten: bytes,
  };
}
