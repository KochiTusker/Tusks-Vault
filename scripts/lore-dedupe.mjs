#!/usr/bin/env node
// Report — and optionally remove — redundant files in a lore folder.
//
// Two kinds of redundancy show up in a folder that has been through a few
// tools: editor/tool backups (`.bak`, `.bak2`, Word's `~$` lock files), and
// genuine duplicate documents under different names.
//
// Nothing is deleted without being shown to be redundant first, and
// "redundant" has a specific meaning here: every non-trivial line of the
// candidate also appears in the file it is a backup OF. A backup that has
// drifted — holding a paragraph the live file lost — is reported as
// DIVERGENT and left alone, because at that point it is not a backup, it is
// the only copy of something.
//
// Usage:
//   node scripts/lore-dedupe.mjs report <lore-dir>
//   node scripts/lore-dedupe.mjs apply  <lore-dir>   (deletes only SAFE ones)

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/** Directories never examined: snapshots are copies by design, and session
 *  material is the campaign's primary record. */
const SKIP_DIRS = new Set([".snapshots", "logs"]);

/** Suffixes that mark a file as a tool's leftover rather than a document. */
const BACKUP_RE = /\.bak\d*$/i;
/** Word writes a `~$name.docx` lock file while a document is open, and leaves
 *  it behind on a crash. It is a few hundred bytes of metadata, not a
 *  document, and it fails ingestion on every question. */
const LOCK_RE = /^~\$/;

function walk(root, rel = "", out = []) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walk(root, childRel, out);
    } else if (entry.isFile()) {
      out.push(childRel);
    }
  }
  return out;
}

const norm = s => s.replace(/\r\n/g, "\n").trim();
const sha = s => createHash("sha256").update(s).digest("hex");

/** Lines worth comparing: long enough to be content rather than punctuation. */
function contentLines(text) {
  return norm(text)
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length >= 25);
}

/**
 * Classify one backup against the document it backs up.
 *
 * `IDENTICAL`  byte-for-byte the same → pure waste.
 * `SUBSUMED`   every content line also appears in the live file → an older
 *              revision, safe to drop.
 * `DIVERGENT`  holds lines the live file does not → NOT a backup any more.
 * `ORPHAN`     the file it backs up is gone → keep; it may be the only copy.
 */
export function classifyBackup(backupText, liveText) {
  if (liveText === null) return { verdict: "ORPHAN", uniqueLines: [] };
  if (sha(norm(backupText)) === sha(norm(liveText))) return { verdict: "IDENTICAL", uniqueLines: [] };
  const live = new Set(contentLines(liveText));
  const unique = contentLines(backupText).filter(l => !live.has(l));
  return { verdict: unique.length === 0 ? "SUBSUMED" : "DIVERGENT", uniqueLines: unique };
}

export function analyse(loreDir) {
  const files = walk(loreDir);
  const read = rel => {
    try {
      return fs.readFileSync(path.join(loreDir, rel), "utf-8");
    } catch {
      return null;
    }
  };

  const backups = [];
  for (const rel of files) {
    const base = path.basename(rel);
    if (LOCK_RE.test(base)) {
      backups.push({ rel, of: null, verdict: "LOCKFILE", uniqueLines: [], bytes: fs.statSync(path.join(loreDir, rel)).size });
      continue;
    }
    if (!BACKUP_RE.test(base)) continue;
    const liveRel = rel.replace(BACKUP_RE, "");
    const backupText = read(rel);
    const liveText = files.includes(liveRel) ? read(liveRel) : null;
    const { verdict, uniqueLines } = classifyBackup(backupText ?? "", liveText);
    backups.push({ rel, of: liveRel, verdict, uniqueLines, bytes: fs.statSync(path.join(loreDir, rel)).size });
  }

  // Genuine duplicates: two non-backup documents with identical content.
  const byHash = new Map();
  for (const rel of files) {
    const base = path.basename(rel);
    if (BACKUP_RE.test(base) || LOCK_RE.test(base)) continue;
    const text = read(rel);
    if (text === null) continue;
    const key = sha(norm(text));
    (byHash.get(key) ?? byHash.set(key, []).get(key)).push(rel);
  }
  const duplicates = [...byHash.values()].filter(group => group.length > 1);

  return { backups, duplicates, total: files.length };
}

/** Verdicts that may be deleted automatically. DIVERGENT and ORPHAN never
 *  are: both mean the file might hold the only copy of something. */
const SAFE_TO_DELETE = new Set(["IDENTICAL", "SUBSUMED", "LOCKFILE"]);

/** Session records are the campaign's primary account of what happened —
 *  the one category where a lost file cannot be reconstructed from anything
 *  else in the folder. Cleanup reports on them and removes nothing unless
 *  asked for explicitly. */
const SESSION_DIR_RE = /(^|\/)sessions?(\/|$)/i;
export const isSessionMaterial = rel => SESSION_DIR_RE.test(String(rel).split("\\").join("/"));

function main() {
  const [command, loreDir] = process.argv.slice(2);
  if (!command || !loreDir) {
    console.log("usage: node scripts/lore-dedupe.mjs <report|apply> <lore-dir>");
    process.exit(1);
  }
  const { backups, duplicates, total } = analyse(loreDir);

  console.log(`scanned ${total} file(s) in ${loreDir}\n`);
  if (backups.length === 0) console.log("no backup or lock files found");
  for (const b of backups) {
    const size = `${(b.bytes / 1024).toFixed(0)} KB`.padStart(7);
    console.log(`  ${b.verdict.padEnd(10)} ${size}  ${b.rel}`);
    if (b.verdict === "DIVERGENT") {
      console.log(`             ↳ holds ${b.uniqueLines.length} line(s) absent from ${b.of} — KEPT`);
      for (const l of b.uniqueLines.slice(0, 3)) console.log(`               "${l.slice(0, 90)}"`);
    }
  }

  console.log(`\nduplicate documents: ${duplicates.length} group(s)`);
  for (const group of duplicates) console.log(`  identical: ${group.join("  ==  ")}`);

  const includeSessions = process.argv.includes("--include-sessions");
  const held = backups.filter(
    b => SAFE_TO_DELETE.has(b.verdict) && isSessionMaterial(b.rel) && !includeSessions
  );
  const removable = backups.filter(
    b => SAFE_TO_DELETE.has(b.verdict) && (includeSessions || !isSessionMaterial(b.rel))
  );
  if (held.length > 0) {
    console.log(`\nheld back (session material — pass --include-sessions to remove):`);
    for (const b of held) console.log(`  ${b.verdict.padEnd(10)} ${b.rel}`);
  }
  const bytes = removable.reduce((n, b) => n + b.bytes, 0);
  console.log(`\nsafe to delete: ${removable.length} file(s), ${(bytes / 1024).toFixed(0)} KB`);

  if (command === "apply") {
    for (const b of removable) fs.rmSync(path.join(loreDir, b.rel), { force: true });
    console.log(`✓ deleted ${removable.length} file(s)`);
    const kept = backups.filter(b => !SAFE_TO_DELETE.has(b.verdict));
    if (kept.length > 0) console.log(`  kept ${kept.length} that may hold unique content (see above)`);
  } else {
    console.log("(report only — re-run with `apply` to delete)");
  }
}

if (process.argv[1]?.endsWith("lore-dedupe.mjs")) main();
