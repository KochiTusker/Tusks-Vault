import fs from "fs";
import path from "path";
import { KNOWLEDGE_DIR } from "../config/paths";
import { isIngestible } from "../knowledge/loader";

// Filesystem-based integration with the companion project Tusk's Tomes
// (https://github.com/KochiTusker/Tusks-Tomes). Tomes saves finished session
// chronicles into its `Sessions/<campaign>/` folder — as `.docx` by
// default, though the format is the user's choice at save time. Vault scans
// that folder and copies new chronicles into its own lore directory, where
// the knowledge-base loader picks them up like any other lore document.
//
// This module is the FALLBACK path. The canonical setup is Tomes saving
// straight into the shared `Tusks-Lore/` folder both projects read, which
// needs no import step at all. What follows exists for installs that predate
// that design and still keep chronicles inside a Tomes checkout.

// Filesystem candidates we'll auto-probe when the user hasn't configured a
// path explicitly. Adjacent-directory layout is the recommended setup, so the
// shared `Tusks-Lore/Sessions` folder is probed first — on that layout there
// is usually nothing to import, because Tomes already wrote there. Legacy
// in-repo locations (`Tusks-Tomes/Sessions/`) come after, for installs that
// predate the shared-lore-folder design. First match wins.
const DEFAULT_CANDIDATES = [
  "../Tusks-Lore/Sessions",
  "../tusks-lore/Sessions",
  "../Tusks-Tomes/Sessions",
  "../tusks-tomes/Sessions",
  "../Tusks-Tomes",
  "../Tomes/Sessions",
  "../Tomes",
];

const IMPORT_PREFIX = "tomes-chronicle";

function resolveCandidate(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function isSessionsDir(absPath: string): boolean {
  try {
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) return false;
    // If the directory has a "Sessions" subfolder, return that instead — the
    // user may have pointed at the Tomes repo root rather than its Sessions
    // child. Caller should re-probe with the corrected path.
    return true;
  } catch {
    return false;
  }
}

// Signature files that uniquely identify a Tusk's Tomes repo on disk.
// We use these to recognise an "installed but no sessions yet" Tomes —
// the user has cloned the repo as a sibling but hasn't generated any
// chronicles yet, so Sessions/ doesn't exist. Without this fallback the
// probe reports "not detected", which is misleading.
const TOMES_SIGNATURE_FILES = [
  "Start_Tusks_Tomes.bat", // distinctive launcher only Tomes ships
  "architecture.md", // both projects could ship this, but Tomes has a 40KB one
];

function looksLikeTomesRepo(dir: string): boolean {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  // Strongest signal: a signature file unique to Tomes.
  for (const sig of TOMES_SIGNATURE_FILES) {
    if (fs.existsSync(path.join(dir, sig))) return true;
  }
  // Second signal: package.json with a tomes-shaped name.
  try {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { name?: string };
      if (typeof pkg.name === "string" && /^tusks?[-_]?tomes$/i.test(pkg.name)) return true;
    }
  } catch {
    /* ignore parse / IO errors */
  }
  return false;
}

// Tomes layouts (relative to repo root):
//   Sessions/<campaign>/<any name>.<ext>
// The filename is not parsed — every ingestible file under the tree is
// taken — so this stays deliberately vague rather than pinning a naming
// convention Vault does not actually depend on.
// does not actually depend on.
function findSessionsRoot(start: string): string | null {
  if (!fs.existsSync(start)) return null;
  // Already a Sessions/ directory?
  if (path.basename(start).toLowerCase() === "sessions" && fs.statSync(start).isDirectory()) {
    return start;
  }
  // Or a repo root with a Sessions/ child?
  const child = path.join(start, "Sessions");
  if (fs.existsSync(child) && fs.statSync(child).isDirectory()) return child;
  return null;
}

export interface TomesProbe {
  found: boolean;
  sessionsPath: string | null;
  candidatesChecked: string[];
  campaignCount: number;
  chronicleCount: number;
  alreadyImported: number;
  /** Absolute path to the detected Tomes repo root, when known. Populated
   *  for both "Sessions/ found" and "installed but no Sessions/ yet" cases. */
  repoPath?: string | null;
}

export interface TomesChronicle {
  campaign: string;
  filename: string;
  absPath: string;
  size: number;
  modified: string;
  alreadyImported: boolean;
  /** The name we'd give the file inside Vault's Lore/ if imported. */
  importedAs: string;
}

function chronicleImportName(campaign: string, original: string): string {
  // Keep the original filename for traceability, but prefix with the campaign
  // and IMPORT_PREFIX so the user can spot Tomes-sourced chronicles at a glance.
  const safeCampaign = campaign.replace(/[\\/:*?"<>|]/g, "").trim();
  return `${IMPORT_PREFIX} - ${safeCampaign} - ${original}`;
}

export function probeTomes(configuredPath?: string | null): TomesProbe {
  const candidates = configuredPath
    ? [configuredPath, ...DEFAULT_CANDIDATES]
    : DEFAULT_CANDIDATES;
  const checked: string[] = [];

  // Two-pass search:
  //   Pass 1 — look for a Sessions/ directory (Tomes has generated chronicles)
  //   Pass 2 — look for a Tomes-shaped repo with no Sessions/ yet (fresh
  //            install — user has cloned Tomes but not yet recorded a session)
  //
  // Two passes (rather than one) so a partially-set-up Tomes earlier in the
  // candidate list doesn't shadow a fully-populated Tomes later in the list.
  // The user's configured path (if any) is at index 0 in both passes.
  for (const raw of candidates) {
    const candidate = resolveCandidate(raw);
    checked.push(candidate);
    if (!isSessionsDir(candidate)) continue;

    const sessionsRoot = findSessionsRoot(candidate);
    if (!sessionsRoot) continue;

    const chronicles = scanChronicles(sessionsRoot);
    return {
      found: true,
      sessionsPath: sessionsRoot,
      repoPath: path.dirname(sessionsRoot),
      candidatesChecked: checked,
      campaignCount: new Set(chronicles.map(c => c.campaign)).size,
      chronicleCount: chronicles.length,
      alreadyImported: chronicles.filter(c => c.alreadyImported).length,
    };
  }

  // Pass 2 — accept an installed-but-empty Tomes.
  for (const raw of candidates) {
    const candidate = resolveCandidate(raw);
    if (!looksLikeTomesRepo(candidate)) continue;
    return {
      found: true,
      sessionsPath: null, // no Sessions/ exists yet — nothing to import
      repoPath: candidate,
      candidatesChecked: checked,
      campaignCount: 0,
      chronicleCount: 0,
      alreadyImported: 0,
    };
  }

  return {
    found: false,
    sessionsPath: null,
    repoPath: null,
    candidatesChecked: checked,
    campaignCount: 0,
    chronicleCount: 0,
    alreadyImported: 0,
  };
}

export function scanChronicles(sessionsRoot: string): TomesChronicle[] {
  const out: TomesChronicle[] = [];
  try {
    const campaigns = fs.readdirSync(sessionsRoot).filter(name => {
      const full = path.join(sessionsRoot, name);
      try {
        return fs.statSync(full).isDirectory();
      } catch {
        return false;
      }
    });

    const existingLore = new Set<string>();
    try {
      if (fs.existsSync(KNOWLEDGE_DIR)) {
        for (const f of fs.readdirSync(KNOWLEDGE_DIR)) {
          // multer prefixes uploads with `<timestamp>-`; strip that so we can
          // match against the import name we generated previously.
          const stripped = f.replace(/^\d{10,}-/, "");
          existingLore.add(stripped);
          existingLore.add(f);
        }
      }
    } catch {
      /* lore dir may not exist yet; ignore */
    }

    for (const campaign of campaigns) {
      const campaignDir = path.join(sessionsRoot, campaign);
      let files: string[];
      try {
        files = fs.readdirSync(campaignDir);
      } catch {
        continue;
      }
      for (const f of files) {
        // Filter by what the lore loader can actually READ, not by one
        // extension. Tomes' default chronicle output is `.docx`; hardcoding
        // `.md` here reported "no chronicles yet" to exactly the users this
        // fallback exists for. importChronicles() copies bytes verbatim, so
        // whatever passes here is ingested downstream on the same terms.
        if (!isIngestible(f)) continue;
        const abs = path.join(campaignDir, f);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(abs);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;
        const importedAs = chronicleImportName(campaign, f);
        out.push({
          campaign,
          filename: f,
          absPath: abs,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          alreadyImported: existingLore.has(importedAs),
          importedAs,
        });
      }
    }
  } catch (err) {
    console.error("[tomes] scanChronicles failed:", err);
  }
  return out.sort((a, b) => a.campaign.localeCompare(b.campaign) || a.filename.localeCompare(b.filename));
}

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  details: Array<{ filename: string; status: "imported" | "skipped" | "failed"; reason?: string; destFilename?: string }>;
}

export function importChronicles(chronicles: TomesChronicle[]): ImportResult {
  if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });

  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, details: [] };
  for (const c of chronicles) {
    if (c.alreadyImported) {
      result.skipped++;
      result.details.push({ filename: c.filename, status: "skipped", reason: "already in Lore/" });
      continue;
    }
    try {
      // Prefix with a timestamp so the existing UI sort order is sensible, but
      // keep the human-readable import name visible after the timestamp.
      const dest = path.join(KNOWLEDGE_DIR, `${Date.now()}-${c.importedAs}`);
      fs.copyFileSync(c.absPath, dest);
      result.imported++;
      result.details.push({ filename: c.filename, status: "imported", destFilename: path.basename(dest) });
    } catch (err) {
      result.failed++;
      result.details.push({ filename: c.filename, status: "failed", reason: (err as Error).message });
    }
  }
  return result;
}
