// Directory browsing for the vault folder picker.
//
// The dashboard is a web page, and a web page cannot open a native folder
// dialog that yields an absolute host path — `<input type="file"
// webkitdirectory>` hands back relative entry names, never `D:/Notes/Vault`.
// So the choice was between spawning the OS dialog from the server and
// serving the directory tree for an in-app browser. This is the second: no
// process spawn, no shell, no GUI dependency, nothing that can hang a request
// waiting on a window the user cannot see.
//
// What it discloses, stated plainly: directory NAMES, one level at a time,
// to whoever can call the route. Never file names, never file contents, never
// sizes or timestamps. That is a real widening of what the API exposes, which
// is why the route mounting it sits behind loopbackOnly() alongside the rest
// of /api/obsidian — the same gate, for the same reason: reading lore over
// the LAN is fine, enumerating the host's directories is not.
//
// Lives under knowledge/obsidian/ deliberately: readonly-guard.test.ts scans
// every source file in this directory for filesystem mutators, so a future
// edit that reaches for mkdir or writeFile in here fails the suite.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface DirEntry {
  name: string;
  /** Absolute, so the client never has to join paths and get separators wrong. */
  path: string;
  /** `.obsidian/` present — the one unambiguous signal of a real vault, shown
   *  as a badge so the user recognises their vault without opening it. */
  isObsidianVault: boolean;
}

export interface DirListing {
  ok: boolean;
  error?: string;
  /** The directory listed, or null for the roots pseudo-listing. */
  path: string | null;
  /** Where "up" goes, or null at a root. */
  parent: string | null;
  entries: DirEntry[];
  /** True when the cap below was hit — an honest "there are more" rather than
   *  a silently short list. */
  truncated: boolean;
  /** Set on the listing of a real directory: lets the picker offer "use this
   *  folder" with the vault badge already resolved. */
  isObsidianVault?: boolean;
}

/** A directory with 20k children is a real thing (node_modules, a media
 *  dump). Rendering all of them helps nobody and makes the response large
 *  enough to notice, so the list stops and says it stopped. */
const MAX_ENTRIES = 500;

function hasObsidianDir(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, ".obsidian")).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Where browsing starts: drive letters on Windows, `/` on POSIX, plus the
 * home directory because that is where a vault usually is and nobody wants to
 * click through `C:` → `Users` → their name every time.
 */
export function listRoots(): DirEntry[] {
  const roots: DirEntry[] = [];
  const home = os.homedir();

  if (process.platform === "win32") {
    for (let code = 65; code <= 90; code++) {
      const drive = `${String.fromCharCode(code)}:\\`;
      try {
        // A CD drive with no disc, or a disconnected network mapping, throws
        // here rather than reporting itself as empty — skipping on throw is
        // what keeps those out of the list.
        fs.accessSync(drive);
        roots.push({ name: drive, path: drive, isObsidianVault: false });
      } catch {
        /* not present */
      }
    }
  } else {
    roots.push({ name: "/", path: "/", isObsidianVault: false });
  }

  if (home && fs.existsSync(home)) {
    roots.push({ name: `Home (${path.basename(home)})`, path: home, isObsidianVault: hasObsidianDir(home) });
  }
  return roots;
}

/**
 * One level of directories under `target`.
 *
 * Directories only. A folder picker has no use for file names, and not
 * returning them means this route cannot be used to inventory someone's
 * documents.
 */
export function listDirectory(target: string): DirListing {
  const trimmed = (target ?? "").trim();
  if (!trimmed) {
    return { ok: true, path: null, parent: null, entries: listRoots(), truncated: false };
  }
  if (!path.isAbsolute(trimmed)) {
    return { ok: false, error: "Give a full path, not a relative one.", path: null, parent: null, entries: [], truncated: false };
  }

  // Normalise before use so `C:\a\..\b` and trailing separators resolve to one
  // spelling — the client round-trips this value as the next request's input.
  const dir = path.resolve(trimmed);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    return { ok: false, error: "Nothing exists at that path.", path: dir, parent: null, entries: [], truncated: false };
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: "That path is a file, not a folder.", path: dir, parent: null, entries: [], truncated: false };
  }

  let raw: fs.Dirent[];
  try {
    raw = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // Windows throws EPERM on plenty of ordinary directories (System Volume
    // Information, another user's profile). That is not a bug to report as a
    // failure of the app.
    const code = (err as NodeJS.ErrnoException).code;
    return {
      ok: false,
      error: code === "EACCES" || code === "EPERM" ? "No permission to read that folder." : "Could not read that folder.",
      path: dir,
      parent: parentOf(dir),
      entries: [],
      truncated: false,
    };
  }

  const entries: DirEntry[] = [];
  let truncated = false;
  for (const d of raw) {
    // Dot-directories are tooling, not vaults — `.git`, `.obsidian` itself.
    // Hiding them keeps the list to things a person would actually pick.
    if (d.name.startsWith(".")) continue;
    if (!isDirectoryEntry(dir, d)) continue;
    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    const full = path.join(dir, d.name);
    entries.push({ name: d.name, path: full, isObsidianVault: hasObsidianDir(full) });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return {
    ok: true,
    path: dir,
    parent: parentOf(dir),
    entries,
    truncated,
    isObsidianVault: hasObsidianDir(dir),
  };
}

/** Null at a filesystem root, so the UI can drop the "up" affordance rather
 *  than offer one that goes nowhere. `path.dirname("C:\\")` returns `C:\`
 *  itself, which is the case this detects. */
function parentOf(dir: string): string | null {
  const up = path.dirname(dir);
  return up === dir ? null : up;
}

/** Symlinked directories are navigable and users have them, so a symlink is
 *  followed once to find out. A broken one throws and is skipped. */
function isDirectoryEntry(dir: string, d: fs.Dirent): boolean {
  if (d.isDirectory()) return true;
  if (!d.isSymbolicLink()) return false;
  try {
    return fs.statSync(path.join(dir, d.name)).isDirectory();
  } catch {
    return false;
  }
}
