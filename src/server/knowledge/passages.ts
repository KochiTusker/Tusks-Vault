// A mention, with just enough around it to be worth reading.
//
// The measurement that drove this module: including every document that names
// a subject costs a median of 69k tokens on a large corpus and up to 329k;
// including only the paragraph around each mention costs a median of 8k and
// at most 74k — about 6× less. On a 128k model that is the difference between
// answering roughly a third of entity questions and answering all of them.
//
// It is also what a person actually does. Nobody re-reads a session log
// because a name appears in it once; they find the name and read around it.

import { scanForms, type SurfaceIndex } from "./surface-index";

/** Longest single passage. A paragraph in a session log can run for pages,
 *  and the point of a passage is that it is cheaper than the unit. */
export const PASSAGE_CAP = 1_200;

/** Characters of the neighbouring paragraph pulled in when the matching one
 *  is very short — a line of dialogue attributed on the line before it is
 *  meaningless alone. */
export const SHORT_PASSAGE_FLOOR = 160;

/** Most adjacent mentioning paragraphs folded into one passage.
 *
 *  Merging neighbours is right — two consecutive paragraphs about a subject
 *  are one piece of evidence. Merging without limit is not: a unit where
 *  every paragraph names the subject would collapse into a single passage,
 *  which the length cap then truncates, silently discarding the rest. Bounded
 *  runs keep long stretches as several passages that the caller's limit can
 *  ration honestly. */
const MERGE_RUN = 3;

export interface Passage {
  /** Section heading nearest above the match, when the unit has headings.
   *  Orientation: "this was said under Relationships" changes what it means. */
  heading?: string;
  text: string;
  /** Offsets into the unit's text. */
  start: number;
  end: number;
  /** How many indexed names occur in this passage. Passages naming several
   *  subjects at once are where relationships are stated, so the planner
   *  ranks them up. */
  formsPresent: number;
}

interface Block {
  start: number;
  end: number;
  heading?: string;
}

const HEADING_LINE = /^#{1,6}[ \t]+(.+?)[ \t]*#*$/;

/** Paragraph blocks, each tagged with the heading in force above it. */
function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let heading: string | undefined;
  let at = 0;
  let blockStart = 0;
  let sawContent = false;

  const flush = (end: number): void => {
    if (sawContent && end > blockStart) blocks.push({ start: blockStart, end, heading });
    sawContent = false;
  };

  for (const line of text.split("\n")) {
    const lineEnd = at + line.length;
    const h = line.match(HEADING_LINE);
    if (h) {
      flush(at);
      heading = h[1].trim();
      blockStart = lineEnd + 1;
    } else if (line.trim() === "") {
      flush(at);
      blockStart = lineEnd + 1;
    } else {
      if (!sawContent) blockStart = Math.min(blockStart, at);
      sawContent = true;
    }
    at = lineEnd + 1;
  }
  flush(text.length);
  return blocks;
}

function clamp(text: string, start: number, end: number): { start: number; end: number } {
  if (end - start <= PASSAGE_CAP) return { start, end };
  // Keep the head of the block: a paragraph states its subject early, and a
  // window centred on the match tends to open mid-clause.
  const cut = text.lastIndexOf(" ", start + PASSAGE_CAP);
  return { start, end: cut > start + PASSAGE_CAP / 2 ? cut : start + PASSAGE_CAP };
}

export interface PassageOptions {
  /** Unit ids of the subjects wanted. A passage is kept when a name it
   *  contains resolves to one of them.
   *
   *  Filtering by SUBJECT rather than by the exact wording matters: a subject
   *  is named several ways, and a question asking about someone by their
   *  proper name must still find the passages that call them by an epithet.
   *  Filtering on the form the asker happened to use would miss precisely the
   *  mentions this tier exists to catch.
   *
   *  Omit to return passages for every indexed name found. */
  subjects?: Set<string>;
  /** Stop after this many passages from one unit. A unit that names the
   *  subject forty times is not forty times more informative. */
  limit?: number;
}

/**
 * Passages of `text` that mention one of the requested names.
 *
 * Merges adjacent blocks rather than emitting two passages that touch: two
 * consecutive paragraphs both naming the subject read as one piece of
 * evidence, and splitting them doubles the per-passage overhead for nothing.
 */
export function extractPassages(
  text: string,
  index: SurfaceIndex,
  opts: PassageOptions = {}
): Passage[] {
  const wanted = opts.subjects;
  const limit = opts.limit ?? 8;
  const blocks = blocksOf(text);
  if (blocks.length === 0) return [];

  const matches = scanForms(index, text);
  if (matches.length === 0) return [];

  // Bucket matches into their block. Both lists are in offset order, so this
  // is a merge rather than a search per match.
  const perBlock = new Map<number, { hits: number; wanted: boolean }>();
  let b = 0;
  for (const m of matches) {
    while (b < blocks.length && blocks[b].end <= m.start) b++;
    if (b >= blocks.length) break;
    if (m.start < blocks[b].start) continue;
    const cur = perBlock.get(b) ?? { hits: 0, wanted: false };
    cur.hits++;
    if (!wanted || m.entry.unitIds.some(id => wanted.has(id))) cur.wanted = true;
    perBlock.set(b, cur);
  }

  const chosen = [...perBlock.entries()]
    .filter(([, v]) => v.wanted)
    .map(([i]) => i)
    .sort((a, b2) => a - b2);
  if (chosen.length === 0) return [];

  const passages: Passage[] = [];
  let i = 0;
  while (i < chosen.length && passages.length < limit) {
    let last = i;
    while (
      last + 1 < chosen.length &&
      chosen[last + 1] === chosen[last] + 1 &&
      last - i + 1 < MERGE_RUN
    ) {
      last++;
    }
    const first = blocks[chosen[i]];
    const final = blocks[chosen[last]];
    let { start, end } = clamp(text, first.start, final.end);

    // A very short passage carries no context on its own. Reach back one
    // block for the line that gives it a subject — but only within the same
    // section: reaching across a heading would drag the heading line into the
    // passage and quote it under a section it does not belong to.
    if (end - start < SHORT_PASSAGE_FLOOR && chosen[i] > 0) {
      const prev = blocks[chosen[i] - 1];
      if (prev.heading === first.heading) ({ start, end } = clamp(text, prev.start, end));
    }

    let formsPresent = 0;
    for (let k = i; k <= last; k++) formsPresent += perBlock.get(chosen[k])?.hits ?? 0;

    passages.push({
      heading: first.heading,
      text: text.slice(start, end).trim(),
      start,
      end,
      formsPresent,
    });
    i = last + 1;
  }

  return passages.filter(p => p.text.length > 0);
}
