// Walking an Obsidian vault — the read side, and nothing else.
//
// STRICTLY READ-ONLY. Vault points at a directory the user also edits by
// hand in Obsidian, so the contract is absolute: nothing in this folder
// (src/server/knowledge/obsidian/) ever writes, renames, or deletes inside
// the vault. Derived data — the AI map, the embeddings — is persisted to
// the app's own config dir instead. `readonly-guard.test.ts` asserts this
// mechanically, so a future edit that reaches for fs.writeFile in here
// fails the suite rather than quietly touching someone's notes.

import fs from "node:fs";
import path from "node:path";

/** Folders holding scaffolding rather than lore. Vault-relative POSIX
 *  prefixes. `_system` and `Templates` are Obsidian conventions; the
 *  graphify one is tooling output that would otherwise index itself. */
export const VAULT_EXCLUDE_DIRS = [
  "_system",
  "Templates",
  "templates",
  ".obsidian",
  ".trash",
  "_MOCs",
  "graphify-out",
];

/** Root-level scaffolding that must never ground as lore. Compared
 *  case-insensitively on the basename, so it holds at any depth. */
export const VAULT_EXCLUDE_FILES = new Set([
  "claude.md",
  "readme.md",
  "readme.txt",
  "license",
  "license.md",
  "contributing.md",
]);

// Hard ceilings, mirroring knowledge/loader.ts. A vault the user mis-points
// at their home directory must degrade rather than walk forever.
export const MAX_VAULT_NOTES = 5_000;
const MAX_VAULT_DEPTH = 12;

export interface VaultNote {
  /** Vault-relative POSIX path, e.g. `NPCs/Ser Alric.md`. Stable across
   *  platforms, and used verbatim as the citation marker. */
  relPath: string;
  absPath: string;
  sizeBytes: number;
  modifiedMs: number;
}

function isExcludedDir(relChild: string): boolean {
  return VAULT_EXCLUDE_DIRS.some(d => relChild === d || relChild.startsWith(`${d}/`));
}

/**
 * Every indexable `.md` note in the vault, sorted by path.
 *
 * Sorted deliberately: the map's digest cache is keyed by path, but the
 * ORDER notes reach the summariser decides which ones share a batch, and a
 * stable order means a rebuild after an unrelated edit reuses the same
 * batches instead of re-summarising everything.
 */
export function walkVaultNotes(vaultPath: string): VaultNote[] {
  const out: VaultNote[] = [];
  if (!fs.existsSync(vaultPath)) return out;

  const visit = (rel: string, depth: number): void => {
    if (depth > MAX_VAULT_DEPTH || out.length >= MAX_VAULT_NOTES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(vaultPath, rel), { withFileTypes: true });
    } catch {
      return; // unreadable subtree — skip it rather than fail the whole walk
    }
    for (const entry of entries) {
      if (out.length >= MAX_VAULT_NOTES) return;
      const relChild = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        if (isExcludedDir(relChild)) continue;
        visit(relChild, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(".md")) continue;
      if (entry.name.startsWith(".")) continue;
      if (VAULT_EXCLUDE_FILES.has(entry.name.toLowerCase())) continue;
      const absPath = path.join(vaultPath, relChild);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(absPath);
      } catch {
        continue;
      }
      out.push({
        relPath: relChild,
        absPath,
        sizeBytes: stat.size,
        modifiedMs: stat.mtimeMs,
      });
    }
  };

  visit("", 0);
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

/** The note title Obsidian would show: the filename stem. */
export function noteTitle(relPath: string): string {
  return path.basename(relPath, path.extname(relPath));
}

/**
 * Resolve a vault-relative path to an absolute one INSIDE the vault, or null.
 *
 * Same contract as knowledge/loader.ts safeKnowledgePath: the note path
 * arrives from a request (the model names a note it wants, or the dashboard
 * previews one), so traversal has to be refused rather than trusted.
 */
export function safeVaultPath(vaultPath: string, relPath: string): string | null {
  if (typeof relPath !== "string" || relPath.length === 0) return null;
  if (relPath.includes("\0")) return null;
  const root = path.resolve(vaultPath) + path.sep;
  const candidate = path.resolve(vaultPath, relPath);
  if (candidate + path.sep === root) return null; // the vault root itself is not a note
  if (!candidate.startsWith(root)) return null;
  return candidate;
}
