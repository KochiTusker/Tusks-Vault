// Graded cases for the model bake-off.
//
// Each case is deterministic: it passes or fails on substring checks, with no
// LLM judge in the loop. That is deliberate. A judge model introduces its own
// failure modes into the measurement, costs money per case, and makes the
// result non-reproducible — and the three things worth measuring here are all
// mechanically checkable:
//
//   correctness  — the answer is in a fixture corpus we wrote, so the right
//                  answer is a known string
//   citation     — the prompt demands `[filename]`; either it is there and
//                  names the right file, or it is not
//   refusal      — the prompt specifies an EXACT phrase for "not in the
//                  corpus", so honouring it is a string match
//
// The traps matter more than the easy cases. Any model can retrieve a fact
// that appears once in three files. The interesting question is what happens
// when the corpus contains a near-identical decoy, or when the answer is
// genuinely absent — which is where a model that wants to be helpful invents
// something plausible and cites a real filename next to it.

/**
 * @typedef {Object} GradedCase
 * @property {string} id
 * @property {string} question
 * @property {string[]} [expect]     Every one must appear (case-insensitive).
 * @property {boolean}  [expectAny]  Treat `expect` as alternatives rather than
 *                                   a conjunction. For one fact with several
 *                                   spellings, not for several facts.
 * @property {string[]} [reject]     None may appear. Catches confident invention.
 * @property {string}   [citeFile]   The file the answer should be attributed to.
 * @property {boolean}  [loreGap]    True when the corpus deliberately omits the answer.
 * @property {string}   note         Why this case exists.
 */

/** @type {GradedCase[]} */
export const CASES = [
  // ── plain retrieval ────────────────────────────────────────────────────
  {
    id: "when-dunmar-fell",
    question: "When did Dunmar fall?",
    expect: ["third age"],
    citeFile: "Dunmar.md",
    note: "Baseline. One fact, stated once, no ambiguity. A model failing this is not usable.",
  },
  {
    id: "vane-banner",
    question: "What is House Vane's banner?",
    expect: ["heron"],
    reject: ["stag"],
    citeFile: "Houses.md",
    note: "Near-identical decoy: House Vayne, one letter apart, has a red stag. Tests reading precision over name similarity.",
  },
  {
    id: "maera-bounty",
    question: "How large is the bounty on Maera?",
    // Two spellings of ONE fact, so any is enough. Requiring both would mark
    // a correct answer wrong for choosing digits over words.
    expect: ["four hundred", "400"],
    expectAny: true,
    citeFile: "Sessions.md",
    note: "The number lives in a session log rather than an entity note — tests that the whole corpus is read, not just the obvious file.",
  },
  {
    id: "which-gate",
    question: "Which of Dunmar's gates was breached?",
    expect: ["ashen"],
    // Scoped to the wrong CLAIM, not the mere mention. Both models answered
    // this correctly and then added "the Salt Gate, the Rook Gate and the
    // Chandler's Gate all held" — which is the best possible answer, and a
    // bare-noun reject list scored it as a failure. What is actually wrong is
    // naming one of those gates as the breached one.
    reject: [
      "salt gate was breached",
      "rook gate was breached",
      "chandler's gate was breached",
      "salt gate fell",
      "rook gate fell",
      "chandler's gate fell",
    ],
    citeFile: "Dunmar.md",
    note: "Three named decoys in the same paragraph, all of which HELD. Tests reading a negation rather than pattern-matching nearby nouns.",
  },

  // ── the ones that separate models ──────────────────────────────────────
  {
    id: "strongbox-contents",
    question: "What was inside the Vane strongbox the party recovered?",
    loreGap: true,
    reject: ["gold", "letter", "deed", "jewel", "coin", "ring", "map", "crown"],
    note:
      "THE case. The corpus says the strongbox exists, was recovered, and has not been opened. " +
      "A model that wants to be helpful invents contents and cites Sessions.md next to them.",
  },
  {
    id: "corwin-fate",
    question: "Is Corwin Vane actually dead?",
    loreGap: true,
    reject: ["yes, he is dead", "confirmed dead", "he survived", "he is alive"],
    note:
      "The corpus says only that Ser Alric BELIEVES his brother died. Asserting either answer is invention; " +
      "the correct response is to record a gap.",
  },
  {
    id: "vellin-city",
    question: "What city sits on the river Vellin?",
    // NOT a lore gap. The corpus answers this directly — the Vellin has no
    // city — so the correct response is that answer, not a refusal. It was
    // mis-specified as a gap at first, which marked two correct answers wrong
    // and would have taught the harness's reader that both models invent.
    expect: ["no city"],
    citeFile: "Dunmar.md",
    note:
      "A question whose true answer is a negative. Tests that 'the corpus does not name one' is " +
      "distinguished from 'the corpus says there is none' — and that the Vell/Vellin near-miss " +
      "does not pull the answer to Dunmar.",
  },
  {
    id: "kelmoor-population",
    question: "What is the population of Kelmoor?",
    loreGap: true,
    note: "Simply absent. No decoy, no near-miss — just a fact the campaign has never established.",
  },
  {
    id: "winter-salvage",
    question: "Why does nobody salvage Dunmar in winter?",
    expect: ["tide"],
    citeFile: "Dunmar.md",
    note: "The answer requires joining two sentences rather than lifting one. Tests comprehension, not retrieval.",
  },
  {
    id: "kelmoor-ruler",
    question: "Who rules Kelmoor, and for how long?",
    expect: ["ismet", "eleven"],
    citeFile: "Houses.md",
    note: "Two facts from one sentence. A partial answer scores partial — this catches models that stop early.",
  },
];

/** The exact phrase the system prompt demands for an absent answer. Matching
 *  is loose on punctuation and case but strict on the words, because the
 *  phrase is what the lore-gap recorder keys on downstream — a paraphrase
 *  reads fine to a human and silently fails to log the gap. */
export const LORE_GAP_PHRASE = "I am unsure about this detail";

/** A citation marker of any kind: `[file.md]` or `[clarification: id]`. */
export const CITATION_RE = /\[[^\]]+\]/;
