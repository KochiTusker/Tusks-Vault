// Will this campaign fit in this model?
//
// The question a user actually has when they pick a model, and one Vault could
// not answer until now. It matters most in the direction people least expect:
// picking a cheap or free model with a small context window does not make
// answers slightly worse, it makes most of the campaign *invisible*, silently.
//
// The output is a five-band gradient rather than a number because the decision
// it informs is categorical — pick this model or don't — and because the
// underlying estimate is not precise enough to justify a percentage with a
// decimal point on it. See CHARS_PER_TOKEN for why.

export type FitBand = "very-easy" | "easy" | "moderate" | "hard" | "very-hard";

export interface ContextFit {
  band: FitBand;
  /** Prompt tokens as a fraction of what the model can actually take. 1.0
   *  means "exactly full"; above 1.0 means lore is being dropped. */
  pressure: number;
  /** Everything that has to fit: corpus + system prompt + clarifications +
   *  the question itself. */
  promptTokens: number;
  /** Context window minus the output reserve — what is left for input. */
  usableTokens: number;
  /** Tokens that will not fit. Zero unless the band is very-hard. */
  overflowTokens: number;
  /** One line, in the user's terms. Never a bare number. */
  summary: string;
}

/** Room kept for the answer. A lore reply runs long — the measured Discord
 *  answers are several hundred tokens — and a context window that is full to
 *  the brim leaves nowhere to write. */
export const DEFAULT_OUTPUT_RESERVE = 4_000;

/** Everything in the prompt that is not lore: the seven-rule system block, a
 *  persona, retrieved clarifications, the question, the instruction footer.
 *  Measured at ~2.5k on this install's stock prompt; rounded up. */
export const NON_LORE_PROMPT_TOKENS = 3_500;

/** Band thresholds, as a fraction of usable context.
 *
 *  The top band is not "nearly full" — it is "does not fit", which is a
 *  different kind of statement and deserves its own colour. Anything at or
 *  above 1.0 means documents are being dropped, and the user needs to know
 *  that as a fact rather than as a warning about a risk. */
const BANDS: Array<{ band: FitBand; max: number }> = [
  { band: "very-easy", max: 0.25 },
  { band: "easy", max: 0.5 },
  { band: "moderate", max: 0.75 },
  { band: "hard", max: 1.0 },
];

export interface FitInput {
  corpusTokens: number;
  /** The model's context window in tokens. 0 or undefined means unknown —
   *  which is reported as unknown, not guessed at. */
  contextWindow: number;
  outputReserve?: number;
  nonLoreTokens?: number;
}

export function contextFit(input: FitInput): ContextFit {
  const reserve = input.outputReserve ?? DEFAULT_OUTPUT_RESERVE;
  const nonLore = input.nonLoreTokens ?? NON_LORE_PROMPT_TOKENS;
  const promptTokens = input.corpusTokens + nonLore;

  // An unknown context window must not silently render as green. Ollama models
  // and a few catalogue rows report nothing, and "we don't know" is a real
  // answer that a colour cannot express — so it gets the honest band.
  if (!input.contextWindow || input.contextWindow <= 0) {
    return {
      band: "moderate",
      pressure: 0,
      promptTokens,
      usableTokens: 0,
      overflowTokens: 0,
      summary:
        "This model doesn't publish a context window, so Vault can't tell you whether your lore fits. " +
        "Try a question and see.",
    };
  }

  const usableTokens = Math.max(0, input.contextWindow - reserve);
  const pressure = usableTokens > 0 ? promptTokens / usableTokens : Infinity;
  const overflowTokens = Math.max(0, promptTokens - usableTokens);

  const band = BANDS.find(b => pressure < b.max)?.band ?? "very-hard";

  return { band, pressure, promptTokens, usableTokens, overflowTokens, summary: summarise(band, pressure, overflowTokens) };
}

function fmt(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function summarise(band: FitBand, pressure: number, overflow: number): string {
  const pct = Math.round(pressure * 100);
  switch (band) {
    case "very-easy":
      return `Your whole campaign uses about ${pct}% of this model's context. Plenty of room.`;
    case "easy":
      return `Your campaign uses about ${pct}% of this model's context. Comfortable.`;
    case "moderate":
      return `Your campaign uses about ${pct}% of this model's context. It fits, but there is not much headroom for growth.`;
    case "hard":
      return `Your campaign uses about ${pct}% of this model's context. It fits today; a few more sessions will not.`;
    case "very-hard":
      return (
        `Your campaign is about ${pct}% of what this model can read — roughly ${fmt(overflow)} tokens will not fit, ` +
        `and that lore is invisible to the bot. Pick a model with a larger context, or turn on the lore map.`
      );
  }
}

/** Colour token per band, so the dashboard and any future surface agree.
 *  Green through red, matching the maintainer's gradient. */
export const BAND_COLOUR: Record<FitBand, string> = {
  "very-easy": "emerald",
  easy: "green",
  moderate: "amber",
  hard: "orange",
  "very-hard": "red",
};

export const BAND_LABEL: Record<FitBand, string> = {
  "very-easy": "Very easy",
  easy: "Easy",
  moderate: "Moderate",
  hard: "Hard",
  "very-hard": "Very hard",
};
