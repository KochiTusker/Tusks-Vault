// How much context does a question actually need — HERE, on this install?
//
// "Is this model's window big enough?" has no general answer. It depends
// entirely on how the lore reaches the prompt, and this project has three
// regimes that differ by an order of magnitude:
//
//   folder        every readable document, concatenated. The window has to
//                 hold the whole corpus, so only large models qualify.
//   vault-full    an Obsidian vault small enough to include whole. Same
//                 shape, usually a smaller number.
//   vault-mapped  a one-line digest of every note, plus the handful of notes
//                 the question actually needs. Bounded by a budget rather
//                 than by the size of the campaign — which is what makes a
//                 small-window model viable at all.
//
// So the "context too small" warning on a model cannot be a constant. A 32k
// model is unusable on a folder corpus and perfectly good on a mapped vault,
// and telling the user otherwise in either direction sends them to the wrong
// model.
//
// The degraded case matters most and is the reason this module reports a
// `fix` rather than just a number: a vault too big to include whole, with no
// map built, silently falls back to whole-vault concatenation. The user has
// done the work of atomising their lore and is still paying folder-mode
// prices — and the fix is one button, so say so.

import { getSettings } from "../config/settings";
import { activeVaultPath, listKnowledgeFiles, KB_CHAR_LIMIT } from "./loader";
import { MAPPED_BODY_BUDGET } from "./obsidian/source";
import { readVaultMap, renderMapForPrompt } from "./obsidian/map";
import { walkVaultNotes } from "./obsidian/walk";
import { MAX_UNIT_CHARS } from "./units";
import { isSessionMaterial } from "./sessions";

/** Rough for English prose and close enough for a threshold: the decision
 *  this feeds is "does a 32k window fit a 400k-character corpus", and no
 *  plausible tokeniser changes that answer. */
export const CHARS_PER_TOKEN = 4;

/**
 * Room the prompt needs beyond the lore itself: the archivist instructions,
 * the persona, the retrieved-passage header, the question, and the answer the
 * model still has to write — reasoning models spend the output budget before
 * a visible token appears.
 */
export const RESERVED_TOKENS = 8_000;

/** Compressed formats hold more text than bytes. Applied to the file sizes
 *  of formats that are archives underneath, so a folder of .docx is not
 *  reported as a quarter of its real prompt cost. */
const EXPANSION: Array<[RegExp, number]> = [
  [/\.docx$/i, 2.5],
  [/\.pdf$/i, 1.2],
];

/** A note bigger than this is not a retrieval unit, it is a document that
 *  happens to be one file. Same threshold the sectioner uses to decide a
 *  span is too big to keep whole, so "coarse" means the same thing in both
 *  places. */
const COARSE_NOTE_CHARS = MAX_UNIT_CHARS;

export type ContextRegime = "folder" | "vault-full" | "vault-mapped";

export interface ContextRequirement {
  /** Smallest context window a model needs to answer a question here. */
  tokens: number;
  /** Lore characters reaching the prompt, before the reserve. */
  loreChars: number;
  regime: ContextRegime;
  notesTotal: number;
  /** What one question would cost with no retrieval at all — the whole
   *  campaign, every time. The number the regimes are measured against. */
  corpusChars: number;
  /**
   * How much work the vault's organisation is doing: `corpusChars` over
   * `loreChars`. 1 means every question drags the entire campaign; 8 means a
   * question reads an eighth of it.
   *
   * This is the barometer for whether a modest model can be accurate here.
   * The tokens a model must sift to find one fact is the thing an atomised
   * vault reduces, and a model asked to find a sentence in eight thousand
   * tokens has an easier job than the same model asked to find it in seventy
   * thousand — regardless of how it scored in the suites.
   */
  selectivity: number;
  /**
   * Reference notes too large to be a retrieval unit. Retrieval pulls whole
   * notes, so a hit on a 40k-character note drags 39k characters of unrelated
   * material in with the answer. A vault of these has a good selectivity
   * number and a bad signal-to-noise ratio, which is the failure the number
   * alone would hide.
   *
   * Session records are excluded, and that is not a fudge. A session log is
   * one evening — the temporal tier pins it whole, and "what happened last
   * session" is answered by having all of it. Counting them here would report
   * a healthy campaign as badly filed and push the user to split the one kind
   * of note that must not be split.
   */
  coarseNotes: number;
  /**
   * Set when the setup costs more context than it needs to, with the action
   * that would fix it. Not an error: an unmapped vault answers questions
   * perfectly well, it just cannot do it on a small model.
   */
  degraded?: { reason: string; fix: string };
  /** What `tokens` would fall to once `degraded` is resolved. Present only
   *  alongside it, so the UI can say what the fix is worth. */
  couldBeTokens?: number;
}

const toTokens = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN) + RESERVED_TOKENS;

/** Round up to something a person would repeat out loud. A requirement of
 *  "34,812 tokens" invites false precision about an estimate. */
const round = (tokens: number): number => {
  if (tokens < 16_000) return Math.ceil(tokens / 1_000) * 1_000;
  return Math.ceil(tokens / 4_000) * 4_000;
};

/**
 * Measure the current install, from file sizes only.
 *
 * Deliberately no reads: this is called whenever the model catalogue is
 * fetched, and extracting a folder of .docx to get an exact byte count would
 * turn browsing models into a multi-second operation. The estimate decides a
 * threshold, not a budget.
 */
export function measureContextRequirement(): ContextRequirement {
  const vault = activeVaultPath();

  if (!vault) {
    const files = listKnowledgeFiles().filter(f => f.indexed);
    let corpusChars = 0;
    let coarseNotes = 0;
    for (const f of files) {
      const factor = EXPANSION.find(([re]) => re.test(f.name))?.[1] ?? 1;
      const chars = f.size * factor;
      corpusChars += chars;
      if (chars > COARSE_NOTE_CHARS && !isSessionMaterial(f.name)) coarseNotes++;
    }
    // The concatenation is capped, so the requirement is too — past the cap
    // the corpus is truncated rather than the prompt growing. Note that this
    // does NOT count as selectivity: dropping the tail of the corpus is data
    // loss, and reporting it as retrieval doing its job would be a lie that
    // flatters the worst possible setup.
    const loreChars = Math.min(corpusChars, KB_CHAR_LIMIT);
    return {
      tokens: round(toTokens(loreChars)),
      loreChars,
      regime: "folder",
      notesTotal: files.length,
      corpusChars,
      selectivity: 1,
      coarseNotes,
    };
  }

  const notes = walkVaultNotes(vault);
  const corpusChars = notes.reduce((n, note) => n + note.sizeBytes, 0);
  const coarseNotes = notes.filter(
    n => n.sizeBytes > COARSE_NOTE_CHARS && !isSessionMaterial(n.relPath)
  ).length;
  const settings = getSettings();
  const map = readVaultMap(vault);
  const mapChars = map && map.notes.length > 0 ? renderMapForPrompt(map).length : 0;

  // A vault under the body budget is included whole, and mapped mode would
  // make the prompt LARGER — a map header on top of content that already fit.
  if (corpusChars <= MAPPED_BODY_BUDGET) {
    const loreChars = Math.min(corpusChars, KB_CHAR_LIMIT);
    return {
      tokens: round(toTokens(loreChars)),
      loreChars,
      regime: "vault-full",
      notesTotal: notes.length,
      corpusChars,
      selectivity: 1,
      coarseNotes,
    };
  }

  const mappedChars = mapChars + MAPPED_BODY_BUDGET;
  const mappedTokens = round(toTokens(mappedChars));

  if (settings.useVaultMap && mapChars > 0) {
    return {
      tokens: mappedTokens,
      loreChars: mappedChars,
      regime: "vault-mapped",
      notesTotal: notes.length,
      corpusChars,
      // The only regime where retrieval actually selects, so the only one
      // where this can be anything but 1.
      selectivity: Math.max(1, corpusChars / mappedChars),
      coarseNotes,
    };
  }

  // Big vault, no usable map — retrieval falls back to whole-vault
  // concatenation. Report what it costs NOW and what the fix is worth,
  // because the gap between the two is the entire argument for the fix.
  const loreChars = Math.min(corpusChars, KB_CHAR_LIMIT);
  return {
    tokens: round(toTokens(loreChars)),
    loreChars,
    regime: "vault-full",
    notesTotal: notes.length,
    corpusChars,
    selectivity: 1,
    coarseNotes,
    degraded: settings.useVaultMap
      ? {
          reason: "This vault is too large to send whole, and no vault map has been built yet.",
          fix: "Build the vault map to send a digest plus the notes each question needs.",
        }
      : {
          reason: "This vault is too large to send whole, and selective retrieval is switched off.",
          fix: "Turn on the vault map to send a digest plus the notes each question needs.",
        },
    couldBeTokens: mapChars > 0 ? mappedTokens : round(toTokens(MAPPED_BODY_BUDGET)),
  };
}

/** One line for the UI, in the user's terms rather than the module's. */
export function describeRequirement(req: ContextRequirement): string {
  const k = `${Math.round(req.tokens / 1000)}k`;
  switch (req.regime) {
    case "vault-mapped":
      return `Your vault sends a map of ${req.notesTotal} notes plus the ones each question needs, so a model needs about ${k} of context.`;
    case "vault-full":
      return `Your whole vault of ${req.notesTotal} notes goes into every prompt, so a model needs about ${k} of context.`;
    default:
      return `Your lore folder goes into every prompt whole, so a model needs about ${k} of context.`;
  }
}

/**
 * What the vault's organisation is buying, said plainly — or what it is
 * costing when it buys nothing.
 *
 * The reason this is worth a sentence of its own rather than a number in a
 * table: it is the one figure the user can change. The grades are fixed
 * properties of the models; this is a property of their own filing.
 */
export function describeSelectivity(req: ContextRequirement): string | null {
  if (req.selectivity < 1.5) {
    return req.regime === "folder"
      ? "Every question reads your whole lore folder, so the model has to find one fact in all of it. Atomising it into a vault is what makes that job smaller."
      : "Every question reads your whole vault, so the model has to find one fact in all of it.";
  }
  const factor = req.selectivity >= 10 ? Math.round(req.selectivity) : req.selectivity.toFixed(1);
  const base =
    `Your vault is well enough organised that a question reads about 1/${factor} of it. ` +
    "That is the job getting smaller, not just cheaper — a model looking for one fact in " +
    "a focused prompt is more likely to find it than the same model searching the whole campaign.";
  if (req.coarseNotes > 0) {
    // The ratio alone would call a vault of five enormous notes well
    // organised. It is not: retrieval pulls whole notes, so one hit drags all
    // of it in and the focus the number claims is not really there.
    const one = req.coarseNotes === 1;
    return (
      `${base} ${req.coarseNotes} note${one ? " is" : "s are"} large enough that retrieving ` +
      `${one ? "it" : "one"} pulls in a lot of unrelated text — splitting ` +
      `${one ? "it" : "them"} would sharpen this further.`
    );
  }
  return base;
}
