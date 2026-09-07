// OpenRouter model catalogue — fetch, normalise, cache.
//
// OpenRouter publishes its whole model list at /api/v1/models with no auth, so
// unlike every other provider we can know a model's price, context window,
// output ceiling, moderation status and capability set BEFORE calling it. That
// one document is the input to:
//
//   - the model picker     (price, context, moderation and structured-output
//                           support decide what a model is actually fit for)
//   - output clamping      (max_completion_tokens is below our 4096 default on
//                           some models, which makes the request itself invalid)
//   - cost display         (live rates, instead of a static table that drifts)
//   - privacy disclosure   (which upstream serves it, and on what data policy)
//
// Prices in the raw feed are USD per token as decimal STRINGS. Everything here
// converts to USD per MILLION tokens.
//
// NOTE: do NOT reuse this shape for speech-to-text pricing. On the STT models
// the pricing.prompt field is not unit-normalised across providers — the same
// whisper model is quoted per-second on one host, per-minute on another and
// per-hour on a third. STT cost must be read from the usage.cost field the
// response returns, never precomputed from this table.

import fs from "fs";
import path from "path";
import envPaths from "env-paths";
import { writeFileAtomic } from "../util/atomic-write";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** How long a cached catalogue stays fresh. Prices move rarely, and a stale
 *  price only skews an estimate, so a long TTL is cheap insurance against
 *  hammering a public endpoint on every app start. */
export const CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000;

export interface OpenRouterModel {
  id: string;
  name: string;
  /** USD per million input tokens. */
  inputPerM: number;
  /** USD per million output tokens. */
  outputPerM: number;
  /** USD per million cached-read input tokens, when the model supports it. */
  cachedInputPerM?: number;
  contextLength: number;
  /** Advertised output ceiling. Null when the upstream does not declare one. */
  maxCompletionTokens: number | null;
  /** Supports response_format / structured_outputs. Vault doesn't emit JSON
   *  today, but the flag is cheap to carry and the picker surfaces it. */
  supportsStructuredOutputs: boolean;
  /** Upstream applies a prompt-level moderation filter. Matters for campaign
   *  content — mature source material gets refused by moderated upstreams. */
  isModerated: boolean;
  /** A :free variant — zero cost, but platform request caps and (today,
   *  universally) a serving provider that retains prompts, which the privacy
   *  floor in the adapter excludes. */
  isFree: boolean;
  inputModalities: string[];
  outputModalities: string[];
  /** Prompt-length pricing tiers, cheapest threshold first. Some models
   *  double or triple their rate above a token threshold; see priceAt(). A
   *  full lore corpus is a very long prompt, so these bands apply here more
   *  often than the base rate suggests. */
  pricingTiers?: PricingTier[];
  /** Reasoning-token behaviour. `mandatory` means the model always spends
   *  reasoning tokens — they are billed as output whether or not they are
   *  shown, and on some models they land in the reply body itself. */
  reasoning?: {
    mandatory: boolean;
    defaultEnabled?: boolean;
    supportedEfforts?: string[];
  };
  /** Set when this model has been observed writing its reasoning into the
   *  reply rather than a separate field. Measured, not inferred — see
   *  MEASURED_REASONING_LEAK. */
  leaksReasoning?: boolean;
}

/** One prompt-length pricing band. */
export interface PricingTier {
  minPromptTokens: number;
  inputPerM: number;
  outputPerM: number;
  cachedInputPerM?: number;
}

/**
 * Models observed writing chain-of-thought into `message.content` rather than
 * the separate `reasoning` field, probed against the live API on 2026-08-18
 * (in the sibling Tomes project; re-probe before extending).
 *
 * This is not the same thing as `reasoning.mandatory`. Plenty of models always
 * reason and are perfectly clean about it. What matters for a lore answer is
 * only whether the deliberation ends up in the reply, and that has to be
 * measured. On the models below, neither `reasoning: {exclude: true}` nor
 * `reasoning: {effort: 'low'}` reliably suppressed it, and they emit UNTAGGED
 * prose ("Here's a thinking process: ..."), so the adapter's tag stripper
 * cannot catch it either. The picker warns instead.
 */
export const MEASURED_REASONING_LEAK = new Set<string>([
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3.5-lightning",
  "nvidia/nemotron-3-nano-30b-a3b:free",
]);

export interface OpenRouterCatalogue {
  fetchedAt: string;
  models: OpenRouterModel[];
}

/** Raw feed row. Only the fields we consume are described. */
interface RawModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
    input_cache_read?: unknown;
    overrides?: unknown;
  };
  top_provider?: {
    max_completion_tokens?: unknown;
    is_moderated?: unknown;
  };
  reasoning?: {
    mandatory?: unknown;
    default_enabled?: unknown;
    supported_efforts?: unknown;
  };
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
  supported_parameters?: unknown;
}

/** Per-token decimal string -> USD per million tokens. Returns null when the
 *  field is absent or unparseable so callers can distinguish free (0) from
 *  unknown (null). */
function perMillion(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const n = typeof raw === "number" ? raw : Number.parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  return n * 1_000_000;
}

function stringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Pure normalisation of the raw feed. Split out from the fetch so it can be
 * unit-tested against a fixture without network access — the shape of this
 * feed is the thing most likely to shift under us.
 *
 * Rows missing an id or a usable price are dropped rather than defaulted: a
 * model we cannot price is one we must not silently quote a cost for. The
 * openrouter/auto router rows go the same way — they report a sentinel
 * negative price because the real model is only chosen per call.
 */
export function normaliseCatalogue(raw: unknown): OpenRouterModel[] {
  const rows = (raw as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];

  const out: OpenRouterModel[] = [];
  for (const row of rows as RawModel[]) {
    if (!row || typeof row.id !== "string" || !row.id) continue;

    const inputPerM = perMillion(row.pricing?.prompt);
    const outputPerM = perMillion(row.pricing?.completion);
    if (inputPerM === null || outputPerM === null) continue;
    if (inputPerM < 0 || outputPerM < 0) continue;

    const cached = perMillion(row.pricing?.input_cache_read);
    const tiers = normalisePricingTiers(row.pricing?.overrides);
    const params = stringArray(row.supported_parameters);
    const maxOut = row.top_provider?.max_completion_tokens;
    const ctx = row.context_length;

    out.push({
      id: row.id,
      name: typeof row.name === "string" ? row.name : row.id,
      inputPerM,
      outputPerM,
      ...(cached !== null && cached >= 0 ? { cachedInputPerM: cached } : {}),
      contextLength: typeof ctx === "number" && Number.isFinite(ctx) ? ctx : 0,
      maxCompletionTokens:
        typeof maxOut === "number" && Number.isFinite(maxOut) && maxOut > 0 ? maxOut : null,
      supportsStructuredOutputs:
        params.includes("structured_outputs") || params.includes("response_format"),
      isModerated: row.top_provider?.is_moderated === true,
      isFree: inputPerM === 0 && outputPerM === 0,
      inputModalities: stringArray(row.architecture?.input_modalities),
      outputModalities: stringArray(row.architecture?.output_modalities),
      ...(tiers.length > 0 ? { pricingTiers: tiers } : {}),
      ...(row.reasoning
        ? {
            reasoning: {
              mandatory: row.reasoning.mandatory === true,
              ...(typeof row.reasoning.default_enabled === "boolean"
                ? { defaultEnabled: row.reasoning.default_enabled }
                : {}),
              ...(Array.isArray(row.reasoning.supported_efforts)
                ? { supportedEfforts: stringArray(row.reasoning.supported_efforts) }
                : {}),
            },
          }
        : {}),
      ...(MEASURED_REASONING_LEAK.has(row.id) ? { leaksReasoning: true } : {}),
    });
  }
  return out;
}

export function isCatalogueFresh(
  cat: OpenRouterCatalogue | null,
  now: number = Date.now(),
  ttlMs: number = CATALOGUE_TTL_MS
): boolean {
  if (!cat || !cat.fetchedAt || cat.models.length === 0) return false;
  const fetched = Date.parse(cat.fetchedAt);
  if (!Number.isFinite(fetched)) return false;
  // A clock that has moved backwards must not make a cache immortal.
  const age = now - fetched;
  return age >= 0 && age < ttlMs;
}

// Per-install derived data, so it lives in the platform config dir alongside
// the key store and settings, NOT in the resolved Tusks-Lore/ folder —
// campaign state survives reinstalls; a price cache should not follow the
// campaign around. Resolved lazily per the repo convention (tests change cwd;
// envPaths doesn't care, but keeping the shape consistent costs nothing).
function catalogueFile(): string {
  const paths = envPaths("tusks-vault", { suffix: "" });
  return path.join(paths.config, "openrouter-models.json");
}

export function readCachedCatalogue(): OpenRouterCatalogue | null {
  try {
    const raw = JSON.parse(fs.readFileSync(catalogueFile(), "utf-8")) as OpenRouterCatalogue;
    if (!raw || !Array.isArray(raw.models)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeCachedCatalogue(cat: OpenRouterCatalogue): void {
  // Atomic, and atomic against a second process — see util/atomic-write.ts.
  writeFileAtomic(catalogueFile(), JSON.stringify(cat));
}

/**
 * Return the catalogue, fetching only when the cache is missing or stale.
 *
 * A failed fetch falls back to the stale cache rather than throwing: an
 * out-of-date price is a far better outcome than a model picker that cannot
 * render because OpenRouter had a bad minute.
 */
export async function getCatalogue(opts: { force?: boolean } = {}): Promise<OpenRouterCatalogue> {
  const cached = readCachedCatalogue();
  if (!opts.force && isCatalogueFresh(cached)) return cached as OpenRouterCatalogue;

  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const models = normaliseCatalogue(await res.json());
    if (models.length === 0) throw new Error("catalogue parsed to zero models");
    const next: OpenRouterCatalogue = { fetchedAt: new Date().toISOString(), models };
    writeCachedCatalogue(next);
    return next;
  } catch (err) {
    if (cached && cached.models.length > 0) {
      console.warn(
        "[openrouter] catalogue refresh failed, serving cached copy:",
        (err as Error)?.message ?? err
      );
      return cached;
    }
    throw err;
  }
}

/**
 * Parse prompt-length pricing bands.
 *
 * These matter a great deal here: Vault ships the whole knowledge base with
 * every question — a 2 MB lore folder is ~500k prompt tokens, far past every
 * published threshold — so quoting the base rate can understate the real
 * charge by 2x or more.
 *
 * Time-of-day bands (`utc_start` / `utc_end`, used for off-peak discounts) are
 * deliberately ignored: they would make an estimate depend on when the user
 * happens to ask, which is worse than quoting the standard rate.
 */
export function normalisePricingTiers(raw: unknown): PricingTier[] {
  if (!Array.isArray(raw)) return [];
  const out: PricingTier[] = [];
  for (const row of raw as Array<Record<string, unknown>>) {
    const min = row?.min_prompt_tokens;
    if (typeof min !== "number" || !Number.isFinite(min) || min <= 0) continue;
    const input = perMillion(row.prompt);
    const output = perMillion(row.completion);
    if (input === null || output === null || input < 0 || output < 0) continue;
    const cached = perMillion(row.input_cache_read);
    out.push({
      minPromptTokens: min,
      inputPerM: input,
      outputPerM: output,
      ...(cached !== null && cached >= 0 ? { cachedInputPerM: cached } : {}),
    });
  }
  return out.sort((a, b) => a.minPromptTokens - b.minPromptTokens);
}

/**
 * The rate that actually applies at a given prompt length.
 *
 * Falls back to the base rate when no band matches, which is the correct
 * reading — bands only ever raise the price above a threshold.
 */
export function priceAt(
  model: OpenRouterModel,
  promptTokens: number
): { inputPerM: number; outputPerM: number; cachedInputPerM?: number; tiered: boolean } {
  const base = {
    inputPerM: model.inputPerM,
    outputPerM: model.outputPerM,
    ...(model.cachedInputPerM !== undefined ? { cachedInputPerM: model.cachedInputPerM } : {}),
    tiered: false,
  };
  if (!model.pricingTiers || model.pricingTiers.length === 0) return base;
  let applied: PricingTier | null = null;
  for (const tier of model.pricingTiers) {
    if (promptTokens >= tier.minPromptTokens) applied = tier;
  }
  if (!applied) return base;
  return {
    inputPerM: applied.inputPerM,
    outputPerM: applied.outputPerM,
    ...(applied.cachedInputPerM !== undefined ? { cachedInputPerM: applied.cachedInputPerM } : {}),
    tiered: true,
  };
}

/** Look up one model. Returns null rather than throwing — callers decide
 *  whether an unknown model is fatal or merely unpriced. */
export function findModel(cat: OpenRouterCatalogue | null, id: string): OpenRouterModel | null {
  if (!cat) return null;
  return cat.models.find(m => m.id === id) ?? null;
}

/**
 * True when a model can serve Vault's text pipeline: text in, text ONLY out.
 *
 * Multimodal *input* is fine — Vault sends images. Multimodal *output* is
 * not, and the distinction is the whole point of this function. A music
 * model declares `output_modalities: ["text", "audio"]`, an image model
 * declares `["image", "text"]`, and asking merely whether text is *among*
 * the outputs waves both through: on the live catalogue that filter excluded
 * nothing at all, and a music generator sat in the model picker looking like
 * any other cheap option.
 *
 * It does not reliably fail, either, which is what makes it dangerous rather
 * than merely untidy. Asked a lore question, one of these was observed
 * returning what looks like an answer with audio-caption timestamps welded
 * on — `[0.0:5.2] The harbour at Aldermarch is run by…` — which Vault would
 * post into Discord as the reply. Other attempts 404 or 502. A user cannot
 * tell from the picker which they will get, so the picker must not offer
 * them.
 *
 * An empty `outputModalities` means the catalogue did not say; those are
 * text-only chat models in practice, and excluding them would drop most of
 * the catalogue over a missing field.
 */
export function isTextModel(model: OpenRouterModel): boolean {
  return (
    model.inputModalities.includes("text") &&
    (model.outputModalities.length === 0 || model.outputModalities.every(o => o === "text"))
  );
}
