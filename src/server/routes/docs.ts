// In-app docs viewer backend — mirror of Tusk's Tomes' server/api/docs.ts.
//
// At startup we enumerate the user-facing markdown files (everything under
// docs/ plus README.md, CONTRIBUTING.md, ROADMAP.md, SECURITY.md,
// CODE_OF_CONDUCT.md at the repo root) and build a slug→path map. CLAUDE.md
// is excluded — it's a developer guide scoped to Claude Code sessions,
// not user-facing documentation.
//
// Slugs are derived deterministically from the file path:
//   docs/surfaces/discord.md → "docs-surfaces-discord"
//   README.md                → "readme"
// The /api/docs/:slug route ONLY looks up paths through this Map. There is
// no string concatenation of user input with disk paths — by construction,
// path traversal is impossible. Slug regex (/^[a-z0-9-]+$/) is a second
// belt-and-braces guard.

import { Router } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";

// process.cwd() points at the repo root for both `tsx server.ts` (dev) and
// `node dist/server.js` (production builds). Mirrors how the existing
// updates / personas routers resolve filesystem paths.
const REPO_ROOT = process.cwd();

const SLUG_RE = /^[a-z0-9-]+$/;

/** Files outside `docs/` we want surfaced in the help viewer. */
const ROOT_LEVEL_DOCS = [
  "README.md",
  "CONTRIBUTING.md",
  "ROADMAP.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
];

export interface DocEntry {
  slug: string;
  title: string;
  path: string;
}

interface DocRecord extends DocEntry {
  absPath: string;
}

let cachedDocs: Map<string, DocRecord> | null = null;

function slugFromRelPath(relPath: string): string {
  const noExt = relPath.replace(/\.md$/i, "");
  const dashed = noExt.replace(/[\\/]/g, "-").toLowerCase();
  return dashed
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Most H1s carry the project name so a doc reads correctly when opened on
// its own, on GitHub or in a browser tab: "Installation — Tusk's Vault".
// In a list inside the app that name is on every row and in the header
// above it, which turns the Help tab into a column of the same three words.
// Keep what comes BEFORE the separator; that is the subject. A title that
// is ONLY the project name keeps its full form rather than becoming empty.
//
// The static site generator applies the same strip so a doc is listed under
// one name in both places.
function stripProjectName(title: string): string {
  const stripped = title
    // Leading pictographs + variation selectors first, so a title that
    // opens with an emoji still matches the leading-name strip below.
    .replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, "")
    .replace(/\s*[—–-]\s*Tusk['’]s Vault\b.*$/u, "")
    .replace(/^Tusk['’]s Vault\s*[—–-]\s*/u, "")
    .replace(/\s+to Tusk['’]s Vault$/u, "")
    .trim();
  return stripped || title;
}

async function extractTitle(absPath: string, fallback: string): Promise<string> {
  try {
    const buf = await fs.readFile(absPath, "utf8");
    const match = buf.match(/^#\s+(.+?)\s*$/m);
    if (match?.[1]) return stripProjectName(match[1].trim());
  } catch {
    // fall through
  }
  return fallback;
}

async function walkDocsDir(dir: string, relBase: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      // docs/dev/ is maintainer planning material, not user documentation.
      // It is stripped from public releases via .public-exclude, so a user
      // never receives it — but on a dev clone it would otherwise appear in
      // the Help tab, which this route describes as user-facing docs.
      if (rel === "dev" || rel.startsWith("dev/")) continue;
      // docs/assets/ holds the images the docs embed, plus a README that
      // explains the folder to contributors. The published site skips that
      // README for the same reason: it is a note about a directory, not a
      // page anyone opens to learn how to use Vault.
      if (rel === "assets" || rel.startsWith("assets/")) continue;
      out.push(...(await walkDocsDir(abs, rel)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      // docs/README.md is the published site's /docs/ landing page. In the
      // app the Help tab already is that index — tiles, blurbs, same shelves —
      // so listing it here would be a tile that opens a list of the tiles.
      if (rel.toLowerCase() === "readme.md") continue;
      out.push(`docs/${rel}`);
    }
  }
  return out;
}

export async function buildDocsMap(repoRoot: string): Promise<Map<string, DocRecord>> {
  const map = new Map<string, DocRecord>();
  const docsDir = path.join(repoRoot, "docs");

  const docsRelPaths = await walkDocsDir(docsDir, "");
  const rootRelPaths: string[] = [];
  for (const name of ROOT_LEVEL_DOCS) {
    try {
      await fs.access(path.join(repoRoot, name));
      rootRelPaths.push(name);
    } catch {
      // skip missing root docs
    }
  }

  const allRelPaths = [...rootRelPaths, ...docsRelPaths];
  for (const relPath of allRelPaths) {
    const slug = slugFromRelPath(relPath);
    if (!SLUG_RE.test(slug)) {
      console.warn(`[docs] rejecting slug "${slug}" from "${relPath}" — fails regex`);
      continue;
    }
    if (map.has(slug)) {
      console.warn(`[docs] duplicate slug "${slug}" — keeping first occurrence`);
      continue;
    }
    const absPath = path.join(repoRoot, relPath);
    const fallbackTitle = path.basename(relPath, ".md");
    const title = await extractTitle(absPath, fallbackTitle);
    map.set(slug, { slug, title, path: relPath, absPath });
  }
  return map;
}

async function getDocs(): Promise<Map<string, DocRecord>> {
  if (!cachedDocs) cachedDocs = await buildDocsMap(REPO_ROOT);
  return cachedDocs;
}

export const docsRouter = Router();

docsRouter.get("/api/docs", async (_req, res) => {
  try {
    const docs = await getDocs();
    const entries: DocEntry[] = [...docs.values()].map(({ slug, title, path: p }) => ({
      slug,
      title,
      path: p,
    }));
    // Stable order: root docs first, then docs/ alphabetical.
    entries.sort((a, b) => {
      const aRoot = !a.path.includes("/");
      const bRoot = !b.path.includes("/");
      if (aRoot !== bRoot) return aRoot ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
    res.json({ docs: entries });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// AUDIT: the slug is a registry key, never a filesystem path — entries are
// enumerated server-side at startup and the param only selects one of them
// (plus the SLUG_RE shape check). No safe-slug needed on this route.
docsRouter.get("/api/docs/:slug", async (req, res) => {
  const slug = req.params.slug;
  if (!SLUG_RE.test(slug)) {
    return res.status(400).json({ error: "invalid slug" });
  }
  const docs = await getDocs();
  const entry = docs.get(slug);
  if (!entry) return res.status(404).json({ error: "doc not found" });
  try {
    const content = await fs.readFile(entry.absPath, "utf8");
    res.json({
      slug: entry.slug,
      title: entry.title,
      path: entry.path,
      content,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
