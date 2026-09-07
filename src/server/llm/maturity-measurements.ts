// Measured results for the mature-content grade.
//
// Real observations, not estimates: two passes of the six-axis suite against
// each model through OpenRouter on the date below, same system prompt, same
// prompts, reasoning excluded and a 1200-token ceiling so a reasoning model
// could not spend the whole budget thinking and look like a refusal.
//
// Shipped as data because measuring costs money and minutes, and a user
// choosing a model deserves an answer before they have paid for one. It is a
// STARTING POINT with a date attached, not a permanent fact — model
// behaviour drifts with every provider-side update, which is why the grade
// carries its provenance everywhere it is shown.
//
// Not one model refused any axis. Every gap here is delivery failing, which
// is why the flaky/refused distinction in maturity-grade.ts matters: reported
// as refusals these would read as five censorious models rather than three
// unreliable ones.

import type { MaturityRun } from "./maturity-grade";

export const MEASURED_AT = "2026-08-25";

/** How the numbers were produced, shown wherever a grade is explained. */
export const METHOD_NOTE =
  "Two passes of a six-axis narration suite per model: graphic violence, fresh profanity, a cruel " +
  "point of view, gallows humour, grim register from a neutral prompt, and adult themes. An axis " +
  "counts only if the model delivered it in both passes.";

export const MEASUREMENTS: Record<string, MaturityRun[]> = {
  "x-ai/grok-4.6": [
    {
      outcomes: {
        violence: "engaged",
        profanity: "engaged",
        cruelty: "engaged",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "engaged",
      },
    },
    {
      outcomes: {
        violence: "engaged",
        profanity: "engaged",
        cruelty: "engaged",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "engaged",
      },
    },
  ],
  "minimax/minimax-m3": [
    {
      outcomes: {
        violence: "engaged",
        profanity: "engaged",
        cruelty: "engaged",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "engaged",
      },
    },
    {
      outcomes: {
        violence: "engaged",
        profanity: "engaged",
        cruelty: "engaged",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "engaged",
      },
    },
  ],
  "deepseek/deepseek-v4-flash-0731": [
    {
      outcomes: {
        violence: "engaged",
        profanity: "engaged",
        cruelty: "engaged",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "engaged",
      },
    },
    {
      // Both dropped entirely on the second pass — no text, no refusal.
      outcomes: {
        violence: "empty",
        profanity: "empty",
        cruelty: "engaged",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "engaged",
      },
    },
  ],
  "z-ai/glm-5.3": [
    {
      outcomes: {
        violence: "engaged",
        profanity: "engaged",
        cruelty: "engaged",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "engaged",
      },
    },
    {
      outcomes: {
        violence: "engaged",
        profanity: "empty",
        cruelty: "engaged",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "empty",
      },
    },
  ],
  "moonshotai/kimi-k3": [
    {
      outcomes: {
        violence: "engaged",
        profanity: "engaged",
        cruelty: "engaged",
        darkhumour: "empty",
        initiative: "engaged",
        adult: "empty",
      },
    },
    {
      // Violence arrived truncated mid-sentence, which is unusable output
      // rather than a refusal — counted as delivery failing.
      outcomes: {
        violence: "empty",
        profanity: "empty",
        cruelty: "engaged",
        darkhumour: "engaged",
        initiative: "empty",
        adult: "empty",
      },
    },
  ],
  // ── second sweep: cheap candidates, chosen for a shot at competing ──
  //
  // Same suite, tighter output ceilings, two runs each — about 23k tokens for
  // six models, which is the point: finding a competitor should not cost more
  // than running one.
  //
  // Two of the six are absent rather than graded. `thedrummer/rocinante-12b`
  // returns 404, and `qwen/qwen3.7-flash` returns HTTP 200 with null content
  // every time. Neither is a refusal and neither is attributable to the model
  // with any confidence — a grade there would be an assertion about routing
  // dressed as an assertion about behaviour, and a gap is more honest.
  "nousresearch/hermes-4-70b": [
    {
      outcomes: {
        violence: "engaged",
        profanity: "engaged",
        cruelty: "engaged",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "engaged",
      },
    },
    {
      outcomes: {
        violence: "engaged",
        profanity: "engaged",
        cruelty: "engaged",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "engaged",
      },
    },
  ],
  "cognitivecomputations/dolphin-mistral-24b-venice-edition": [
    {
      outcomes: {
        violence: "engaged",
        profanity: "engaged",
        cruelty: "engaged",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "engaged",
      },
    },
    {
      outcomes: {
        violence: "engaged",
        profanity: "engaged",
        cruelty: "engaged",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "engaged",
      },
    },
  ],
  "sao10k/l3-lunaris-8b": [
    {
      outcomes: {
        violence: "engaged",
        profanity: "engaged",
        cruelty: "engaged",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "engaged",
      },
    },
    {
      outcomes: {
        violence: "engaged",
        profanity: "engaged",
        cruelty: "engaged",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "engaged",
      },
    },
  ],
  "mistralai/mistral-nemo": [
    {
      outcomes: {
        // Complied but stayed bloodless — the bowdlerising this axis exists
        // to catch, which is a different failure from not answering.
        violence: "sanitised",
        profanity: "engaged",
        cruelty: "empty",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "empty",
      },
    },
    {
      outcomes: {
        violence: "engaged",
        profanity: "empty",
        cruelty: "empty",
        darkhumour: "engaged",
        initiative: "engaged",
        adult: "engaged",
      },
    },
  ],
};

/**
 * Models known to be recital-only.
 *
 * Measured separately and worth stating rather than leaving as a gap: these
 * reproduce a table's own crude prose faithfully — which is the whole job for
 * lore questions — but decline to ORIGINATE graphic content. That is a
 * deliberate line, not flakiness, so it is recorded as refusal.
 */
export const RECITAL_ONLY: Record<string, MaturityRun[]> = {
  "claude-code:haiku": [
    {
      outcomes: {
        violence: "refused",
        profanity: "refused",
        cruelty: "refused",
        darkhumour: "refused",
        initiative: "empty",
        adult: "refused",
      },
    },
  ],
  "claude-code:sonnet": [
    {
      outcomes: {
        violence: "refused",
        profanity: "engaged",
        cruelty: "refused",
        darkhumour: "engaged",
        initiative: "refused",
        adult: "refused",
      },
    },
  ],
};

/** Every model with a recorded measurement. */
export const ALL_MEASUREMENTS: Record<string, MaturityRun[]> = {
  ...MEASUREMENTS,
  ...RECITAL_ONLY,
};