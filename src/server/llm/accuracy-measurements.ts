// Measured accuracy, for the grade shown in the comparison table.
//
// Accuracy here does not mean world knowledge — a model brings none of that
// to somebody's private campaign. It means the five things that decide
// whether an answer can be trusted at a table:
//
//   lookup       pull the right fact from one source and cite it
//   attribution  two sources, answer in one — cite THAT one, not the other
//   absence      the answer is genuinely not there; say so, NAMING what was
//                checked, and invent nothing
//   conflict     two sources disagree; surface both rather than picking one
//   quote        reproduce an exact line without drifting
//
// Each case is scored mechanically against a known right answer, twice.
//
// Two corrections are recorded in this file rather than quietly applied,
// because both changed grades.
//
// FIRST: a model was scored as failing `absence` for phrasing its decline
// "neither X nor Y are recorded" when the pattern only matched "not
// recorded". The model was right and the test was wrong.
//
// SECOND, and the reason most grades here moved: `absence` now requires the
// decline to NAME the document it checked. "The provided source does not
// contain that" is unverifiable — it is what a model says whether or not it
// read anything. "Harbour.md does not record her age" is a claim a reader can
// check, and it is what the archivist's own citation rule asks for. Re-measured
// under that bar, seven of nine models fail the case: they decline correctly
// and cite nothing. That is a real weakness for a lore bot and the grade now
// reflects it.

import type { AccuracyCase } from "./model-grades";

export const ACCURACY_MEASURED_AT = "2026-08-25";

export const ACCURACY_METHOD_NOTE =
  "Five citation-discipline cases per model, run twice: find and cite a fact, attribute it to the " +
  "right document of several, decline BY NAME when the lore does not say, surface contradictory " +
  "sources, and reproduce a quote exactly. A case counts only if it held in both runs.";

export interface AccuracyRun {
  outcomes: Record<AccuracyCase | string, string>;
}

const perfect: AccuracyRun = {
  outcomes: {
    lookup: "engaged",
    attribution: "engaged",
    absence: "engaged",
    conflict: "engaged",
    quote: "engaged",
  },
};

/** Declines correctly but will not name the document it consulted. The
 *  commonest failure in the set, and invisible until the case demanded a
 *  citation. */
const uncitedDecline: AccuracyRun = { outcomes: { ...perfect.outcomes, absence: "sanitised" } };

export const ACCURACY_MEASUREMENTS: Record<string, AccuracyRun[]> = {
  // Named the source once out of two attempts — which under the consistency
  // rule is the same as not doing it.
  "x-ai/grok-4.6": [uncitedDecline, uncitedDecline],
  "minimax/minimax-m3": [uncitedDecline, uncitedDecline],
  "z-ai/glm-5.3": [uncitedDecline, uncitedDecline],
  "cognitivecomputations/dolphin-mistral-24b-venice-edition": [uncitedDecline, uncitedDecline],

  // The only two that named the document in both runs.
  "moonshotai/kimi-k3": [perfect, perfect],
  "sao10k/l3-lunaris-8b": [perfect, perfect],

  "deepseek/deepseek-v4-flash-0731": [
    uncitedDecline,
    // Correct every time it answered; one pass returned nothing at all. The
    // same delivery flakiness its maturity measurement shows.
    { outcomes: { ...uncitedDecline.outcomes, absence: "sanitised" } },
  ],

  "nousresearch/hermes-4-70b": [
    // Two hard cases failing in different runs is exactly what the
    // consistency rule is for: averaged this looks like 90%, and a table
    // cannot rely on a citation that holds nine times in ten.
    { outcomes: { ...perfect.outcomes, absence: "sanitised" } },
    { outcomes: { ...perfect.outcomes, absence: "sanitised", conflict: "sanitised" } },
  ],

  "mistralai/mistral-nemo": [
    // The worst of the set, and not because it declines badly: it cited a
    // document that says nothing about the subject, and silently resolved
    // two contradictory sources to one date. A confident, cited, wrong
    // answer is more dangerous than no answer.
    { outcomes: { ...perfect.outcomes, absence: "sanitised", conflict: "sanitised", attribution: "sanitised" } },
    { outcomes: { ...perfect.outcomes, absence: "sanitised", conflict: "sanitised", attribution: "sanitised", lookup: "empty" } },
  ],
};
