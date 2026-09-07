import { describe, expect, it } from "vitest";
import { responseContainsLoreGapTrigger } from "./store";

const PHRASE = "I am unsure about this detail. I have recorded this as a lore gap for the DM to clarify.";

describe("responseContainsLoreGapTrigger", () => {
  it("fires on the exact phrase", () => {
    expect(responseContainsLoreGapTrigger(PHRASE)).toBe(true);
  });

  it("fires on a reworded or requoted paraphrase", () => {
    // Non-Gemini providers rewrap the phrase; the detector is a substring
    // match precisely so those still register.
    expect(responseContainsLoreGapTrigger(`"${PHRASE}"`)).toBe(true);
    expect(responseContainsLoreGapTrigger(`i am unsure about this detail — noted.`)).toBe(true);
  });

  it("does not fire on an ordinary answer", () => {
    expect(responseContainsLoreGapTrigger("Sera Vance runs the harbour [Ledger.md].")).toBe(false);
  });

  it("does not fire on merely uncertain prose", () => {
    expect(responseContainsLoreGapTrigger("The chronicle is unclear on this point.")).toBe(false);
  });
});

describe("a speculation is not a gap", () => {
  it("skips a response that emitted the phrase AND speculated", () => {
    // Observed on a small model: it fired the no-invention rule and then
    // answered anyway. Filing "who would commit a war crime" as something the
    // DM must clarify is noise — a hypothetical has no canonical answer, so
    // there is nothing for them to supply.
    const both = `${PHRASE}\n\nStill, [speculation] the likeliest is the one who kills without pattern.`;
    expect(responseContainsLoreGapTrigger(both)).toBe(false);
  });

  it("skips regardless of where the tag appears", () => {
    expect(responseContainsLoreGapTrigger(`[speculation] A guess. ${PHRASE}`)).toBe(false);
  });

  it("is case-insensitive about the tag", () => {
    expect(responseContainsLoreGapTrigger(`${PHRASE} [SPECULATION] a guess`)).toBe(false);
  });

  it("still records a genuine gap when nothing was speculated", () => {
    // The exemption must not become a way for real gaps to go unrecorded.
    expect(responseContainsLoreGapTrigger(PHRASE)).toBe(true);
    expect(responseContainsLoreGapTrigger(`${PHRASE} The chronicle says no more.`)).toBe(true);
  });
});
