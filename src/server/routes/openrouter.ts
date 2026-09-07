// GET /api/openrouter/models — the catalogue the model browser renders from.
//
// Kept server-side rather than fetched from the browser for three reasons:
// the on-disk cache lives in the platform config dir; the ~400-row payload is
// worth trimming before it crosses to the client; and the data-policy lookup
// needs a second upstream call that would otherwise double the browser's work.
//
// No key is required — OpenRouter serves both upstream endpoints anonymously.
// That is unusual and useful: the browser can show real prices and capability
// flags before the user has pasted anything.

import { Router } from "express";
import { getCatalogue, isTextModel, type OpenRouterModel } from "../llm/openrouter-catalogue";
import { findBenchmark, isAliasId, tierOf, vendorLabel, vendorOf, type Benchmark } from "../llm/model-tiers";
import { gradeModel } from "../llm/model-grades";
import {
  describeRequirement,
  describeSelectivity,
  measureContextRequirement,
} from "../knowledge/context-requirement";
import { getGrades, type GradesFeed } from "../llm/grades-feed";

export const openrouterRouter = Router();

const PROVIDERS_URL = "https://openrouter.ai/api/frontend/v1/all-providers";
const PROVIDER_TTL_MS = 24 * 60 * 60 * 1000;

/** What an upstream host does with a prompt once it has it. */
export interface ProviderPolicy {
  name: string;
  /** May train on prompts. */
  trains: boolean;
  /** Stores prompts beyond the request. */
  retains: boolean;
  /** Days retained, when the provider states a figure. */
  retentionDays: number | null;
}

let policyCache: { fetchedAt: number; policies: ProviderPolicy[] } | null = null;

/** Parse the provider directory. Exported for tests — this is third-party
 *  shape we do not control, and a silent parse failure here would present
 *  every provider as privacy-clean, which is the worst possible default. */
export function normalisePolicies(raw: unknown): ProviderPolicy[] {
  const rows = (raw as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];
  const out: ProviderPolicy[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    const name = typeof row?.displayName === "string" ? row.displayName : null;
    if (!name) continue;
    const dp = (row.dataPolicy ?? {}) as Record<string, unknown>;
    out.push({
      name,
      // Absent means unknown, and unknown must not read as safe: only an
      // explicit false in the feed counts as "does not".
      trains: dp.training !== false,
      retains: dp.retainsPrompts !== false,
      retentionDays: typeof dp.retentionDays === "number" ? dp.retentionDays : null,
    });
  }
  return out;
}

async function getPolicies(): Promise<ProviderPolicy[]> {
  if (policyCache && Date.now() - policyCache.fetchedAt < PROVIDER_TTL_MS) {
    return policyCache.policies;
  }
  try {
    const res = await fetch(PROVIDERS_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const policies = normalisePolicies(await res.json());
    policyCache = { fetchedAt: Date.now(), policies };
    return policies;
  } catch (err) {
    console.warn(
      "[openrouter] provider-policy fetch failed:",
      (err as Error)?.message ?? err
    );
    // Stale beats absent; absent beats invented.
    return policyCache?.policies ?? [];
  }
}

/** The row shape the model browser consumes — the raw feed carries far more
 *  than the UI renders, and 400 rows of it is worth trimming. */
function toClientRow(
  m: OpenRouterModel,
  benchmark: Benchmark | null,
  requiredContext: number,
  grades: GradesFeed
) {
  return {
    id: m.id,
    name: m.name,
    // Grouping and tier come from the server so the picker and the browser
    // cannot drift into disagreeing about what a model costs relative to
    // what the user is already paying.
    vendor: vendorOf(m.id),
    tier: tierOf(m, benchmark),
    // Cost is computed live; accuracy and maturity come from the shipped
    // measurements when this model has been through the suite. A model with
    // no measurement gets a cost grade and honest nulls rather than a
    // flattering guess.
    grades: gradeModel({
      model: m,
      benchmark,
      maturityRuns: grades.maturity[m.id],
      accuracyRuns: grades.accuracy[m.id],
      // Whether a window is big enough is a fact about THIS install, not
      // about the model. A vault that sends a map and a handful of notes
      // makes small models viable; a folder corpus does not.
      requiredContext,
    }),
    ...(isAliasId(m.id) ? { isAlias: true } : {}),
    inputPerM: m.inputPerM,
    outputPerM: m.outputPerM,
    ...(m.cachedInputPerM !== undefined ? { cachedInputPerM: m.cachedInputPerM } : {}),
    contextLength: m.contextLength,
    maxCompletionTokens: m.maxCompletionTokens,
    isModerated: m.isModerated,
    isFree: m.isFree,
    supportsImages: m.inputModalities.includes("image"),
    ...(m.pricingTiers ? { tieredPricing: true } : {}),
    ...(m.reasoning?.mandatory ? { mandatoryReasoning: true } : {}),
    ...(m.leaksReasoning ? { leaksReasoning: true } : {}),
  };
}

openrouterRouter.get("/api/openrouter/models", async (req, res) => {
  try {
    const force = req.query.refresh === "1";
    // Grades refresh on the same button as the catalogue. Both fall back
    // rather than throw, so a refresh that cannot reach the network still
    // renders — with whatever each of them last had.
    const [cat, policies, graded] = await Promise.all([
      getCatalogue({ force }),
      getPolicies(),
      getGrades({ force }),
    ]);
    const benchmark = findBenchmark(cat);
    const context = measureContextRequirement();
    const text = cat.models.filter(isTextModel);
    const vendors = [...new Set(text.map(m => vendorOf(m.id)))]
      .map(v => ({ vendor: v, label: vendorLabel(text, v) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    res.json({
      fetchedAt: cat.fetchedAt,
      benchmark,
      // Provenance travels with the grades: a behavioural letter with no date
      // attached is an opinion wearing a grade.
      grading: {
        measuredAt: graded.feed.measuredAt,
        maturityMethod: graded.feed.maturityMethod,
        accuracyMethod: graded.feed.accuracyMethod,
        // Which of the three sources answered, so the UI can say whether these
        // are the grades this build shipped with or newer ones off the site.
        source: graded.source,
        fetchedAt: graded.fetchedAt,
        modelsGraded: Object.keys(graded.feed.accuracy).length,
      },
      vendors,
      // What this install's prompts actually need, so the UI can say why a
      // model is flagged and what would change it.
      context: {
        ...context,
        summary: describeRequirement(context),
        selectivityNote: describeSelectivity(context),
      },
      models: text.map(m => toClientRow(m, benchmark, context.tokens, graded.feed)),
      policies,
    });
  } catch (err) {
    // Only reachable when there is neither a live fetch nor any cached copy.
    res.status(502).json({
      error: "Could not reach the OpenRouter catalogue and no cached copy exists yet.",
      detail: (err as Error)?.message ?? String(err),
    });
  }
});
