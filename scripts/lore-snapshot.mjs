#!/usr/bin/env node
// Snapshot and restore a lore folder.
//
// Written for the vault-forge trials, which rewrite a lore folder in place
// and need to be run repeatedly from the same starting point. It is also the
// safety net the forge itself should take before it transforms anything: the
// forge writes into a folder holding work that may exist nowhere else, and
// "you can undo this" has to be true before the button is offered.
//
// Deliberately a plain recursive copy rather than anything clever. A lore
// folder is a few megabytes of prose; the fastest possible restore matters
// far less than being able to see exactly what a snapshot contains with `ls`,
// and to recover one by hand if this script is unavailable.
//
// Usage:
//   node scripts/lore-snapshot.mjs snapshot <lore-dir> [label]
//   node scripts/lore-snapshot.mjs list     <lore-dir>
//   node scripts/lore-snapshot.mjs restore  <lore-dir> <name>
//   node scripts/lore-snapshot.mjs diff     <lore-dir> <name>

import fs from "node:fs";
import path from "node:path";

/** Snapshots live inside the lore folder, under a dot-directory.
 *
 *  Inside, because a snapshot of someone's campaign must not be scattered
 *  somewhere they will not think to look — and because it then travels with
 *  the folder if they move or sync it. Dot-prefixed, because Vault's own
 *  walker skips dot-directories, so snapshots never become lore that the bot
 *  reads back as canon. */
export const SNAPSHOT_DIR = ".snapshots";

/** A manifest per snapshot, so a restore can refuse to write a snapshot back
 *  into a folder it was not taken from. */
const MANIFEST = ".snapshot.json";

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

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
      if (childRel === SNAPSHOT_DIR) continue; // never snapshot the snapshots
      walk(root, childRel, out);
    } else if (entry.isFile()) {
      out.push(childRel);
    }
  }
  return out;
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function snapshotRoot(loreDir) {
  return path.join(loreDir, SNAPSHOT_DIR);
}

function requireDir(dir, what) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`${what} not found: ${dir}`);
}

export function takeSnapshot(loreDir, label, now) {
  requireDir(loreDir, "lore folder");
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeLabel = String(label || "manual").replace(/[^A-Za-z0-9._-]+/g, "-");
  const name = `${stamp}-${safeLabel}`;
  const dest = path.join(snapshotRoot(loreDir), name);
  if (fs.existsSync(dest)) fail(`snapshot already exists: ${name}`);

  const files = walk(loreDir);
  let bytes = 0;
  for (const rel of files) {
    const from = path.join(loreDir, rel);
    bytes += fs.statSync(from).size;
    copyFile(from, path.join(dest, "files", rel));
  }
  fs.writeFileSync(
    path.join(dest, MANIFEST),
    `${JSON.stringify({ name, takenAt: now.toISOString(), root: path.resolve(loreDir), files: files.length, bytes, label: safeLabel }, null, 2)}\n`
  );
  return { name, files: files.length, bytes, dest };
}

function readManifest(loreDir, name) {
  const file = path.join(snapshotRoot(loreDir), name, MANIFEST);
  if (!fs.existsSync(file)) fail(`no such snapshot: ${name}`);
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

export function listSnapshots(loreDir) {
  const root = snapshotRoot(loreDir);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(root, e.name, MANIFEST)))
    .map(e => readManifest(loreDir, e.name))
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}

/**
 * Restore a snapshot over the lore folder.
 *
 * Files added since the snapshot are removed, so a restore is a true revert
 * rather than a merge — the whole point is a repeatable starting state, and a
 * leftover file from the previous run would quietly change the next result.
 * Snapshots themselves are never touched.
 */
export function restoreSnapshot(loreDir, name) {
  const manifest = readManifest(loreDir, name);
  if (path.resolve(loreDir) !== manifest.root) {
    fail(
      `snapshot "${name}" was taken from ${manifest.root}, not ${path.resolve(loreDir)}. ` +
        `Restoring it here would write one campaign's files over another's.`
    );
  }
  const from = path.join(snapshotRoot(loreDir), name, "files");
  const wanted = new Set(walk(from));
  const present = walk(loreDir);

  let removed = 0;
  for (const rel of present) {
    if (wanted.has(rel)) continue;
    fs.rmSync(path.join(loreDir, rel), { force: true });
    removed++;
  }
  for (const rel of wanted) copyFile(path.join(from, rel), path.join(loreDir, rel));

  // Prune directories the removals emptied, so a restored folder looks like
  // the snapshot rather than like the snapshot plus a maze of empty dirs.
  const prune = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === SNAPSHOT_DIR) continue;
      const child = path.join(dir, entry.name);
      prune(child);
      if (fs.readdirSync(child).length === 0) fs.rmdirSync(child);
    }
  };
  prune(loreDir);

  return { restored: wanted.size, removed };
}

/** What changed since a snapshot, without restoring it. */
export function diffSnapshot(loreDir, name) {
  readManifest(loreDir, name);
  const from = path.join(snapshotRoot(loreDir), name, "files");
  const before = new Set(walk(from));
  const after = new Set(walk(loreDir));
  const added = [...after].filter(f => !before.has(f)).sort();
  const deleted = [...before].filter(f => !after.has(f)).sort();
  const changed = [...after]
    .filter(f => before.has(f))
    .filter(f => {
      const a = fs.statSync(path.join(from, f));
      const b = fs.statSync(path.join(loreDir, f));
      return a.size !== b.size || !fs.readFileSync(path.join(from, f)).equals(fs.readFileSync(path.join(loreDir, f)));
    })
    .sort();
  return { added, deleted, changed };
}

function main() {
  const [command, loreDir, arg] = process.argv.slice(2);
  if (!command || !loreDir) {
    console.log(
      "usage:\n" +
        "  node scripts/lore-snapshot.mjs snapshot <lore-dir> [label]\n" +
        "  node scripts/lore-snapshot.mjs list     <lore-dir>\n" +
        "  node scripts/lore-snapshot.mjs restore  <lore-dir> <name>\n" +
        "  node scripts/lore-snapshot.mjs diff     <lore-dir> <name>"
    );
    process.exit(1);
  }

  if (command === "snapshot") {
    const r = takeSnapshot(loreDir, arg, new Date());
    console.log(`✓ snapshot ${r.name} — ${r.files} file(s), ${(r.bytes / 1024).toFixed(0)} KB`);
    console.log(`  ${r.dest}`);
  } else if (command === "list") {
    const all = listSnapshots(loreDir);
    if (all.length === 0) return console.log("no snapshots yet");
    for (const s of all) {
      console.log(`  ${s.name.padEnd(34)} ${String(s.files).padStart(4)} files  ${(s.bytes / 1024).toFixed(0)} KB`);
    }
  } else if (command === "restore") {
    if (!arg) fail("restore needs a snapshot name — run `list` to see them");
    const r = restoreSnapshot(loreDir, arg);
    console.log(`✓ restored ${r.restored} file(s), removed ${r.removed} added since`);
  } else if (command === "diff") {
    if (!arg) fail("diff needs a snapshot name");
    const d = diffSnapshot(loreDir, arg);
    console.log(`added   ${d.added.length}\ndeleted ${d.deleted.length}\nchanged ${d.changed.length}`);
    for (const f of d.added.slice(0, 40)) console.log(`  + ${f}`);
    if (d.added.length > 40) console.log(`  … ${d.added.length - 40} more added`);
    for (const f of d.deleted.slice(0, 40)) console.log(`  - ${f}`);
    for (const f of d.changed.slice(0, 40)) console.log(`  ~ ${f}`);
  } else {
    fail(`unknown command: ${command}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("lore-snapshot.mjs")) {
  main();
}
