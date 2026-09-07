// Names → the units that are about them.
//
// This is the step a person does without noticing: hearing a name and knowing
// it is a person rather than a place, then knowing which page to open. It
// looks like a classification task for a model, and it is not one. If the
// corpus names its subjects — and both of Vault's sources do, via note titles
// or section headings — then resolving a name is a LOOKUP. Lookup cannot
// hallucinate a type, costs microseconds, and is testable.
//
// The index is over SURFACE FORMS, not entities: one subject may be written
// several ways, and a question will use whichever the asker happens to know.
// Longest match wins, so a two-word name is never shadowed by one of its own
// words belonging to somebody else.

import type { LoreUnit } from "./units";

/** Shortest surface form worth indexing. Below this the form matches far more
 *  often by accident than on purpose, and every accidental match costs prompt
 *  space that a real one needed. */
export const MIN_FORM_CHARS = 4;

/** Longest name, in words, that the scanner will look for. Bounds the n-gram
 *  sweep; names longer than this are matched on their first six words. */
export const MAX_FORM_WORDS = 6;

/**
 * Headings and titles that name a SECTION rather than a subject.
 *
 * Campaign documents are written with structural headings — a "History"
 * under every country, a "Background" under every character. Indexed as
 * names, these resolve every question mentioning the word to a scattering of
 * unrelated units, and crowd out the subject the asker actually named.
 *
 * This list covers the common structural vocabulary only. It is deliberately
 * not a general stopword list: real subjects have ordinary-sounding names,
 * and over-filtering here silently loses them. The corpus-derived cap in the
 * mention index handles the long tail without anyone maintaining a list.
 */
export const STRUCTURAL_TITLES = new Set([
  "abilities",
  "appearance",
  "appearances",
  "background",
  "backstory",
  "contents",
  "description",
  "details",
  "equipment",
  "gallery",
  "general",
  "goals",
  "history",
  "hooks",
  "index",
  "inspirations",
  "introduction",
  "inventory",
  "motivations",
  "notes",
  "other",
  "overview",
  "personality",
  "plot hooks",
  "quests",
  "references",
  "relationships",
  "roleplay",
  "rumours",
  "rumors",
  "secrets",
  "sessions",
  "stats",
  "statistics",
  "summary",
  "synopsis",
  "tensions",
  "timeline",
  "traits",
]);

export interface Token {
  /** Lowercased, with a trailing possessive removed. */
  text: string;
  start: number;
  end: number;
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/**
 * Words with their offsets.
 *
 * Possessives are folded (`Someone's` → `someone`) because a question asks
 * about the subject and the corpus writes about their possessions; treating
 * those as different strings would miss most family and ownership mentions,
 * which is exactly the kind of link this retrieval is built to follow.
 */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    let word = m[0].toLowerCase();
    let end = m.index + m[0].length;
    if (word.endsWith("'s") || word.endsWith("’s")) {
      end -= 2;
      word = word.slice(0, -2);
    } else if (word.endsWith("s'") || word.endsWith("s’")) {
      end -= 1;
      word = word.slice(0, -1);
    }
    if (word) out.push({ text: word, start: m.index, end });
  }
  return out;
}

/** The lookup key for a run of words. */
export function formKey(words: string[]): string {
  return words.join(" ");
}

/** Normalise a written name to its lookup key, so callers do not have to
 *  know how tokenisation works. */
export function normaliseForm(raw: string): string {
  return formKey(tokenize(raw).map(t => t.text));
}

export interface SurfaceEntry {
  /** The key as written by whoever first declared it, for display. */
  display: string;
  /** Units this form names. More than one is normal — two subjects can share
   *  a family name — and the planner includes all of them rather than
   *  guessing which was meant. */
  unitIds: string[];
}

export interface SurfaceIndex {
  /** Normalised form → entry. */
  forms: Map<string, SurfaceEntry>;
  /** Word count of the longest indexed form, to bound the scan. */
  maxWords: number;
}

function eligible(form: string): boolean {
  if (form.length < MIN_FORM_CHARS) return false;
  if (STRUCTURAL_TITLES.has(form)) return false;
  // A form that is entirely digits is a number, not a name. Section headings
  // like "1" and years are common and match constantly.
  if (/^[\d\s-]+$/.test(form)) return false;
  return true;
}

/** Every surface form a unit answers to: its title, and any declared alias. */
export function formsOf(unit: LoreUnit): string[] {
  const raw = [unit.title, ...unit.aliases];
  const out: string[] = [];
  for (const r of raw) {
    const key = normaliseForm(r);
    if (eligible(key)) out.push(key);
  }
  return [...new Set(out)];
}

export function buildSurfaceIndex(units: LoreUnit[]): SurfaceIndex {
  const forms = new Map<string, SurfaceEntry>();
  let maxWords = 1;
  for (const unit of units) {
    for (const form of formsOf(unit)) {
      const words = form.split(" ").length;
      if (words > MAX_FORM_WORDS) continue;
      maxWords = Math.max(maxWords, words);
      const existing = forms.get(form);
      if (existing) {
        if (!existing.unitIds.includes(unit.id)) existing.unitIds.push(unit.id);
      } else {
        forms.set(form, { display: unit.title, unitIds: [unit.id] });
      }
    }
  }
  return { forms, maxWords };
}

export interface FormMatch {
  form: string;
  entry: SurfaceEntry;
  /** Offsets into the scanned text. */
  start: number;
  end: number;
}

/**
 * Every indexed name occurring in a piece of text, longest match first and
 * non-overlapping.
 *
 * Longest-first matters more than it looks. A corpus routinely holds a family
 * name as its own subject and several people who carry it; matching the short
 * form first would resolve a full name to the family and never reach the
 * person. Non-overlapping then stops the same words being counted twice.
 *
 * Used for two different jobs — reading the question, and scanning a unit's
 * body for mentions — because they are the same job.
 */
export function scanForms(index: SurfaceIndex, text: string): FormMatch[] {
  const tokens = tokenize(text);
  const matches: FormMatch[] = [];
  let i = 0;
  while (i < tokens.length) {
    let hit: FormMatch | null = null;
    const maxN = Math.min(index.maxWords, tokens.length - i);
    for (let n = maxN; n >= 1; n--) {
      const key = formKey(tokens.slice(i, i + n).map(t => t.text));
      const entry = index.forms.get(key);
      if (entry) {
        hit = { form: key, entry, start: tokens[i].start, end: tokens[i + n - 1].end };
        i += n;
        break;
      }
    }
    if (hit) matches.push(hit);
    else i++;
  }
  return matches;
}

export interface ResolvedSubject {
  form: string;
  display: string;
  unitIds: string[];
}

/** Words that open a question rather than name anything in it. */
const INTERROGATIVES = new Set([
  "who", "what", "where", "when", "why", "how", "which", "whose", "whom",
  "is", "was", "are", "were", "did", "does", "do", "can", "could", "has",
  "have", "had", "tell", "me", "about", "the", "a", "an", "of", "in", "at",
  "to", "for", "from", "on", "and", "or", "any", "anything", "know", "there",
  "please", "explain", "describe", "give", "us", "more", "info", "information",
]);

/** Phrases introducing the thing being asked about, for a question typed
 *  without capitals. Longest first so the more specific opener wins. */
const NAME_LEAD_INS = [
  "tell me about",
  "what do you know about",
  "what can you tell me about",
  "who is",
  "who was",
  "who are",
  "what is",
  "what was",
  "where is",
  "where was",
];

/**
 * Names in a question that the corpus has no unit for.
 *
 * The case this exists for is the one a reader hits constantly: somebody
 * mentioned in the lore who never got a page of their own. A person asked
 * about them does not give up — they search the text for the name and read
 * what comes back. Retrieval that can only find subjects with their own unit
 * would answer "I have nothing", while the corpus plainly says who they are.
 *
 * Proper-noun runs are the primary signal. A question typed in lower case
 * has none, so the lead-in phrases are the fallback — less precise, and only
 * consulted when capitalisation gave nothing.
 */
export function extractCandidateNames(index: SurfaceIndex, question: string): string[] {
  const covered: Array<[number, number]> = scanForms(index, question).map(m => [m.start, m.end]);
  const overlapsKnown = (start: number, end: number): boolean =>
    covered.some(([s, e]) => start < e && end > s);

  const out: string[] = [];
  const push = (raw: string, start: number, end: number): void => {
    const key = normaliseForm(raw);
    if (!eligible(key)) return;
    if (key.split(" ").length > MAX_FORM_WORDS) return;
    if (index.forms.has(key)) return;
    if (overlapsKnown(start, end)) return;
    if (!out.includes(key)) out.push(key);
  };

  // Runs of capitalised words, minus any leading question word.
  const CAP_RUN = /\p{Lu}[\p{L}'’-]*(?:[ \t]+\p{Lu}[\p{L}'’-]*)*/gu;
  for (const m of question.matchAll(CAP_RUN)) {
    const words = m[0].split(/[ \t]+/);
    let offset = m.index;
    while (words.length > 0 && INTERROGATIVES.has(words[0].toLowerCase())) {
      offset += words[0].length + 1;
      words.shift();
    }
    if (words.length === 0) continue;
    push(words.join(" "), offset, offset + words.join(" ").length);
  }
  if (out.length > 0) return out;

  // Nothing was capitalised. Fall back to whatever follows a lead-in.
  const lower = question.toLowerCase();
  for (const lead of NAME_LEAD_INS) {
    const at = lower.indexOf(lead);
    if (at === -1) continue;
    const start = at + lead.length;
    const tail = question.slice(start).replace(/[?.!,;:]+.*$/s, "").trim();
    if (!tail) continue;
    const words = tail.split(/\s+/).filter(w => !INTERROGATIVES.has(w.toLowerCase()));
    if (words.length === 0) continue;
    push(words.slice(0, MAX_FORM_WORDS).join(" "), start, start + tail.length);
    break;
  }
  return out;
}

/** Sentinel unit id for a name the corpus never gave a unit to. Distinct from
 *  any real id, so passage filtering and reporting can tell the two apart. */
export function unresolvedUnitId(form: string): string {
  return `name:${form}`;
}

/**
 * A throwaway index over bare names.
 *
 * Built so unresolved names go through exactly the same scan, tokenisation
 * and passage extraction as indexed subjects. A second, parallel matcher for
 * this case would drift from the first one and start disagreeing about
 * possessives or punctuation — the kind of divergence nobody notices until a
 * search quietly stops finding something.
 */
export function surfaceIndexOfNames(names: string[]): SurfaceIndex {
  const forms = new Map<string, SurfaceEntry>();
  let maxWords = 1;
  for (const name of names) {
    const key = normaliseForm(name);
    if (!eligible(key)) continue;
    maxWords = Math.max(maxWords, key.split(" ").length);
    forms.set(key, { display: name, unitIds: [unresolvedUnitId(key)] });
  }
  return { forms, maxWords };
}

/** Merge two indexes for a single scan. The left index wins a collision, so
 *  a real subject is never shadowed by a guessed name. */
export function mergeSurfaceIndexes(base: SurfaceIndex, extra: SurfaceIndex): SurfaceIndex {
  const forms = new Map(base.forms);
  for (const [key, entry] of extra.forms) if (!forms.has(key)) forms.set(key, entry);
  return { forms, maxWords: Math.max(base.maxWords, extra.maxWords) };
}

/**
 * The subjects a question is about.
 *
 * Deduplicated by form, preserving the order they were asked in — the first
 * named subject is usually the one the question is really about, and the
 * planner weights accordingly.
 */
export function resolveQuestion(index: SurfaceIndex, question: string): ResolvedSubject[] {
  const seen = new Set<string>();
  const out: ResolvedSubject[] = [];
  for (const m of scanForms(index, question)) {
    if (seen.has(m.form)) continue;
    seen.add(m.form);
    out.push({ form: m.form, display: m.entry.display, unitIds: [...m.entry.unitIds] });
  }
  return out;
}
