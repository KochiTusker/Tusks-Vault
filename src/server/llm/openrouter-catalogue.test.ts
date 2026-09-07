import { describe, it, expect } from "vitest";
import {
  normaliseCatalogue,
  normalisePricingTiers,
  isCatalogueFresh,
  priceAt,
  findModel,
  isTextModel,
  CATALOGUE_TTL_MS,
  type OpenRouterCatalogue,
  type OpenRouterModel,
} from "./openrouter-catalogue";

// Trimmed to the shapes that matter: one normal paid model, one free variant,
// one with pricing tiers, one moderated with a low output ceiling, one with
// no declared ceiling, and three malformed rows that must be dropped.
const FIXTURE = {
  data: [
    {
      id: "example/paid-flagship",
      name: "Paid Flagship",
      context_length: 200000,
      pricing: { prompt: "0.000003", completion: "0.000015", input_cache_read: "0.0000003" },
      top_provider: { max_completion_tokens: 32768, is_moderated: false },
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      supported_parameters: ["response_format", "structured_outputs"],
    },
    {
      id: "example/small-model:free",
      name: "Small Model (free)",
      context_length: 8192,
      pricing: { prompt: "0", completion: "0" },
      top_provider: { max_completion_tokens: 4096, is_moderated: false },
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: [],
    },
    {
      id: "example/tiered-model",
      name: "Tiered Model",
      context_length: 1000000,
      pricing: {
        prompt: "0.000001",
        completion: "0.000005",
        overrides: [
          { min_prompt_tokens: 128000, prompt: "0.000002", completion: "0.00001" },
          // Deliberately out of order — normalisePricingTiers must sort.
          { min_prompt_tokens: 32000, prompt: "0.0000015", completion: "0.0000075" },
        ],
      },
      top_provider: { max_completion_tokens: 16384, is_moderated: false },
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["response_format"],
    },
    {
      id: "example/moderated-low-ceiling",
      name: "Moderated Low Ceiling",
      context_length: 128000,
      pricing: { prompt: "0.0000005", completion: "0.0000015" },
      top_provider: { max_completion_tokens: 2048, is_moderated: true },
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: [],
      reasoning: { mandatory: true, default_enabled: true, supported_efforts: ["low", "high"] },
    },
    {
      id: "example/no-ceiling",
      name: "No Declared Ceiling",
      context_length: 32768,
      pricing: { prompt: "0.000001", completion: "0.000002" },
      top_provider: { is_moderated: false },
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: [],
    },
    // Malformed rows — every one must be dropped, never defaulted.
    { id: "openrouter/auto", name: "Auto Router", pricing: { prompt: "-1", completion: "-1" } },
    { name: "No Id At All", pricing: { prompt: "0.000001", completion: "0.000001" } },
    { id: "example/unpriced", name: "Unpriced", pricing: {} },
  ],
};

describe("normaliseCatalogue", () => {
  const models = normaliseCatalogue(FIXTURE);

  it("keeps priced rows and drops malformed ones", () => {
    expect(models.map(m => m.id)).toEqual([
      "example/paid-flagship",
      "example/small-model:free",
      "example/tiered-model",
      "example/moderated-low-ceiling",
      "example/no-ceiling",
    ]);
  });

  it("converts per-token decimal strings to USD per million", () => {
    const flagship = models.find(m => m.id === "example/paid-flagship")!;
    expect(flagship.inputPerM).toBeCloseTo(3);
    expect(flagship.outputPerM).toBeCloseTo(15);
    expect(flagship.cachedInputPerM).toBeCloseTo(0.3);
  });

  it("flags free variants as free, not as unpriced", () => {
    const free = models.find(m => m.id === "example/small-model:free")!;
    expect(free.isFree).toBe(true);
    expect(free.inputPerM).toBe(0);
  });

  it("null ceiling when the upstream declares none", () => {
    expect(models.find(m => m.id === "example/no-ceiling")!.maxCompletionTokens).toBeNull();
    expect(models.find(m => m.id === "example/paid-flagship")!.maxCompletionTokens).toBe(32768);
  });

  it("carries moderation, structured-output and reasoning metadata", () => {
    const mod = models.find(m => m.id === "example/moderated-low-ceiling")!;
    expect(mod.isModerated).toBe(true);
    expect(mod.supportsStructuredOutputs).toBe(false);
    expect(mod.reasoning).toEqual({
      mandatory: true,
      defaultEnabled: true,
      supportedEfforts: ["low", "high"],
    });
    const flagship = models.find(m => m.id === "example/paid-flagship")!;
    expect(flagship.supportsStructuredOutputs).toBe(true);
  });

  it("returns [] for a feed with no data array", () => {
    expect(normaliseCatalogue({})).toEqual([]);
    expect(normaliseCatalogue(null)).toEqual([]);
    expect(normaliseCatalogue("nonsense")).toEqual([]);
  });
});

describe("normalisePricingTiers", () => {
  it("sorts bands by threshold and drops malformed entries", () => {
    const tiers = normalisePricingTiers([
      { min_prompt_tokens: 128000, prompt: "0.000002", completion: "0.00001" },
      { min_prompt_tokens: 32000, prompt: "0.0000015", completion: "0.0000075" },
      { min_prompt_tokens: -5, prompt: "0.000001", completion: "0.000001" },
      { prompt: "0.000001", completion: "0.000001" },
    ]);
    expect(tiers.map(t => t.minPromptTokens)).toEqual([32000, 128000]);
  });
});

describe("priceAt", () => {
  const tiered = normaliseCatalogue(FIXTURE).find(m => m.id === "example/tiered-model")!;

  it("quotes the base rate below the first threshold", () => {
    const p = priceAt(tiered, 10_000);
    expect(p.tiered).toBe(false);
    expect(p.inputPerM).toBeCloseTo(1);
  });

  it("applies the deepest band the prompt length reaches", () => {
    expect(priceAt(tiered, 50_000).inputPerM).toBeCloseTo(1.5);
    expect(priceAt(tiered, 500_000).inputPerM).toBeCloseTo(2);
    expect(priceAt(tiered, 500_000).tiered).toBe(true);
  });

  it("base rate for models with no tiers", () => {
    const flat = normaliseCatalogue(FIXTURE).find(m => m.id === "example/paid-flagship")!;
    expect(priceAt(flat, 999_999_999).tiered).toBe(false);
  });
});

describe("isCatalogueFresh", () => {
  const cat = (fetchedAt: string): OpenRouterCatalogue => ({
    fetchedAt,
    models: [{ id: "x" } as OpenRouterModel],
  });
  const now = Date.parse("2026-08-24T12:00:00Z");

  it("fresh within TTL, stale beyond it", () => {
    expect(isCatalogueFresh(cat("2026-08-24T11:00:00Z"), now)).toBe(true);
    expect(isCatalogueFresh(cat("2026-08-22T11:00:00Z"), now)).toBe(false);
    expect(isCatalogueFresh(cat("2026-08-24T11:00:00Z"), now, CATALOGUE_TTL_MS)).toBe(true);
  });

  it("a clock that moved backwards does not make the cache immortal", () => {
    expect(isCatalogueFresh(cat("2026-08-25T12:00:00Z"), now)).toBe(false);
  });

  it("null, empty and unparseable catalogues are never fresh", () => {
    expect(isCatalogueFresh(null, now)).toBe(false);
    expect(isCatalogueFresh({ fetchedAt: "garbage", models: [{} as OpenRouterModel] }, now)).toBe(false);
    expect(isCatalogueFresh({ fetchedAt: "2026-08-24T11:00:00Z", models: [] }, now)).toBe(false);
  });
});

describe("findModel / isTextModel", () => {
  const models = normaliseCatalogue(FIXTURE);
  const cat: OpenRouterCatalogue = { fetchedAt: "2026-08-24T00:00:00Z", models };

  it("finds by exact id, null otherwise", () => {
    expect(findModel(cat, "example/paid-flagship")?.name).toBe("Paid Flagship");
    expect(findModel(cat, "example/nope")).toBeNull();
    expect(findModel(null, "example/paid-flagship")).toBeNull();
  });

  it("text models pass; image-out models do not", () => {
    expect(isTextModel(models[0])).toBe(true);
    const imageOut = {
      ...models[0],
      outputModalities: ["image"],
    };
    expect(isTextModel(imageOut)).toBe(false);
  });

  it("rejects a generator that emits text ALONGSIDE audio or images", () => {
    // The shape that slipped through: a music model declares
    // ["text","audio"] and an image model ["image","text"], so asking
    // whether text is merely *among* the outputs waved both past. On the
    // live catalogue that filter excluded nothing at all, and a music
    // generator sat in the picker looking like any other cheap option.
    const musicOut = { ...models[0], outputModalities: ["text", "audio"] };
    const imageAndText = { ...models[0], outputModalities: ["image", "text"] };
    expect(isTextModel(musicOut)).toBe(false);
    expect(isTextModel(imageAndText)).toBe(false);
  });

  it("accepts multimodal INPUT, which is a different question", () => {
    // Vault sends images; it just cannot use anything but text back.
    const imageIn = { ...models[0], inputModalities: ["text", "image"], outputModalities: ["text"] };
    expect(isTextModel(imageIn)).toBe(true);
  });

  it("treats an unstated output modality as text", () => {
    // Most of the catalogue omits the field; excluding those would drop
    // nearly every chat model over a missing value.
    expect(isTextModel({ ...models[0], outputModalities: [] })).toBe(true);
  });

  it("rejects a model that cannot take text in", () => {
    expect(isTextModel({ ...models[0], inputModalities: ["audio"], outputModalities: ["text"] })).toBe(false);
  });
});
