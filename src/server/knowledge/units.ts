// The atom of retrieval.
//
// Vault reads lore from two shapes of source: a folder of documents (a few
// large files, each covering many subjects) and an Obsidian vault (many small
// notes, one subject each). Retrieval wants the same thing from both — a named
// piece of text about ONE subject — so both are reduced to a `LoreUnit` and
// everything downstream is written once.
//
// For a vault that is one note per subject, a unit is a note. For a folder
// document, a unit is a heading-delimited section: the large reference
// documents in a campaign folder are written one heading per character, per
// deity, per country, so their headings already mark the boundaries somebody
// wrote by hand. Splitting there costs nothing and turns a handful of huge
// documents into the same shape the vault source has natively — which is what
// lets the folder source get passage retrieval without anyone restructuring
// their lore first.
//
// Units carry OFFSETS, not bodies. The index is derived data and must stay
// small; the user's prose stays in the user's files, in exactly one copy.

import { createHash } from "node:crypto";

/** Longest a single unit may be before it is split further.
 *
 *  Sections are as long as whoever wrote them made them, and a session log
 *  under one heading can be tens of thousands of characters. An unbounded
 *  unit breaks every budget decision downstream: "include the subject in
 *  full" has to mean something bounded, or the first tier eats the window.
 *  ~5k tokens is a generous page and still leaves room for the tiers below. */
export const MAX_UNIT_CHARS = 20_000;

/** Below this, a trailing fragment is folded back into the previous part
 *  rather than becoming a unit of its own. Prevents a 20,050-character
 *  section producing a second unit holding one sentence. */
const MIN_TAIL_CHARS = 400;

export interface LoreUnit {
  /** Stable identity: `file#Heading`, or the file path for a whole-file unit.
   *  Unique within a corpus; used as the key of every derived index. */
  id: string;
  /** What the unit is about, as a person would name it. A heading, or a note
   *  title. This is also the first surface form the entity index gets. */
  title: string;
  /** Source document, relative to the lore root. Stays the citation marker:
   *  units are an internal subdivision, and a user looking up a citation
   *  needs the file they actually have. */
  file: string;
  /** Character offsets into the source document's extracted text. */
  start: number;
  end: number;
  /** Declared kind (`npc`, `faction`, …) when the source says so. Absent is a
   *  real answer — see the type-inference note in the retrieval planner. */
  type?: string;
  /** Other names this subject goes by. Feeds the surface index. */
  aliases: string[];
  /** Typed edges to other subjects, when the source declares them. */
  relations: Array<{ key: string; targets: string[] }>;
  /** Heading depth this unit was cut at; 0 for a whole file or a note. */
  depth: number;
  /** sha256 of the unit's own text. The incremental key, like the vault map's
   *  per-note hash — editing one section reindexes one section. */
  hash: string;
  /** Length in characters, so callers can budget without re-reading. */
  chars: number;
  /** Set when this unit is one slice of an oversized section: the id the
   *  whole section would have had. Retrieval treats parts independently, but
   *  anything reassembling the source — the vault forge especially — must be
   *  able to put them back together, or one long chapter becomes seven notes
   *  all named after it. */
  partOf?: string;
  /** 1-based position among the parts. Absent for an unsplit unit. */
  partIndex?: number;
}

const HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/** Strip the inline markdown a heading commonly carries so the title reads
 *  as a name. `## **Someone** *(the epithet)*` → `Someone (the epithet)`. */
export function cleanHeading(raw: string): string {
  return raw
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/__([^_]*)__/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) =>
      (alias ?? target.split("/").pop() ?? "").trim()
    )
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

interface HeadingHit {
  level: number;
  title: string;
  /** Offset of the heading line itself. */
  lineStart: number;
  /** Offset just past the heading line — where the section's body begins. */
  bodyStart: number;
}

function findHeadings(text: string): HeadingHit[] {
  const hits: HeadingHit[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    const m = line.match(HEADING_RE);
    if (m) {
      const title = cleanHeading(m[2]);
      if (title) {
        hits.push({ level: m[1].length, title, lineStart: at, bodyStart: at + line.length + 1 });
      }
    }
    at += line.length + 1;
  }
  return hits;
}

/**
 * The heading level a document is actually organised by.
 *
 * Not simply the shallowest heading present. A document that opens with a
 * single `# Title` and then uses `## Subject` per entry is organised by `##`
 * — cutting at `#` would yield one unit containing everything, which is the
 * behaviour this module exists to replace. So: the shallowest level that
 * occurs more than once, falling back to the shallowest level at all.
 *
 * Returns 0 when the document has no usable headings.
 */
export function organisingLevel(text: string): number {
  const hits = findHeadings(text);
  if (hits.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const h of hits) counts.set(h.level, (counts.get(h.level) ?? 0) + 1);
  const levels = [...counts.keys()].sort((a, b) => a - b);
  for (const level of levels) {
    if ((counts.get(level) ?? 0) > 1) return level;
  }
  return levels[0];
}

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Split an oversized span at paragraph boundaries. Parts are labelled so a
 *  citation still points at something a person can find by eye. */
function splitOversized(
  text: string,
  start: number,
  end: number,
  baseTitle: string
): Array<{ title: string; start: number; end: number }> {
  const span = end - start;
  if (span <= MAX_UNIT_CHARS) return [{ title: baseTitle, start, end }];

  const out: Array<{ title: string; start: number; end: number }> = [];
  let cursor = start;
  while (cursor < end) {
    let stop = Math.min(cursor + MAX_UNIT_CHARS, end);
    if (stop < end) {
      // Prefer a paragraph break, then a line break, then the hard cut. A cut
      // mid-sentence is what the corpus truncation used to do, and it is
      // exactly as unreadable at this scale as it was at that one.
      const window = text.slice(cursor, stop);
      const para = window.lastIndexOf("\n\n");
      const line = window.lastIndexOf("\n");
      if (para > MAX_UNIT_CHARS / 2) stop = cursor + para + 2;
      else if (line > MAX_UNIT_CHARS / 2) stop = cursor + line + 1;
    }
    // Don't leave a scrap behind as its own unit.
    if (end - stop < MIN_TAIL_CHARS) stop = end;
    out.push({ title: baseTitle, start: cursor, end: stop });
    cursor = stop;
  }

  return out.length === 1
    ? out
    : out.map((p, i) => ({ ...p, title: `${baseTitle} (part ${i + 1} of ${out.length})` }));
}

export interface SectionOptions {
  /** Title for text preceding the first heading, and for a document with no
   *  headings at all. Defaults to the file's stem — its path minus directories
   *  and extension, which is what a person would call the document. The full
   *  path is a poor title: it is not what anybody calls the thing, and it
   *  becomes a surface form in the name index, where `Some-Doc.md` tokenises
   *  into a two-word "name" that matches nothing anyone would ever ask. */
  documentTitle?: string;
}

/** `Sessions/Some Doc.md` → `Some Doc`. */
export function documentStem(file: string): string {
  const base = file.split(/[\/]/).pop() ?? file;
  return base.replace(/\.[A-Za-z0-9]+$/, "") || base;
}

/**
 * One document's extracted text → units.
 *
 * The preamble before the first heading becomes its own unit when it carries
 * real content: in practice it holds the document's framing, which is worth
 * retrieving and would otherwise be silently dropped.
 */
export function sectionDocument(file: string, text: string, opts: SectionOptions = {}): LoreUnit[] {
  const docTitle = opts.documentTitle ?? documentStem(file);
  if (!text.trim()) return [];

  const level = organisingLevel(text);
  const spans: Array<{ title: string; start: number; end: number; depth: number }> = [];

  if (level === 0) {
    spans.push({ title: docTitle, start: 0, end: text.length, depth: 0 });
  } else {
    const cuts = findHeadings(text).filter(h => h.level === level);
    if (cuts[0].lineStart > 0) {
      const preamble = text.slice(0, cuts[0].lineStart);
      if (preamble.trim().length > 0) {
        spans.push({ title: docTitle, start: 0, end: cuts[0].lineStart, depth: 0 });
      }
    }
    for (let i = 0; i < cuts.length; i++) {
      const end = i + 1 < cuts.length ? cuts[i + 1].lineStart : text.length;
      spans.push({ title: cuts[i].title, start: cuts[i].bodyStart, end, depth: level });
    }
  }

  // Flatten to parts first, THEN assign ids. Deciding the id per span was a
  // bug: a heading-less document is one span, but an oversized one still
  // splits into several parts, and every part inherited the bare file path as
  // its id. Six units sharing one key means five of them are unreachable —
  // the index looks up by id, so they simply stop existing.
  const parts: Array<{ title: string; base: string; start: number; end: number; depth: number }> = [];
  for (const span of spans) {
    if (!text.slice(span.start, span.end).trim()) continue;
    for (const part of splitOversized(text, span.start, span.end, span.title)) {
      parts.push({ ...part, base: span.title, depth: span.depth });
    }
  }

  const wholeFile = parts.length === 1 && parts[0].depth === 0;
  const seen = new Map<string, number>();
  const partCounter = new Map<string, number>();
  return parts.map(part => {
    // Two sections under the same heading text are legal and do happen.
    // Disambiguate rather than let one silently replace the other.
    const n = (seen.get(part.title) ?? 0) + 1;
    seen.set(part.title, n);
    const suffix = n > 1 ? `~${n}` : "";
    const body = text.slice(part.start, part.end);
    const groupId = wholeFile ? file : `${file}#${part.base}`;
    const partIndex = part.base !== part.title ? (partCounter.get(groupId) ?? 0) + 1 : undefined;
    if (partIndex !== undefined) partCounter.set(groupId, partIndex);
    return {
      id: wholeFile ? file : `${file}#${part.title}${suffix}`,
      title: part.title,
      ...(partIndex !== undefined ? { partOf: groupId, partIndex } : {}),
      file,
      start: part.start,
      end: part.end,
      aliases: [],
      relations: [],
      depth: part.depth,
      hash: hashOf(body),
      chars: body.length,
    };
  });
}

/**
 * One Obsidian note → one unit.
 *
 * Notes are not sectioned. A note is already the authored boundary for a
 * subject, and its `##` headings are internal structure (Description,
 * Relationships, …) rather than separate subjects — cutting there would
 * scatter one character across six units and make every one of them a worse
 * match than the whole note was.
 */
export function unitFromNote(
  relPath: string,
  parsed: { title: string; type?: string; aliases: string[]; relations: Array<{ key: string; targets: string[] }>; body: string }
): LoreUnit | null {
  if (!parsed.body.trim()) return null;
  return {
    id: relPath,
    title: parsed.title,
    file: relPath,
    start: 0,
    end: parsed.body.length,
    type: parsed.type,
    aliases: parsed.aliases,
    relations: parsed.relations,
    depth: 0,
    hash: hashOf(parsed.body),
    chars: parsed.body.length,
  };
}
