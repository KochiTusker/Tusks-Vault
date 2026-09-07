// Group a flat lore file list into the folder tree it already has.
//
// The corpus arrives as a flat array of relative paths, and the Lore tab used
// to render it as one alphabetical grid. For an uploaded folder of a dozen
// files that is fine. For an Obsidian vault it is not: a real vault carries a
// deliberate hierarchy — NPCs by family, locations by region, one folder per
// session — and flattening it produced a 7,000-pixel wall of cards whose only
// structure was the repeated path prefix on every row.
//
// Nothing here touches the disk. The vault is read-only (see
// knowledge/obsidian/readonly-guard.test.ts) and the grouping the user wants is
// the grouping they already made; this only stops throwing it away on render.
//
// Deliberately ONE level deep. A vault nests three or four folders down, and a
// fully recursive tree in a dashboard panel means expanding four times to reach
// a note. Grouping on the top-level folder gives a screenful of headings, and
// the remaining path stays on the row so a note is still locatable inside its
// group.

import { displayFileName } from "./loreFileName";

export interface LoreTreeFile<T> {
  /** The original item, handed back untouched so callers keep their own type. */
  file: T;
  /** Path below the group heading — "Background/Maera the Ashbound.md". Empty-safe:
   *  a file directly in the group renders as just its name. */
  subPath: string;
}

export interface LoreGroup<T> {
  /** Folder name as it appears in the vault, or ROOT_GROUP for loose files. */
  name: string;
  files: LoreTreeFile<T>[];
  /** Summed bytes, so a heading can say which folder is actually costing you
   *  context without the reader adding up rows. */
  bytes: number;
  /** Files the indexer could not read. Surfaced per group because "3 of these
   *  never reach the bot" is only actionable if you know which folder. */
  unreadable: number;
}

/** Heading for files that sit at the corpus root with no folder of their own.
 *  Named rather than blank: an unlabelled first group reads as a bug. */
export const ROOT_GROUP = "Loose documents";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Split `files` into one group per top-level folder.
 *
 * Sorting is numeric-aware on purpose. Vault folders are very often numbered
 * for exactly this reason ("02 - NPCs", "10 - Appendices"), and a plain string
 * sort puts "10" before "2". Within a group the same collator orders
 * "Session 2" before "Session 10".
 *
 * Loose root files always sort last: they are the leftovers, not the headline.
 */
export function groupLoreFiles<T extends { name: string; size: number; indexed?: boolean }>(
  files: T[]
): LoreGroup<T>[] {
  const groups = new Map<string, LoreGroup<T>>();

  for (const file of files) {
    // Split on the display name so an upload's timestamp prefix never becomes
    // a folder, and normalise separators — a Windows-authored path can arrive
    // with backslashes and would otherwise read as one long filename.
    const shown = displayFileName(file.name).replace(/\\/g, "/");
    const slash = shown.indexOf("/");
    const name = slash === -1 ? ROOT_GROUP : shown.slice(0, slash);
    const subPath = slash === -1 ? shown : shown.slice(slash + 1);

    let group = groups.get(name);
    if (!group) {
      group = { name, files: [], bytes: 0, unreadable: 0 };
      groups.set(name, group);
    }
    group.files.push({ file, subPath });
    group.bytes += file.size;
    if (file.indexed === false) group.unreadable += 1;
  }

  for (const group of groups.values()) {
    group.files.sort((a, b) => collator.compare(a.subPath, b.subPath));
  }

  return [...groups.values()].sort((a, b) => {
    if (a.name === ROOT_GROUP) return 1;
    if (b.name === ROOT_GROUP) return -1;
    return collator.compare(a.name, b.name);
  });
}

/**
 * Case-insensitive substring match over the whole displayed path.
 *
 * Matching the full path rather than the basename is what lets "corrin" find
 * every note in a family folder and "session 04" find that session's folder,
 * which is how people actually search a vault they wrote themselves.
 */
export function filterLoreFiles<T extends { name: string }>(files: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return files;
  return files.filter(f => displayFileName(f.name).toLowerCase().includes(q));
}
