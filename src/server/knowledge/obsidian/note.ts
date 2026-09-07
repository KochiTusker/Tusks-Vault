// One Obsidian note → the pieces the rest of the pipeline needs.
//
// Obsidian's conventions are not Tusks-Lore's. A note carries a top-level
// YAML frontmatter fence, its title is the filename, and its body is riddled
// with `[[wikilinks]]` and `> [!callout]` markers that read as noise to a
// language model. This module normalises all of that.
//
// The frontmatter parse is deliberately a small hand-rolled reader rather
// than a YAML dependency: we want exactly four shapes (scalar, quoted
// scalar, inline list, block list) from the top-level keys, and a real YAML
// parser would happily throw on a note that Obsidian itself renders fine.
// A malformed fence should cost that note its aliases, not the whole build.
//
// READ-ONLY — see walk.ts for the contract.

import fs from "node:fs";
import { noteTitle } from "./walk";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Frontmatter keys describing how an entity relates to others. Surfaced in
 *  the map so the model can follow the vault's graph without reading notes. */
const RELATION_KEYS = [
  "affiliations",
  "related",
  "patron",
  "allied-with",
  "enemies-with",
  "origin",
  "part-of",
  "location",
];

export interface ParsedNote {
  title: string;
  /** Raw `type:` value, lowercased. Obsidian vaults use their own
   *  vocabulary (npc, faction, deity, plot-thread…), and we keep it verbatim
   *  rather than coercing into a closed set — the map is read by a language
   *  model, which handles "plot-thread" better than "other". */
  type?: string;
  aliases: string[];
  /** `key: [targets]` pairs drawn from RELATION_KEYS, wikilinks resolved. */
  relations: Array<{ key: string; targets: string[] }>;
  /** Frontmatter keys observed, for the structure report. */
  keys: string[];
  /** Note body, frontmatter stripped and wikilinks flattened. */
  body: string;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if (
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

/** `[a, b, "c, d"]` → `["a", "b", "c, d"]`. */
function parseInlineList(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  const out: string[] = [];
  let buf = "";
  let inQuote = false;
  for (const c of inner) {
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (c === "," && !inQuote) {
      const v = stripQuotes(buf.trim());
      if (v) out.push(v);
      buf = "";
      continue;
    }
    buf += c;
  }
  const tail = stripQuotes(buf.trim());
  if (tail) out.push(tail);
  return out;
}

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/** Pull the link targets out of a frontmatter value, falling back to the
 *  bare text when the value isn't a wikilink (both spellings are common). */
function linkTargets(value: string): string[] {
  const links = [...value.matchAll(WIKILINK_RE)].map(m => m[1].split("/").pop()!.trim());
  if (links.length > 0) return links;
  const bare = stripQuotes(value);
  return bare ? [bare] : [];
}

/** Extensions Obsidian embeds as media rather than text. */
const MEDIA_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|mp4|webm|mov|mp3|wav|ogg|m4a|pdf|canvas)$/i;

/**
 * `[[A|B]]` → `B`, `[[A]]` → `A`, and callout markers reduced to plain
 * quotes. A model reading `[[NPCs/Ser Alric|the knight]]` spends attention
 * on syntax; reading "the knight" it spends attention on the campaign.
 *
 * Embeds (`![[x]]`) are transclusions, not links, and need different
 * treatment. A media embed is dropped — we cannot read a PNG, and leaving
 * its filename in the prose reads to the model as a fact about the world.
 * A note embed becomes `(see: Name)`: the pointer is worth keeping, but the
 * embedded note is indexed in its own right, so pasting its title inline as
 * though it were the content would be a lie about what is present.
 */
export function resolveWikilinks(body: string): string {
  return body
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_m, target: string) => {
      const name = target.split("/").pop()!.trim();
      return MEDIA_EXT_RE.test(name) ? "" : `(see: ${name.replace(/\.md$/i, "")})`;
    })
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, _target, alias: string) => alias.trim())
    .replace(/\[\[([^\]]+)\]\]/g, (_m, target: string) => target.split("/").pop()!.trim())
    .replace(/^>\s*\[![a-zA-Z]+\][-+]?\s*/gm, "> ");
}

export function stripFrontmatter(raw: string): string {
  return raw.replace(FRONTMATTER_RE, "");
}

/** Parse one note's raw text. Never throws — a note whose frontmatter is
 *  malformed still contributes its body. */
export function parseNote(raw: string, relPath: string): ParsedNote {
  const title = noteTitle(relPath);
  const body = resolveWikilinks(stripFrontmatter(raw)).trim();
  const fence = raw.match(FRONTMATTER_RE);
  if (!fence) {
    return { title, aliases: [], relations: [], keys: [], body };
  }

  const lines = fence[1].split(/\r?\n/);
  const aliases: string[] = [];
  const relations: Array<{ key: string; targets: string[] }> = [];
  const keys: string[] = [];
  let type: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    // Top-level keys only: an indented `key:` belongs to a nested mapping,
    // and treating it as top-level would invent aliases out of sub-fields.
    const scalar = lines[i].match(/^([A-Za-z_][\w-]*):[ \t]*(.*)$/);
    if (!scalar) continue;
    const key = scalar[1].toLowerCase();
    const value = scalar[2].trim();
    keys.push(key);

    /** The `- item` lines following a `key:` with an empty value. */
    const blockItems = (): string[] => {
      const items: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const item = lines[j].match(/^\s*-\s+(.*)$/);
        if (!item) break;
        items.push(item[1].trim());
      }
      return items;
    };

    if (key === "type") {
      type = stripQuotes(value).toLowerCase() || undefined;
    } else if (key === "aliases" || key === "alias") {
      if (value.startsWith("[")) aliases.push(...parseInlineList(value));
      else if (value) aliases.push(stripQuotes(value));
      else aliases.push(...blockItems().map(stripQuotes).filter(Boolean));
    } else if (RELATION_KEYS.includes(key)) {
      const targets = value.startsWith("[")
        ? parseInlineList(value).flatMap(linkTargets)
        : value
          ? linkTargets(value)
          : blockItems().flatMap(linkTargets);
      const uniq = [...new Set(targets.filter(Boolean))];
      if (uniq.length > 0) relations.push({ key, targets: uniq });
    }
  }

  return { title, type, aliases, relations, keys, body };
}

/** Read + parse one note. Returns null when the file can't be read, so a
 *  permissions hiccup on one note never aborts a whole-vault pass. */
export function readNote(absPath: string, relPath: string): ParsedNote | null {
  let raw: string;
  try {
    raw = fs.readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
  return parseNote(raw, relPath);
}

/** One-line frontmatter summary for the map. Empty when the note declares
 *  nothing structural. */
export function relationLine(note: ParsedNote): string {
  const bits: string[] = [];
  if (note.aliases.length > 0) bits.push(`also known as ${note.aliases.join(", ")}`);
  for (const rel of note.relations) bits.push(`${rel.key}: ${rel.targets.join(", ")}`);
  return bits.join("; ");
}
