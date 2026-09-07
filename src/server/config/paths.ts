import fs from "fs";
import path from "path";

const root = process.cwd();

// Most paths live at the repo root and never move.
//
// settingsPath() is a FUNCTION, not a constant, per the repo's lazy-path
// convention. A constant is computed once at import, so a test that changes
// cwd to a temp directory still resolves to the real settings.json and
// overwrites the developer's own configuration — which is exactly what
// happened. The rest of the app resolves paths lazily for this reason; this
// one had been missed.
export function settingsPath(): string {
  return path.join(process.cwd(), "settings.json");
}
export const MODELS_CACHE_DIR = path.join(root, "models");

// Campaign-state files (clarifications, lore-gaps, embeddings) live inside
// the resolved Tusks-Lore folder so they survive clean reinstalls and follow
// the user's lore around. The actual values are computed below, after
// LORE_ROOT_DIR is resolved — declared `let` here and assigned at the bottom
// of the module.
export let CLARIFICATIONS_PATH: string;
export let LORE_GAPS_PATH: string;
export let EMBEDDINGS_PATH: string;
export let LOGS_DIR: string;
export let LOG_FILE_PATH: string;

// The repo-local lore directory. It is both the fallback location (used when
// no sibling folder or configured path resolves) and a migration source: when
// the user later creates a sibling Tusks-Lore/, the loader moves their files
// across, so this stays a constant even when KNOWLEDGE_DIR points elsewhere.
export const REPO_LORE_DIR = path.join(root, "Lore");

// The repository working tree. Exported so the loader can refuse to migrate a
// user's lore INTO it: `isExternal` only means "not exactly REPO_LORE_DIR", so
// any other in-repo path — a test fixture directory, say — reads as external
// and would otherwise be treated as a valid migration destination.
export const REPO_ROOT_DIR = root;

// Conventional sub-directory inside an external Tusks-Lore root where Tomes
// writes its session-chronicle DOCX output, organised as
// `<root>/Sessions/<campaign>/Session-NN-DATE-{full,condensed}.docx`. Vault's
// loader walks the lore tree recursively so files here surface as regular
// lore documents. Kept as a constant so the create-folder route can mkdir
// the sub-dir up-front; nothing else relies on the literal value.
export const SESSIONS_SUBDIR = "Sessions";

// Sibling candidates probed when neither env override nor settings override
// is set. First match wins. Mirrors the Tusks-Tomes sibling-pattern: install
// Tusks-Vault and Tusks-Lore side-by-side and the integration auto-detects.
const SIBLING_CANDIDATES = [
  path.resolve(root, "..", "Tusks-Lore"),
  path.resolve(root, "..", "tusks-lore"),
];

export type LoreResolutionReason =
  | "env" // TUSKS_VAULT_LORE_PATH was set
  | "settings" // settings.json loreFolderPath
  | "sibling" // adjacent ../Tusks-Lore directory exists
  | "fallback"; // none of the above — repo-local Lore/

export interface ResolvedLore {
  /** The Tusks-Lore root — holds Tomes-managed metadata (tusks-lore.json)
   *  alongside the Sessions/ subdirectory and any user-uploaded lore docs.
   *  For the legacy fallback case this is the repo-local Lore/. */
  rootPath: string;
  /** Where the loader scans for lore documents. Always equals rootPath in
   *  the current design — kept as a separate field for forward-compat with
   *  any future "scan a sub-tree of the root" feature. */
  knowledgePath: string;
  reason: LoreResolutionReason;
  /** True iff the resolved root sits OUTSIDE the repo. The loader's
   *  migration logic only fires when this is true — we never want to move
   *  files INTO the repo-local Lore/. */
  isExternal: boolean;
}

/**
 * Pure resolution logic, separated for testability. Each input is read once
 * and decisions are deterministic in their order.
 *
 * Resolution priority:
 *   1. env override   → root = <env>
 *   2. settings       → root = <settings>
 *   3. sibling probe  → root = first existing ../Tusks-Lore directory
 *   4. fallback       → root = <repo>/Lore
 *
 * KNOWLEDGE_DIR equals rootPath in every case — the loader scans the entire
 * Tusks-Lore tree recursively (sessions live in Sessions/<campaign>/, user
 * docs at the root). The `knowledgePath` field on the result exists for
 * forward-compat in case a future feature wants a different sub-tree.
 */
export function resolveKnowledgeDir(opts: {
  envOverride?: string | null;
  settingsOverride?: string | null;
  isDir: (p: string) => boolean;
  siblingCandidates?: string[];
  repoLore: string;
}): ResolvedLore {
  const externalised = (raw: string, reason: "env" | "settings"): ResolvedLore => {
    const trimmed = raw.trim();
    const rootPath = path.isAbsolute(trimmed) ? trimmed : path.resolve(root, trimmed);
    return {
      rootPath,
      knowledgePath: rootPath,
      reason,
      // Repo-local Lore/ stays "internal" even when reached via settings —
      // the migration logic only fires when isExternal is true.
      isExternal: rootPath !== opts.repoLore,
    };
  };

  const env = opts.envOverride?.trim();
  if (env) return externalised(env, "env");

  const fromSettings = opts.settingsOverride?.trim();
  if (fromSettings) return externalised(fromSettings, "settings");

  for (const candidate of opts.siblingCandidates ?? SIBLING_CANDIDATES) {
    if (opts.isDir(candidate)) {
      return {
        rootPath: candidate,
        knowledgePath: candidate,
        reason: "sibling",
        isExternal: true,
      };
    }
  }

  // Fallback: repo-local Lore/. Legacy behaviour for installs without a
  // sibling Tusks-Lore directory.
  return {
    rootPath: opts.repoLore,
    knowledgePath: opts.repoLore,
    reason: "fallback",
    isExternal: false,
  };
}

// Direct JSON read so paths.ts doesn't import settings.ts (which would
// cycle — settings.ts imports SETTINGS_PATH from here). Tolerates a
// missing/corrupt file: returns undefined and falls through to the next
// resolution step.
function readSettingsLoreFolderPath(): string | undefined {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) return undefined;
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as {
      loreFolderPath?: unknown;
    };
    if (typeof raw.loreFolderPath === "string" && raw.loreFolderPath.trim()) {
      return raw.loreFolderPath.trim();
    }
  } catch {
    /* ignore — fall through */
  }
  return undefined;
}

function isExistingDir(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Resolution happens once at module load. A change in env / settings /
// filesystem layout requires a server restart to pick up — matches the
// existing Tusks-Tomes integration's restart-aware UX. The dashboard's
// /api/diagnostics surfaces the resolved path + reason so users can see
// which layer activated.
const RESOLVED = resolveKnowledgeDir({
  envOverride: process.env.TUSKS_VAULT_LORE_PATH,
  settingsOverride: readSettingsLoreFolderPath(),
  isDir: isExistingDir,
  repoLore: REPO_LORE_DIR,
});

/** Where lore documents live. Used by every loader/upload/attachment path. */
export const KNOWLEDGE_DIR = RESOLVED.knowledgePath;
/** The Tusks-Lore root (parent of KNOWLEDGE_DIR for external layouts,
 *  same as KNOWLEDGE_DIR for the legacy fallback). Where glossary.json /
 *  speakers.json / README.md live, and where Tomes writes its Sessions/
 *  subfolder. */
export const LORE_ROOT_DIR = RESOLVED.rootPath;
export const KNOWLEDGE_DIR_REASON: LoreResolutionReason = RESOLVED.reason;
export const KNOWLEDGE_DIR_IS_EXTERNAL = RESOLVED.isExternal;

/** Default sibling location for the new POST /api/integrations/tusks-lore/create
 *  endpoint. Always `../Tusks-Lore` (CapCase). */
export const DEFAULT_SIBLING_LORE_PATH = SIBLING_CANDIDATES[0];

// Resolve the campaign-state file paths inside LORE_ROOT_DIR now that we
// know where the lore folder lives. On the first boot after this change,
// any legacy files at the repo root are moved into LORE_ROOT_DIR — this is
// a one-time migration; thereafter all reads/writes target the new path.
CLARIFICATIONS_PATH = path.join(LORE_ROOT_DIR, "clarifications.json");
LORE_GAPS_PATH = path.join(LORE_ROOT_DIR, "lore_gaps.json");
EMBEDDINGS_PATH = path.join(LORE_ROOT_DIR, "clarifications.embeddings.json");
LOGS_DIR = path.join(LORE_ROOT_DIR, "logs");
LOG_FILE_PATH = path.join(LOGS_DIR, "tusks-vault.log");

// Ensure the lore root exists. If we're on the repo-local fallback the
// directory should already be a known location.
try {
  fs.mkdirSync(LORE_ROOT_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });
} catch (err) {
  console.warn(`[paths] could not ensure lore root ${LORE_ROOT_DIR}:`, err);
}
