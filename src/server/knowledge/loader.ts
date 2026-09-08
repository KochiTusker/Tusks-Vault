import fs from "fs";
import path from "path";
import multer from "multer";
import { createRequire } from "module";
import { extractPdfText } from "../util/pdf-text";
import { movePath } from "../util/move-path";
import {
  KNOWLEDGE_DIR,
  KNOWLEDGE_DIR_IS_EXTERNAL,
  REPO_LORE_DIR,
  REPO_ROOT_DIR,
} from "../config/paths";
import { getSettings } from "../config/settings";
import {
  buildFullVaultKnowledge,
  buildMappedVaultKnowledge,
  listVaultNotes,
  type KnowledgeBundle,
} from "./obsidian/source";

export type { KnowledgeBundle };

const require = createRequire(import.meta.url);

/**
 * Is `target` outside the repository working tree?
 *
 * path.relative rather than a string prefix: a prefix test says
 * "D:/Tusks-Vault-VTT" is inside "D:/Tusks-Vault", and on Windows it also
 * disagrees with itself over drive-letter case. A relative path that starts
 * with ".." (or is absolute, meaning a different drive) is genuinely outside.
 *
 * `repoRoot` is a parameter only so this can be tested against paths that do
 * not exist on the machine running the suite; callers pass nothing.
 */
export function isOutsideRepo(target: string, repoRoot: string = REPO_ROOT_DIR): boolean {
  const rel = path.relative(repoRoot, target);
  return rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel));
}

const mammoth = require("mammoth");

// Names that aren't user lore — kept in BOTH source and destination during a
// migration so the user's "this is where lore goes" placeholder README isn't
// silently relocated.
function isPlaceholderForMigration(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === "readme.md" || lower === "readme.txt" || lower === "readme") return true;
  if (name.startsWith(".")) return true;
  return false;
}

export function ensureKnowledgeDir(): void {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  }
  // Repo-local Lore/ into the external KNOWLEDGE_DIR. This is a live path,
  // not a legacy one: <repo>/Lore/ is where a fresh install puts lore when no
  // sibling folder resolves, so this fires the first boot after the user
  // creates one and carries their documents across. Only when KNOWLEDGE_DIR
  // is external AND <repo>/Lore/ still has user files; the placeholder README
  // stays put.
  //
  // isOutsideRepo is the second half of "external", and it is not redundant.
  // ResolvedLore documents isExternal as "the resolved root sits OUTSIDE the
  // repo", but it is computed as `rootPath !== repoLore` — so ANY other path
  // inside the working tree satisfies it. Setting TUSKS_VAULT_LORE_PATH to an
  // in-repo directory therefore made that directory a migration destination,
  // and this moves real files: `scripts/grade-models.mjs` points the variable
  // at its fixture corpus, so running the grading suite on a machine with lore
  // in ./Lore relocated that lore into a TRACKED directory, one `git add -A`
  // away from being committed. Observed — it only failed here because the
  // source files happened to be locked.
  if (
    KNOWLEDGE_DIR_IS_EXTERNAL &&
    isOutsideRepo(KNOWLEDGE_DIR) &&
    fs.existsSync(REPO_LORE_DIR) &&
    REPO_LORE_DIR !== KNOWLEDGE_DIR
  ) {
    try {
      const entries = fs.readdirSync(REPO_LORE_DIR);
      let moved = 0;
      for (const entry of entries) {
        if (isPlaceholderForMigration(entry)) continue;
        const from = path.join(REPO_LORE_DIR, entry);
        const to = path.join(KNOWLEDGE_DIR, entry);
        if (fs.existsSync(to)) continue; // destination wins — don't clobber
        // movePath, not renameSync: the destination is frequently on a
        // different drive from the install (C: and D: is an ordinary Windows
        // setup), and rename cannot span volumes. It failed with EXDEV, the
        // catch below logged a warning, and the user's lore stayed in ./Lore
        // while the app read the folder it had just failed to fill.
        movePath(from, to);
        moved++;
      }
      if (moved > 0) {
        console.log(
          `[loader] migrated ${moved} file(s) from ./Lore to ${KNOWLEDGE_DIR}`,
        );
      }
    } catch (err) {
      console.warn("[loader] could not migrate ./Lore to external sibling:", err);
    }
  }
  // The previous-design intermediate `sources/` subdirectory is no longer
  // created or required. If an install has files inside `<lore>/sources/`,
  // the recursive walk in listKnowledgeFiles / getKnowledgeBaseContent still
  // surfaces them — they just appear under "sources/<filename>" in the
  // listing. Users can manually flatten or keep the layout; both work.
}

// Multer uploads land at the top of KNOWLEDGE_DIR. Bulk Upload doesn't
// expose a "destination folder" picker (yet) — users who want files in a
// sub-directory like `Worldbuilding/` can drop them there via the file
// system; the recursive listing picks them up on next refresh.
export const knowledgeUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, KNOWLEDGE_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
});

/** Written into a vault this app generated. Its presence tells the folder
 *  walk to leave that directory alone — see walkLoreDir. */
export const FORGED_VAULT_MARKER = ".forged-by-tusks-vault";

/** Extensions getKnowledgeBaseContent() can actually read. Anything else is
 *  listed for visibility but contributes nothing to a prompt — and must not
 *  be counted as though it did. */
export const INGESTIBLE_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".tsv",
  ".html",
  ".htm",
  ".rtf",
]);

export function isIngestible(relPath: string): boolean {
  return INGESTIBLE_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}

export interface KnowledgeFileInfo {
  /** Relative path from KNOWLEDGE_DIR. May contain forward slashes for
   *  nested files (e.g. `Sessions/Curse-of-Strahd/Session-01-...docx`). */
  name: string;
  size: number;
  createdAt: Date;
  /** False for a file Vault cannot read — a .bak, a .zip, an image. Shown in
   *  the list so it isn't mysteriously absent, but excluded from every
   *  "this is what the bot sees" count. */
  indexed: boolean;
}

// Files inside KNOWLEDGE_DIR that aren't user lore — placeholder READMEs,
// dotfiles, underscore-prefixed "ignore me" files, and the Tomes-managed
// metadata file (read separately for grounding when that feature lands;
// not surfaced as a generic "document"). Compared by basename only — a
// file literally named `tusks-lore.json` at any depth is skipped.
export function isPlaceholderFile(basename: string): boolean {
  const lower = basename.toLowerCase();
  if (lower === "readme.md" || lower === "readme.txt" || lower === "readme") return true;
  if (lower === "tusks-lore.json") return true; // Tomes-managed metadata
  if (lower === "glossary.json" || lower === "speakers.json") return true; // legacy split-metadata files
  if (lower === "tusks-vault.log") return true; // Vault's own log, written into the lore root
  // Vault's OWN state, which config/paths.ts stores inside the lore folder so
  // it survives a reinstall. Left unfiltered these are ingested as campaign
  // canon: the bot reads its own list of unanswered questions and its own
  // stored clarifications back as source material, and then cites them.
  if (lower === "lore_gaps.json") return true;
  if (lower === "clarifications.json") return true;
  if (lower === "clarifications.embeddings.json") return true;
  if (basename.startsWith(".")) return true;
  if (basename.startsWith("_")) return true;
  return false;
}

// Hard ceilings on the recursive walk so a mis-pointed KNOWLEDGE_DIR (or a
// weird symlink loop) can't run away. Tomes-driven Sessions/ trees in
// practice stay well under both limits.
const MAX_WALK_FILES = 5_000;
const MAX_WALK_DEPTH = 8;

interface WalkedFile {
  relPath: string; // posix-style for stable JSON across platforms
  absPath: string;
  size: number;
  createdAt: Date;
}

function walkLoreDir(absRoot: string): WalkedFile[] {
  const results: WalkedFile[] = [];
  if (!fs.existsSync(absRoot)) return results;

  function walk(dir: string, depth: number): void {
    if (depth > MAX_WALK_DEPTH) return;
    if (results.length >= MAX_WALK_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[loader] could not read ${dir}:`, err);
      return;
    }
    for (const entry of entries) {
      if (results.length >= MAX_WALK_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Don't recurse into dotfile directories — same convention as files.
        if (entry.name.startsWith(".")) continue;
        // A vault this app forged from these very documents. Ingesting it
        // would count every fact twice — once as the source document and
        // again as the note derived from it.
        //
        // Marked rather than hidden. The first version lived in a dot-folder
        // so this walk would skip it, which worked and made the vault
        // invisible in the file manager — so it could not be pointed at from
        // the dashboard either, and the feature was unusable. A folder people
        // are meant to open in Obsidian has to be a folder they can see.
        if (fs.existsSync(path.join(full, FORGED_VAULT_MARKER))) continue;
        // Vault's own log directory lives inside the lore root so logs travel
        // with the campaign. It is not campaign material.
        if (depth === 0 && entry.name.toLowerCase() === "logs") continue;
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isPlaceholderFile(entry.name)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      const relPath = path.relative(absRoot, full).split(path.sep).join("/");
      results.push({ relPath, absPath: full, size: stat.size, createdAt: stat.birthtime });
    }
  }

  walk(absRoot, 0);
  return results;
}

/** The Obsidian vault, when the user has chosen one AND it exists on disk.
 *  Null otherwise — a settings file naming a vault that has since been moved
 *  or unmounted must fall back to the folder source rather than reporting an
 *  empty campaign. */
export function activeVaultPath(): string | null {
  // An explicit TUSKS_VAULT_LORE_PATH outranks the stored source. Someone who
  // pins a lore path on the command line means THAT path — the grading
  // harnesses set it to a three-file fixture corpus, and without this the
  // Obsidian source won anyway and every run silently measured the
  // maintainer's real campaign instead. Accuracy cases then grade against
  // answers that only exist in the fixture, so the numbers are not merely
  // wrong, they are wrong in a way that looks like the model failing.
  if ((process.env.TUSKS_VAULT_LORE_PATH ?? "").trim()) return null;

  const settings = getSettings();
  if (settings.loreSource !== "obsidian") return null;
  const p = (settings.obsidianVaultPath ?? "").trim();
  if (!p) return null;
  try {
    if (!fs.statSync(p).isDirectory()) return null;
  } catch {
    return null;
  }
  return p;
}

export function listKnowledgeFiles(): KnowledgeFileInfo[] {
  const vault = activeVaultPath();
  if (vault) return listVaultNotes(vault);

  ensureKnowledgeDir();
  return walkLoreDir(KNOWLEDGE_DIR).map(f => ({
    name: f.relPath,
    size: f.size,
    createdAt: f.createdAt,
    indexed: isIngestible(f.relPath),
  }));
}

/**
 * Safely resolve a user-supplied filename (which may include subdirectories)
 * to an absolute path INSIDE KNOWLEDGE_DIR. Returns null on any escape
 * attempt (path traversal, absolute path, symlink shenanigans). Fixes the
 * B4 ship-audit finding: a crafted DELETE /api/knowledge/..%2F..%2Fkeys.json
 * resolved outside KNOWLEDGE_DIR under the previous implementation.
 */
export function safeKnowledgePath(relPath: string): string | null {
  if (typeof relPath !== "string" || relPath.length === 0) return null;
  if (relPath.includes("\0")) return null;
  const normalisedRoot = path.resolve(KNOWLEDGE_DIR) + path.sep;
  const candidate = path.resolve(KNOWLEDGE_DIR, relPath);
  if (candidate + path.sep === normalisedRoot) return null; // refuse the root itself
  if (!candidate.startsWith(normalisedRoot)) return null;
  return candidate;
}

export function deleteKnowledgeFile(filename: string): boolean {
  const safe = safeKnowledgePath(filename);
  if (!safe) {
    console.warn(`[loader] refusing delete outside KNOWLEDGE_DIR: ${filename}`);
    return false;
  }
  try {
    if (!fs.existsSync(safe)) return false;
    const stat = fs.statSync(safe);
    if (!stat.isFile()) return false;
    fs.unlinkSync(safe);
    return true;
  } catch (err) {
    console.warn(`[loader] delete failed for ${filename}:`, err);
    return false;
  }
}

/**
 * The knowledge base for one question, from whichever source is active.
 *
 * Split into a stable half and a per-question half so the caller can mark
 * only the stable half cacheable. The folder source has no per-question half;
 * a mapped Obsidian read does, and that split is what makes prompt caching
 * survive contact with per-question retrieval.
 */
export async function getKnowledgeBundle(query?: string): Promise<KnowledgeBundle> {
  const vault = activeVaultPath();
  if (vault) {
    const settings = getSettings();
    if (settings.useVaultMap && query && query.trim()) {
      return buildMappedVaultKnowledge(vault, query);
    }
    return buildFullVaultKnowledge(vault);
  }

  const text = await getKnowledgeBaseContent();
  const fileCount = (text.match(/\n\[SOURCE DOCUMENT: /g) ?? []).length;
  return {
    stable: text,
    perQuery: "",
    meta: { mode: "full", notesTotal: fileCount, notesIncluded: fileCount, bytesIncluded: text.length },
  };
}

export async function getKnowledgeBaseContent(): Promise<string> {
  ensureKnowledgeDir();
  const walked = walkLoreDir(KNOWLEDGE_DIR);
  let content = "";
  const fileList: string[] = [];

  console.log(`DEBUG: Starting ingestion of ${walked.length} file(s) from knowledge base.`);

  for (const file of walked) {
    const ext = path.extname(file.relPath).toLowerCase();
    let fileContent = "";
    try {
      if (ext === ".pdf") {
        const buffer = fs.readFileSync(file.absPath);
        fileContent = await extractPdfText(buffer);
      } else if (ext === ".docx") {
        const buffer = fs.readFileSync(file.absPath);
        const result = await mammoth.extractRawText({ buffer });
        fileContent = result.value;
      } else if ([".txt", ".md", ".markdown", ".json", ".yaml", ".yml", ".csv", ".tsv"].includes(ext)) {
        fileContent = fs.readFileSync(file.absPath, "utf-8");
      } else if ([".html", ".htm"].includes(ext)) {
        const raw = fs.readFileSync(file.absPath, "utf-8");
        fileContent = raw
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      } else if (ext === ".rtf") {
        const raw = fs.readFileSync(file.absPath, "utf-8");
        fileContent = raw
          .replace(/\\par[d]?/g, "\n")
          .replace(/\{\\\*[^{}]*\}/g, "")
          .replace(/\\[a-zA-Z]+-?\d*\s?/g, "")
          .replace(/[{}]/g, "")
          .replace(/\\'[0-9a-fA-F]{2}/g, "")
          .trim();
      }

      if (fileContent) {
        content += `\n[SOURCE DOCUMENT: ${file.relPath}]\n${fileContent}\n`;
        fileList.push(file.relPath);
        console.log(`DEBUG: Successfully ingested ${file.relPath} (${fileContent.length} chars)`);
      }
    } catch (err) {
      console.error(`ERROR: Failed to ingest ${file.relPath}:`, err);
    }
  }

  return buildKnowledgeHeader(content, fileList);
}

/** Hard ceiling on the concatenated corpus. Mirrors the cap assemble.ts used
 *  to apply blindly; applied HERE instead so the cut lands on a document
 *  boundary and the header can describe what actually survived. */
export const KB_CHAR_LIMIT = 500_000;

/**
 * Assemble the header, truncating at a document boundary if the corpus is
 * over the cap.
 *
 * The header used to name every file that had been read and then hand the
 * model a corpus that assemble.ts had chopped mid-stream at 500k characters.
 * On a corpus past the cap that meant the model was told it held every
 * document while most of the tail was partly or wholly absent — and it duly cited one it had never
 * seen. The citation rule says "if you cannot cite a source for a claim, you
 * do not know that claim"; a header listing unreadable files hands the model
 * citations for free and quietly defeats it.
 *
 * Two changes, both about not lying:
 *   - cut between documents, never mid-sentence, so a half-document cannot be
 *     mistaken for a whole one
 *   - list only what is actually present, and say plainly what was left out
 */
export function buildKnowledgeHeader(content: string, fileList: string[]): string {
  if (content.length <= KB_CHAR_LIMIT) {
    return (
      `### LORE SOURCE SUMMARY\nThe following ${fileList.length} document(s) are loaded into your ` +
      `knowledge base: ${fileList.join(", ")}\n\n` +
      content
    );
  }

  // Walk document boundaries and keep whole documents only.
  const marker = /\n\[SOURCE DOCUMENT: ([^\]]+)\]\n/g;
  const starts: Array<{ name: string; at: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = marker.exec(content)) !== null) starts.push({ name: m[1], at: m.index });

  let cut = content.length;
  const kept: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].at : content.length;
    if (end > KB_CHAR_LIMIT) {
      cut = starts[i].at;
      break;
    }
    kept.push(starts[i].name);
  }

  // A single document larger than the cap would otherwise cut at offset 0 and
  // hand the model an EMPTY corpus — the header would say "0 documents" and a
  // fresh install whose first upload is one big PDF gets a bot that knows
  // nothing at all. Half a corpus is worth more than none, so keep a prefix of
  // that first document instead — and say so IN THE HEADER, not just the log,
  // or the model is told it holds a complete file it only partly received and
  // Rule 1 then authorises citing it for content it never saw.
  let truncatedMidDocument: string | null = null;
  if (kept.length === 0 && starts.length > 0) {
    cut = KB_CHAR_LIMIT;
    truncatedMidDocument = starts[0].name;
    kept.push(starts[0].name);
  }

  const omitted = fileList.filter(f => !kept.includes(f));
  console.warn(
    `[loader] corpus is ${content.length} chars, over the ${KB_CHAR_LIMIT} limit — ` +
      `${omitted.length} document(s) omitted from the prompt: ${omitted.join(", ")}` +
      (truncatedMidDocument
        ? ` (and "${truncatedMidDocument}" is itself larger than the limit, so only its first ${KB_CHAR_LIMIT} characters are included)`
        : "")
  );

  return (
    `### LORE SOURCE SUMMARY\nThe following ${kept.length} document(s) are loaded into your ` +
    `knowledge base: ${kept.join(", ")}\n\n` +
    (truncatedMidDocument
      ? `"${truncatedMidDocument}" is TRUNCATED: it is larger than this prompt allows, so only ` +
        `its first ${KB_CHAR_LIMIT} characters are present. Cite it only for what you can ` +
        `actually read above. If a question needs a later part of it, say that you do not have ` +
        `that part.\n\n`
      : "") +
    `${omitted.length} further document(s) exist in this campaign but did NOT fit in this ` +
    `prompt and are NOT available to you: ${omitted.join(", ")}. Do not cite them, and do not ` +
    `claim knowledge of their contents. If a question needs one of them, say so.\n\n` +
    content.slice(0, cut)
  );
}
