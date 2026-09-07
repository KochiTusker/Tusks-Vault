import { describe, expect, it } from "vitest";
import {
  TYPICAL_QUESTION_TOKENS,
  costTooltip,
  estimateQuestionCost,
  formatContext,
  formatRatePerM,
  vendorTooltip,
} from "./model-cost";

describe("formatRatePerM", () => {
  it("says free rather than $0.00", () => {
    expect(formatRatePerM(0)).toBe("free");
  });

  it("keeps enough decimals for a very cheap model to be distinguishable", () => {
    // $0.00 next to $0.00 next to $0.00 tells a user nothing about which of
    // three sub-cent models is cheapest.
    expect(formatRatePerM(0.0002)).toBe("$0.0002");
    expect(formatRatePerM(0.035)).toBe("$0.04");
  });

  it("uses two decimals for ordinary prices", () => {
    expect(formatRatePerM(1.25)).toBe("$1.25");
  });
});

describe("formatContext", () => {
  it("renders windows in the units people quote them in", () => {
    expect(formatContext(128_000)).toBe("128k");
    expect(formatContext(1_000_000)).toBe("1M");
    expect(formatContext(1_048_576)).toBe("1M");
  });

  it("says unknown rather than zero", () => {
    expect(formatContext(0)).toBe("unknown");
    expect(formatContext(null)).toBe("unknown");
    expect(formatContext(undefined)).toBe("unknown");
  });
});

describe("estimateQuestionCost", () => {
  it("turns a per-million rate into money for one question", () => {
    // The whole point of the tooltip: "$0.30/M" is not a decision, "about
    // three cents a question" is.
    expect(estimateQuestionCost(1, 0)).toBeCloseTo(TYPICAL_QUESTION_TOKENS / 1_000_000, 6);
  });

  it("counts output too, but it barely moves", () => {
    const inputOnly = estimateQuestionCost(1, 0);
    const withOutput = estimateQuestionCost(1, 10);
    expect(withOutput).toBeGreaterThan(inputOnly);
    expect(withOutput - inputOnly).toBeLessThan(inputOnly * 0.1);
  });

  it("is zero for a free model", () => {
    expect(estimateQuestionCost(0, 0)).toBe(0);
  });
});

describe("costTooltip", () => {
  const paid = { id: "vendor/model", inputPerM: 0.3, outputPerM: 2.5, contextLength: 200_000 };

  it("names the model and both rates", () => {
    const t = costTooltip(paid);
    expect(t).toContain("vendor/model");
    expect(t).toContain("$0.30 per million");
    expect(t).toContain("$2.50 per million");
  });

  it("converts the rates into a per-question figure", () => {
    expect(costTooltip(paid)).toMatch(/≈ \$\d/);
  });

  it("states the context window", () => {
    expect(costTooltip(paid)).toContain("200k");
  });

  it("explains what a free model costs instead of money", () => {
    // The disclosure has to travel with the price, not sit in a settings page
    // the user reads once.
    const t = costTooltip({ id: "vendor/m:free", inputPerM: 0, outputPerM: 0 });
    expect(t).toContain("No charge");
    expect(t).toMatch(/keep prompts/);
    expect(t).toMatch(/opt that model in/);
  });

  it("says the price is unknown rather than implying it is zero", () => {
    const t = costTooltip({ id: "vendor/unlisted" });
    expect(t).toMatch(/Price unknown/);
    expect(t).not.toMatch(/No charge/);
  });

  it("flags a floating alias, a moderated host and a reasoning leak", () => {
    const t = costTooltip({ ...paid, isAlias: true, isModerated: true, leaksReasoning: true });
    expect(t).toMatch(/Floating alias/);
    expect(t).toMatch(/Moderated host/);
    expect(t).toMatch(/reasoning in the reply/);
  });

  it("stays plain text, because it goes in a title attribute", () => {
    expect(costTooltip(paid)).not.toMatch(/[<>]/);
  });
});

describe("vendorTooltip", () => {
  const models = [
    { inputPerM: 0, outputPerM: 0 },
    { inputPerM: 0.3, outputPerM: 2.5 },
    { inputPerM: 15, outputPerM: 75 },
  ];

  it("summarises the range inside a collapsed group", () => {
    const t = vendorTooltip("Acme", models);
    expect(t).toContain("Acme");
    expect(t).toContain("3 models");
    expect(t).toMatch(/\$0 to \$1\.5\d/);
  });

  it("calls out how many are free to run", () => {
    expect(vendorTooltip("Acme", models)).toContain("1 free to run");
  });

  it("omits the free line when there are none", () => {
    expect(vendorTooltip("Acme", models.slice(1))).not.toMatch(/free to run/);
  });

  it("copes with a group whose prices are unknown", () => {
    expect(vendorTooltip("Acme", [{}, {}])).toMatch(/prices unknown/);
  });

  it("does not write \"1 model(s)\"", () => {
    expect(vendorTooltip("Acme", [{ inputPerM: 1, outputPerM: 1 }])).toContain("1 model");
    expect(vendorTooltip("Acme", [{ inputPerM: 1, outputPerM: 1 }])).not.toContain("model(s)");
  });
});
