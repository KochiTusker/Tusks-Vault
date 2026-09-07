// The interlinking pass.
//
// Deliberately mechanical, and deliberately AFTER authoring. Once every note
// exists, the set of link targets is known, and finding every place a known
// name occurs in a body of text is a lookup — the same lookup retrieval
// already does exhaustively in a fraction of a second over a whole corpus.
//
// An agent asked to write links as it goes would be slower, would miss the
// mentions it had no index for, and would invent ones it half-remembered.
// Worse, it could not be re-run: links have to be rebuildable every time a
// note is added, or the vault decays the moment anybody edits it.
//
// Reuses the retrieval scanner rather than matching separately, so linking
// and retrieval can never disagree about what counts as a mention of
// somebody — a divergence nobody would notice until a search quietly stopped
// finding something.

import { buildSurfaceIndex, scanForms, type SurfaceIndex } from "../knowledge/surface-index";
import type { LoreUnit } from "../knowledge/units";

export interface LinkTarget {
  /** The note's filename stem — what a `[[link]]` must spell. */
  title: string;
  aliases: string[];
  /** Identity, so a note is never linked to itself. */
  id: string;
}

/** Spans a link must never be written into: fenced code, inline code, and
 *  anything already linked. Rewriting inside those produces broken markdown
 *  or nested links. */
const PROTECTED_SPANS = /```[\s\S]*?```|`[^`\n]*`|\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)/g;

function protectedRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(PROTECTED_SPANS)) out.push([m.index, m.index + m[0].length]);
  return out;
}

export function buildLinkIndex(targets: LinkTarget[]): SurfaceIndex {
  // Reuse the retrieval index by presenting targets as units. Only the
  // fields the index reads are needed.
  const asUnits = targets.map(
    t =>
      ({
        id: t.id,
        title: t.title,
        aliases: t.aliases,
        file: t.id,
        start: 0,
        end: 0,
        relations: [],
        depth: 0,
        hash: "",
        chars: 0,
      }) as LoreUnit
  );
  return buildSurfaceIndex(asUnits);
}

export interface LinkResult {
  text: string;
  /** Distinct notes linked to. */
  linked: string[];
  /** Total links written. */
  count: number;
}

/**
 * Write `[[wikilinks]]` for every known name in one note's body.
 *
 * Each subject is linked ONCE per note, on its first mention. Obsidian shows
 * a backlink whether a name is linked once or forty times, and a paragraph
 * where every proper noun is bracketed is materially harder to read — the
 * vault is for humans first.
 */
export function linkBody(
  body: string,
  index: SurfaceIndex,
  titleOf: Map<string, string>,
  selfId?: string
): LinkResult {
  const skip = protectedRanges(body);
  const inProtected = (start: number, end: number): boolean =>
    skip.some(([s, e]) => start < e && end > s);

  const seen = new Set<string>();
  const edits: Array<{ start: number; end: number; text: string }> = [];

  for (const match of scanForms(index, body)) {
    const targetId = match.entry.unitIds[0];
    if (!targetId || targetId === selfId || seen.has(targetId)) continue;
    if (inProtected(match.start, match.end)) continue;
    const title = titleOf.get(targetId);
    if (!title) continue;

    const written = body.slice(match.start, match.end);
    // Keep the sentence reading as its author wrote it: an alias or a
    // different casing becomes a piped link rather than being replaced by
    // the note's own title.
    const link = written === title ? `[[${title}]]` : `[[${title}|${written}]]`;
    edits.push({ start: match.start, end: match.end, text: link });
    seen.add(targetId);
  }

  // Apply back-to-front so earlier offsets stay valid.
  let out = body;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return { text: out, linked: [...seen], count: edits.length };
}

export interface LinkPassResult {
  /** unitId → linked body. */
  bodies: Map<string, string>;
  totalLinks: number;
  /** Notes nothing linked to. Worth reporting: an island is usually a note
   *  whose subject is named differently everywhere else. */
  orphans: string[];
}

export function linkAll(
  notes: Array<{ id: string; title: string; aliases: string[]; body: string }>
): LinkPassResult {
  const index = buildLinkIndex(notes.map(n => ({ id: n.id, title: n.title, aliases: n.aliases })));
  const titleOf = new Map(notes.map(n => [n.id, n.title]));
  const bodies = new Map<string, string>();
  const linkedTo = new Set<string>();
  let totalLinks = 0;

  for (const note of notes) {
    const result = linkBody(note.body, index, titleOf, note.id);
    bodies.set(note.id, result.text);
    totalLinks += result.count;
    for (const id of result.linked) linkedTo.add(id);
  }

  return {
    bodies,
    totalLinks,
    orphans: notes.filter(n => !linkedTo.has(n.id)).map(n => n.title).sort(),
  };
}
