import { describe, expect, it } from "vitest";
import {
  BAND_COLOUR,
  BAND_LABEL,
  DEFAULT_OUTPUT_RESERVE,
  NON_LORE_PROMPT_TOKENS,
  contextFit,
} from "./context-fit";

/** A large campaign corpus, in tokens. The realistic case throughout: big
 *  enough that model choice starts to matter, which is the point of the
 *  feature under test. */
const LARGE_CORPUS = 290_000;

describe("contextFit — bands", () => {
  const fit = (corpusTokens: number, contextWindow: number) => contextFit({ corpusTokens, contextWindow });

  it("puts a small corpus in a big model at the green end", () => {
    expect(fit(10_000, 1_000_000).band).toBe("very-easy");
  });

  it("walks the bands as pressure rises", () => {
    // Usable = 200k - 4k reserve = 196k. Non-lore adds 3.5k.
    expect(fit(40_000, 200_000).band).toBe("very-easy"); // ~22%
    expect(fit(80_000, 200_000).band).toBe("easy"); // ~43%
    expect(fit(130_000, 200_000).band).toBe("moderate"); // ~68%
    expect(fit(180_000, 200_000).band).toBe("hard"); // ~94%
    expect(fit(250_000, 200_000).band).toBe("very-hard"); // >100%
  });

  it("treats not-fitting as its own band, not merely 'nearly full'", () => {
    // The distinction the whole feature exists for: above 1.0 lore is being
    // DROPPED, which is a fact about the answer rather than a risk to it.
    const r = fit(250_000, 200_000);
    expect(r.band).toBe("very-hard");
    expect(r.overflowTokens).toBeGreaterThan(0);
  });

  it("reports zero overflow whenever the corpus fits", () => {
    expect(fit(40_000, 200_000).overflowTokens).toBe(0);
  });
});

describe("contextFit — a large corpus against real models", () => {
  // The numbers that made this feature necessary.
  it("fits comfortably in a 1M-context model, at about a third of it", () => {
    // Worth stating precisely: even a 1M window is ~30% consumed at this
    // size. It fits, but "fits" and "roomy" are not the same, and a few more
    // sessions move a campaign into the next band.
    const r = contextFit({ corpusTokens: LARGE_CORPUS, contextWindow: 1_000_000 });
    expect(r.band).toBe("easy");
    expect(r.pressure).toBeGreaterThan(0.25);
    expect(r.pressure).toBeLessThan(0.35);
    expect(r.overflowTokens).toBe(0);
  });

  it("does NOT fit a typical small free model", () => {
    // A 32k free model cannot hold 3% of a corpus this size. Choosing one is
    // not a quality trade-off, it is most of the lore going missing.
    const r = contextFit({ corpusTokens: LARGE_CORPUS, contextWindow: 32_768 });
    expect(r.band).toBe("very-hard");
    expect(r.overflowTokens).toBeGreaterThan(250_000);
    expect(r.summary).toMatch(/invisible/);
  });

  it("still does not fit a 128k model", () => {
    expect(contextFit({ corpusTokens: LARGE_CORPUS, contextWindow: 128_000 }).band).toBe("very-hard");
  });

  it("changes band when the model changes — the point of the gradient", () => {
    const small = contextFit({ corpusTokens: LARGE_CORPUS, contextWindow: 32_768 }).band;
    const large = contextFit({ corpusTokens: LARGE_CORPUS, contextWindow: 1_000_000 }).band;
    expect(small).not.toBe(large);
  });
});

describe("contextFit — accounting", () => {
  it("counts the non-lore prompt, not just the corpus", () => {
    // The system block, persona, clarifications and question are real tokens.
    // Sizing on corpus alone would promise a fit that does not exist.
    const r = contextFit({ corpusTokens: 1_000, contextWindow: 100_000 });
    expect(r.promptTokens).toBe(1_000 + NON_LORE_PROMPT_TOKENS);
  });

  it("reserves room for the answer", () => {
    const r = contextFit({ corpusTokens: 1_000, contextWindow: 100_000 });
    expect(r.usableTokens).toBe(100_000 - DEFAULT_OUTPUT_RESERVE);
  });

  it("honours an explicit reserve", () => {
    const r = contextFit({ corpusTokens: 1_000, contextWindow: 100_000, outputReserve: 20_000 });
    expect(r.usableTokens).toBe(80_000);
  });
});

describe("contextFit — unknown context window", () => {
  it("says so rather than rendering green", () => {
    // Ollama and some catalogue rows publish nothing. A colour cannot express
    // "we don't know", and green would be a promise Vault cannot make.
    for (const w of [0, undefined as unknown as number, -1]) {
      const r = contextFit({ corpusTokens: LARGE_CORPUS, contextWindow: w });
      expect(r.band).toBe("moderate");
      expect(r.summary).toMatch(/can't tell you|doesn't publish/);
      expect(r.overflowTokens).toBe(0);
    }
  });
});

describe("summaries", () => {
  it("never renders a bare number without meaning", () => {
    for (const w of [32_768, 128_000, 1_000_000]) {
      const s = contextFit({ corpusTokens: LARGE_CORPUS, contextWindow: w }).summary;
      expect(s).toMatch(/campaign/);
      expect(s.length).toBeGreaterThan(30);
    }
  });

  it("tells the user what to DO when it does not fit", () => {
    const s = contextFit({ corpusTokens: LARGE_CORPUS, contextWindow: 32_768 }).summary;
    expect(s).toMatch(/larger context|lore map/);
  });
});

describe("band presentation", () => {
  it("has a colour and a label for every band", () => {
    for (const b of ["very-easy", "easy", "moderate", "hard", "very-hard"] as const) {
      expect(BAND_COLOUR[b]).toBeTruthy();
      expect(BAND_LABEL[b]).toBeTruthy();
    }
  });

  it("runs green to red in band order", () => {
    expect(BAND_COLOUR["very-easy"]).toBe("emerald");
    expect(BAND_COLOUR["very-hard"]).toBe("red");
  });
});
