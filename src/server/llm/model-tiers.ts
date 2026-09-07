// What does this model cost, compared to what the user is probably paying?
//
// A price per million tokens is not a decision. "$0.30" means nothing until
// you know what the alternative costs, and the alternative most Vault users
// have is Gemini — it is the one provider kept as a direct key precisely
// because it is cheap called directly. So Gemini is the benchmark, and every
// other model is placed relative to it.
//
// The benchmark price is read from the OpenRouter catalogue rather than
// hardcoded. That catalogue is public and needs no key, so this works for a
// user who has only a Gemini key and has never touched OpenRouter — which is
// also how Vault can show Gemini's own pricing without Google publishing a
// price API. Hardcoding it would be a table that silently goes stale, and a
// stale price is worse than no price: it is a wrong answer to "what will this
// cost me".

import type { OpenRouterCatalogue, OpenRouterModel } from "./openrouter-catalogue";

/**
 * Catalogue ids used as the price benchmark, best first.
 *
 * A list rather than one id because the catalogue renames and retires
 * entries, and a benchmark that resolves to nothing takes the whole
 * comparison down with it. Flash-class is the reference: it is what Vault
 * defaults to and what a cost-conscious user actually runs.
 */
export const BENCHMARK_IDS = [
  "google/gemini-3-flash",
  "google/gemini-2.5-flash",
  "google/gemini-flash-1.5",
  "google/gemini-2.0-flash-001",
];

export interface Benchmark {
  id: string;
  inputPerM: number;
  outputPerM: number;
}

/** The reference price, or null when the catalogue has no Gemini flash model
 *  at all — in which case tiers are reported as unknown rather than invented. */
export function findBenchmark(catalogue: OpenRouterCatalogue | null): Benchmark | null {
  const models = catalogue?.models ?? [];
  for (const id of BENCHMARK_IDS) {
    const hit = models.find(m => m.id === id);
    if (hit && (hit.inputPerM > 0 || hit.outputPerM > 0)) {
      return { id: hit.id, inputPerM: hit.inputPerM, outputPerM: hit.outputPerM };
    }
  }
  // Fall back to any Google flash-class entry with a real price.
  const loose = models.find(
    m => /^google\/gemini.*flash/i.test(m.id) && (m.inputPerM > 0 || m.outputPerM > 0)
  );
  return loose ? { id: loose.id, inputPerM: loose.inputPerM, outputPerM: loose.outputPerM } : null;
}

export type ModelTier = "free" | "cheaper" | "comparable" | "premium" | "unknown";

/**
 * Blended cost per million tokens.
 *
 * Weighted heavily towards input because a Vault question is almost all
 * input: the lore corpus goes up, a few hundred tokens come back. Ranking on
 * output price would sort the list by the number that barely affects the
 * bill.
 */
export function blendedPrice(model: { inputPerM: number; outputPerM: number }): number {
  return model.inputPerM * 0.9 + model.outputPerM * 0.1;
}

/** Above this multiple of the benchmark a model is a different budget, not a
 *  comparable one. Two-ish, because prices cluster and a tighter band would
 *  split near-identical models across tiers. */
export const COMPARABLE_CEILING = 2;

export function tierOf(
  model: { inputPerM: number; outputPerM: number },
  benchmark: Benchmark | null
): ModelTier {
  if (model.inputPerM === 0 && model.outputPerM === 0) return "free";
  if (!benchmark) return "unknown";
  const ratio = blendedPrice(model) / Math.max(blendedPrice(benchmark), 1e-9);
  if (ratio < 1) return "cheaper";
  if (ratio <= COMPARABLE_CEILING) return "comparable";
  return "premium";
}

export const TIER_ORDER: ModelTier[] = ["free", "cheaper", "comparable", "premium", "unknown"];

/**
 * Gemini's own pricing, read out of the OpenRouter catalogue.
 *
 * Google publishes no price API, and the catalogue is public — so a user with
 * only a Gemini key can still be told what their model costs. Matching is on
 * the model's stem rather than an exact id, because the two namespaces spell
 * the same model differently (`gemini-2.5-pro` against
 * `google/gemini-2.5-pro`), and version suffixes drift independently.
 */
export function priceForGeminiModel(
  catalogue: OpenRouterCatalogue | null,
  geminiModelId: string
): OpenRouterModel | null {
  const models = catalogue?.models ?? [];
  const stem = geminiModelId
    .trim()
    .toLowerCase()
    .replace(/^google\//, "")
    .replace(/-(preview|latest|exp|001|002)$/g, "");
  if (!stem) return null;

  const exact = models.find(m => m.id.toLowerCase() === `google/${stem}`);
  if (exact) return exact;

  // Longest-matching prefix: `gemini-2.5-pro` should prefer
  // `google/gemini-2.5-pro` over `google/gemini-2.5-pro-preview-06-05`.
  const candidates = models
    .filter(m => m.id.toLowerCase().startsWith(`google/${stem}`))
    .sort((a, b) => a.id.length - b.id.length);
  return candidates[0] ?? null;
}

/**
 * An id in OpenRouter's floating-alias namespace.
 *
 * `~vendor/model-latest` does not name a model; it points at whichever
 * version that vendor currently ships, and follows them when it changes.
 */
export function isAliasId(modelId: string): boolean {
  return modelId.startsWith("~");
}

/**
 * Vendor a catalogue id belongs to — the part before the slash, which is how
 * OpenRouter namespaces every model.
 *
 * The leading `~` of an alias is stripped, because it marks a KIND of entry
 * rather than a different supplier: left in, the picker grows a second
 * "~google" group sitting next to "Google", which reads as two vendors and
 * is really one vendor's pinned and floating pointers to the same models.
 */
export function vendorOf(modelId: string): string {
  const id = modelId.startsWith("~") ? modelId.slice(1) : modelId;
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(0, slash);
}

/** Display name for a vendor slug. The catalogue's own `name` field is
 *  "Vendor: Model", so the vendor's preferred spelling is already there. */
export function vendorLabel(models: Array<{ id: string; name?: string }>, vendor: string): string {
  for (const m of models) {
    if (vendorOf(m.id) !== vendor) continue;
    const colon = (m.name ?? "").indexOf(":");
    if (colon > 0) return (m.name ?? "").slice(0, colon).trim();
  }
  return vendor;
}

export interface VendorGroup {
  vendor: string;
  label: string;
  models: OpenRouterModel[];
  /** Cheapest tier present, so a collapsed group still says whether there is
   *  anything free inside it. */
  bestTier: ModelTier;
}

/**
 * Group a catalogue for browsing.
 *
 * Vendors are ordered by the best tier they offer and then by name: a user
 * looking for something free should not have to open twelve groups to find
 * which ones have it.
 */
export function groupByVendor(
  models: OpenRouterModel[],
  benchmark: Benchmark | null
): VendorGroup[] {
  const byVendor = new Map<string, OpenRouterModel[]>();
  for (const m of models) {
    const v = vendorOf(m.id);
    const list = byVendor.get(v);
    if (list) list.push(m);
    else byVendor.set(v, [m]);
  }

  const groups: VendorGroup[] = [];
  for (const [vendor, list] of byVendor) {
    const sorted = [...list].sort((a, b) => blendedPrice(a) - blendedPrice(b) || a.id.localeCompare(b.id));
    let best: ModelTier = "unknown";
    for (const m of sorted) {
      const t = tierOf(m, benchmark);
      if (TIER_ORDER.indexOf(t) < TIER_ORDER.indexOf(best)) best = t;
    }
    groups.push({ vendor, label: vendorLabel(sorted, vendor), models: sorted, bestTier: best });
  }

  return groups.sort(
    (a, b) => TIER_ORDER.indexOf(a.bestTier) - TIER_ORDER.indexOf(b.bestTier) || a.label.localeCompare(b.label)
  );
}
