import { describe, expect, it } from "vitest";
import type { OpenRouterCatalogue, OpenRouterModel } from "./openrouter-catalogue";
import {
  COMPARABLE_CEILING,
  TIER_ORDER,
  blendedPrice,
  findBenchmark,
  groupByVendor,
  isAliasId,
  priceForGeminiModel,
  tierOf,
  vendorLabel,
  vendorOf,
} from "./model-tiers";

function model(id: string, inputPerM: number, outputPerM: number, name?: string): OpenRouterModel {
  return {
    id,
    name: name ?? id,
    inputPerM,
    outputPerM,
    contextLength: 128_000,
    maxCompletionTokens: 4096,
    isModerated: false,
    isFree: inputPerM === 0 && outputPerM === 0,
    supportsImages: false,
    supportsStructuredOutputs: false,
    inputModalities: ["text"],
    outputModalities: ["text"],
  } as OpenRouterModel;
}

const catalogue = (models: OpenRouterModel[]): OpenRouterCatalogue =>
  ({ fetchedAt: new Date(0).toISOString(), models }) as OpenRouterCatalogue;

const BENCH = model("google/gemini-2.5-flash", 0.3, 2.5);

describe("findBenchmark", () => {
  it("prefers the first listed benchmark that exists", () => {
    const cat = catalogue([model("google/gemini-2.5-flash", 0.3, 2.5), model("google/gemini-flash-1.5", 0.075, 0.3)]);
    expect(findBenchmark(cat)!.id).toBe("google/gemini-2.5-flash");
  });

  it("falls back to any priced Gemini flash model", () => {
    const cat = catalogue([model("google/gemini-9-flash-experimental", 0.4, 1.2)]);
    expect(findBenchmark(cat)!.id).toBe("google/gemini-9-flash-experimental");
  });

  it("ignores a free entry as a benchmark", () => {
    // A benchmark of zero makes every paid model infinitely expensive.
    const cat = catalogue([model("google/gemini-2.5-flash", 0, 0)]);
    expect(findBenchmark(cat)).toBeNull();
  });

  it("returns null rather than inventing a price", () => {
    expect(findBenchmark(catalogue([model("vendor/thing", 1, 1)]))).toBeNull();
    expect(findBenchmark(null)).toBeNull();
  });
});

describe("blendedPrice", () => {
  it("weights input, because a lore question is almost all input", () => {
    // Ranking on output price would sort by the number that barely moves the
    // bill: the corpus goes up, a few hundred tokens come back.
    const inputHeavy = blendedPrice({ inputPerM: 10, outputPerM: 0 });
    const outputHeavy = blendedPrice({ inputPerM: 0, outputPerM: 10 });
    expect(inputHeavy).toBeGreaterThan(outputHeavy);
  });
});

describe("tierOf", () => {
  it("calls a zero-priced model free without needing a benchmark", () => {
    expect(tierOf(model("v/m", 0, 0), null)).toBe("free");
  });

  it("places a cheaper model below the benchmark", () => {
    expect(tierOf(model("v/m", 0.05, 0.2), findBenchmark(catalogue([BENCH])))).toBe("cheaper");
  });

  it("treats prices near the benchmark as comparable", () => {
    const bench = findBenchmark(catalogue([BENCH]))!;
    expect(tierOf(model("v/m", 0.3, 2.5), bench)).toBe("comparable");
    expect(tierOf({ inputPerM: 0.3 * COMPARABLE_CEILING, outputPerM: 2.5 * COMPARABLE_CEILING }, bench)).toBe("comparable");
  });

  it("calls anything well above the benchmark premium", () => {
    expect(tierOf(model("v/m", 15, 75), findBenchmark(catalogue([BENCH])))).toBe("premium");
  });

  it("reports unknown rather than guessing when there is no benchmark", () => {
    expect(tierOf(model("v/m", 1, 1), null)).toBe("unknown");
  });

  it("orders tiers cheapest-first for the UI", () => {
    expect(TIER_ORDER[0]).toBe("free");
    expect(TIER_ORDER.indexOf("cheaper")).toBeLessThan(TIER_ORDER.indexOf("premium"));
  });
});

describe("priceForGeminiModel — Gemini's price without a Google price API", () => {
  const cat = catalogue([
    model("google/gemini-2.5-pro", 1.25, 10),
    model("google/gemini-2.5-pro-preview-06-05", 1.25, 10),
    model("google/gemini-2.5-flash", 0.3, 2.5),
  ]);

  it("matches a bare Gemini model id to its catalogue entry", () => {
    // The two namespaces spell the same model differently.
    expect(priceForGeminiModel(cat, "gemini-2.5-pro")!.id).toBe("google/gemini-2.5-pro");
  });

  it("prefers the plain entry over a dated preview of it", () => {
    expect(priceForGeminiModel(cat, "gemini-2.5-pro")!.inputPerM).toBe(1.25);
  });

  it("tolerates a already-qualified id", () => {
    expect(priceForGeminiModel(cat, "google/gemini-2.5-flash")!.id).toBe("google/gemini-2.5-flash");
  });

  it("strips a preview suffix to find the base model", () => {
    expect(priceForGeminiModel(cat, "gemini-2.5-flash-preview")!.id).toBe("google/gemini-2.5-flash");
  });

  it("returns null for a model the catalogue does not carry", () => {
    expect(priceForGeminiModel(cat, "gemini-99-imaginary")).toBeNull();
    expect(priceForGeminiModel(null, "gemini-2.5-pro")).toBeNull();
  });
});

describe("vendor grouping", () => {
  const models = [
    model("anthropic/claude-sonnet", 3, 15, "Anthropic: Claude Sonnet"),
    model("anthropic/claude-haiku", 0.8, 4, "Anthropic: Claude Haiku"),
    model("vendorx/tiny:free", 0, 0, "VendorX: Tiny"),
    model("vendorx/small", 0.1, 0.4, "VendorX: Small"),
    model("google/gemini-2.5-flash", 0.3, 2.5, "Google: Gemini Flash"),
  ];
  const bench = findBenchmark(catalogue([BENCH]));

  it("splits a flat catalogue into one group per vendor", () => {
    expect(vendorOf("anthropic/claude-sonnet")).toBe("anthropic");
    expect(groupByVendor(models, bench).map(g => g.vendor).sort()).toEqual(["anthropic", "google", "vendorx"]);
  });

  it("uses the vendor's own spelling from the catalogue name", () => {
    expect(vendorLabel(models, "anthropic")).toBe("Anthropic");
    expect(vendorLabel(models, "vendorx")).toBe("VendorX");
  });

  it("falls back to the slug when no name carries a vendor prefix", () => {
    expect(vendorLabel([model("solo/thing", 1, 1, "Thing")], "solo")).toBe("solo");
  });

  it("puts vendors offering something free first", () => {
    // A user looking for free should not open twelve groups to find which
    // ones have it.
    const groups = groupByVendor(models, bench);
    expect(groups[0].vendor).toBe("vendorx");
    expect(groups[0].bestTier).toBe("free");
  });

  it("sorts models within a group cheapest first", () => {
    const anthropic = groupByVendor(models, bench).find(g => g.vendor === "anthropic")!;
    expect(anthropic.models.map(m => m.id)).toEqual(["anthropic/claude-haiku", "anthropic/claude-sonnet"]);
  });

  it("is deterministic", () => {
    const a = groupByVendor(models, bench).map(g => g.vendor);
    const b = groupByVendor([...models].reverse(), bench).map(g => g.vendor);
    expect(a).toEqual(b);
  });
});

describe("floating aliases are not a separate vendor", () => {
  it("files an alias under the vendor it points at", () => {
    // `~google/...` and `google/...` are one vendor's floating and pinned
    // pointers to the same models, not two suppliers. Left split, the picker
    // grows a second "~google" group beside "Google".
    expect(vendorOf("~google/gemini-pro-latest")).toBe("google");
    expect(vendorOf("google/gemini-2.5-pro")).toBe("google");
  });

  it("recognises the alias namespace", () => {
    expect(isAliasId("~anthropic/claude-sonnet-latest")).toBe(true);
    expect(isAliasId("anthropic/claude-sonnet-4.5")).toBe(false);
  });

  it("groups pinned and floating entries together", () => {
    const models = [
      model("~google/gemini-flash-latest", 0.375, 1.5, "Google Gemini Flash Latest"),
      model("google/gemini-2.5-flash", 0.3, 2.5, "Google: Gemini Flash"),
    ];
    const groups = groupByVendor(models, null);
    expect(groups).toHaveLength(1);
    expect(groups[0].models).toHaveLength(2);
  });
});
