// OpenRouter adapter.
//
// OpenRouter is wire-compatible with the OpenAI SDK, so this is deliberately a
// close relative of openai.ts. Four things differ, and each one matters:
//
//  1. A privacy floor on every request. `zdr: true` + `data_collection:
//     'deny'` restricts routing to upstreams that do not retain prompts. This
//     is a default, not a suggestion: every Vault request carries the user's
//     entire lore corpus — campaign material, player writing, private notes —
//     and none of its authors agreed to it being retained by a third-party
//     host. The floor is why most `:free` variants are unreachable: they run
//     on providers that keep (and sometimes train on) prompts.
//
//  2. Caching is explicit. OpenAI caches repeated prefixes automatically;
//     OpenRouter wants an Anthropic-style `cache_control` breakpoint, which it
//     then translates per upstream family. Prompt assembly marks the
//     knowledge-base part `cacheable`, so the breakpoint lands exactly where
//     the bytes are known to be stable. Getting this wrong is silent — the
//     request succeeds, never hits cache, and the only symptom is a bill
//     several times larger than expected.
//
//  3. Output ceilings vary. Many catalogue models advertise a
//     max_completion_tokens below our 4096 default; an unclamped request to
//     one of those is not degraded output, it is a 400. generate() clamps
//     against the cached catalogue (never fetching on the request path).
//
//  4. Real cost, not estimated. Every response carries `usage.cost`, which is
//     surfaced on GenerateResult.costUsd so the UI can show what was actually
//     billed instead of what we guessed.
//
// Retry/backoff comes from the shared layer in retry.ts. The scope gate
// matters most here: a 429 from OpenRouter is a statement about the KEY —
// account-wide — so switching model must not escape the wait, and the
// shared hold makes sure it doesn't.

import OpenAI from "openai";
import { describePdfFailure, extractPdfText } from "../util/pdf-text";
import { ContentPart, GenerateInput, GenerateResult, LlmAdapter, MissingApiKeyError, ModelInfo } from "./types";
import { maskKey } from "../config/env";
import { getCatalogue, readCachedCatalogue, findModel, isTextModel } from "./openrouter-catalogue";
import { withRetry } from "./retry";


export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Per-request routing preferences. The defaults ARE the privacy floor. If an
 *  escape hatch is ever added (e.g. to reach `:free` models) it must be an
 *  explicit, labelled, per-request opt-out that names what it gives up — not
 *  a settings toggle the user forgets they flipped. */
export const DEFAULT_ROUTING = {
  zdr: true,
  data_collection: "deny",
  sort: "price",
} as const;

/**
 * Routing with the privacy floor removed. Reaches the hosts the floor
 * excludes — which is most `:free` variants, and is *why* they are free.
 *
 * Never a default and never a global switch. See `routingFor`.
 */
export const DATA_SHARING_ROUTING = {
  sort: "price",
} as const;

/**
 * The routing preferences for one request.
 *
 * The opt-in is keyed by MODEL, not by a settings flag, because the two are
 * not equivalent. A flag is a thing a user turns on once to try a free model
 * and then forgets, after which every future question — including ones asked
 * on a paid model months later — silently ships their campaign to whichever
 * host was cheapest. Keyed by model, consent is attached to the specific
 * thing it was given for, it is visible everywhere that model is shown, and
 * choosing a different model revokes it automatically.
 *
 * This is the "explicit, labelled, per-request opt-out that names what it
 * gives up" the adapter's header has always specified.
 */
export function routingFor(
  model: string,
  dataSharingOptIn: readonly string[] = []
): Record<string, unknown> {
  return dataSharingOptIn.includes(model) ? { ...DATA_SHARING_ROUTING } : { ...DEFAULT_ROUTING };
}

/**
 * Put OpenRouter's own explanation back into the error.
 *
 * The SDK renders `{"error":{"message":"Provider returned error","code":429}}`
 * as "429 Provider returned error", which tells a user nothing — and the part
 * that would have helped is sitting in `metadata`, discarded. OpenRouter puts
 * a plain-English cause and a remedy there:
 *
 *   raw          "<model> is temporarily rate-limited upstream. Please retry
 *                 shortly, or add your own key..."
 *   limit_source "upstream_provider_shared_pool"
 *
 * `upstream_provider_shared_pool` is the one worth naming out loud: it means
 * the free tier's SHARED allowance is saturated by everyone using it, not
 * that this user has run out of anything. Nothing they change about their own
 * account fixes it, so a message that reads like a quota problem sends them
 * looking in the wrong place.
 */
export function enrichOpenRouterError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const body = (err as { error?: unknown }).error as
    | { metadata?: { raw?: unknown; limit_source?: unknown; provider_name?: unknown } }
    | undefined;
  const meta = body?.metadata;
  if (!meta) return err;

  const bits: string[] = [];
  if (typeof meta.raw === "string" && meta.raw.trim()) bits.push(meta.raw.trim());
  if (meta.limit_source === "upstream_provider_shared_pool") {
    bits.push("SHARED_FREE_POOL");
  }
  if (typeof meta.provider_name === "string" && meta.provider_name.trim()) {
    bits.push(`upstream: ${meta.provider_name.trim()}`);
  }
  if (bits.length === 0) return err;

  const enriched = new Error(`${err.message} — ${bits.join(" | ")}`);
  // Preserve the status so downstream classification is unaffected.
  (enriched as { status?: unknown }).status = (err as { status?: unknown }).status;
  return enriched;
}

interface OpenRouterAdapterOptions {
  apiKey: string;
  proModel: string;
  flashModel: string;
  /** Model ids the user has explicitly accepted data-sharing routing for.
   *  Anything not listed here gets the privacy floor. */
  dataSharingOptIn?: readonly string[];
}

/** OpenRouter's usage block — a superset of OpenAI's. */
interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}

type OpenAiUserContent = OpenAI.Chat.Completions.ChatCompletionContentPart;

/**
 * Build the message array, marking the stable prefix with a cache breakpoint.
 *
 * The breakpoint goes on the LAST leading cacheable text part — everything
 * before and including it (system prompt + knowledge base) is the cached
 * prefix; clarifications and the query after it are re-billed per call. When
 * no part is cacheable the breakpoint falls back to the system block, which
 * is stable per session.
 *
 * Exported for tests: misplacement is silent, so the placement is asserted
 * rather than trusted.
 */
export function buildMessages(args: {
  systemPrompt: string;
  userContent: OpenAiUserContent[];
  /** Indices into userContent, in order, of parts marked cacheable. */
  cacheableFlags: boolean[];
}): unknown[] {
  // The cached prefix must be contiguous from the start of the conversation,
  // so only LEADING cacheable parts count — a stable part after a variable
  // one can never be part of the prefix.
  let lastStable = -1;
  for (let i = 0; i < args.cacheableFlags.length; i++) {
    if (!args.cacheableFlags[i]) break;
    if (args.userContent[i]?.type === "text") lastStable = i;
  }

  const content = args.userContent.map((part, i) => {
    if (i === lastStable && part.type === "text") {
      return { ...part, cache_control: { type: "ephemeral" } };
    }
    return part;
  });

  const messages: unknown[] = [];
  if (args.systemPrompt.trim().length > 0) {
    messages.push({
      role: "system",
      // Content is an array so a breakpoint can sit on the block when no
      // user part is cacheable. A plain string cannot carry cache_control.
      content: [
        {
          type: "text",
          text: args.systemPrompt,
          ...(lastStable === -1 ? { cache_control: { type: "ephemeral" } } : {}),
        },
      ],
    });
  }
  messages.push({ role: "user", content });
  return messages;
}

/**
 * Strip tagged reasoning blocks (<think>…</think>) from the head of a reply.
 *
 * Some catalogue models emit chain-of-thought before the answer. Only TAGGED
 * blocks are stripped — models measured leaking UNTAGGED reasoning prose are
 * flagged in the catalogue (leaksReasoning) and warned about in the picker
 * instead, because prose-shaped deliberation cannot be removed reliably.
 * Never strips when doing so would leave nothing.
 */
export function stripTaggedReasoning(text: string): { text: string; stripped: boolean } {
  const re = /^\s*<(think|thinking)>[\s\S]*?<\/\1>\s*/i;
  let out = text;
  let stripped = false;
  for (let m = re.exec(out); m; m = re.exec(out)) {
    const rest = out.slice(m[0].length);
    if (rest.trim().length === 0) break;
    out = rest;
    stripped = true;
  }
  return { text: out, stripped };
}

export function createOpenRouterAdapter(opts: OpenRouterAdapterOptions): LlmAdapter {
  return {
    name: "openrouter",

    // The catalogue is public and unauthenticated, so the model list works
    // with no key configured — the picker is browsable before setup. This is
    // unique among the providers here; don't gate it on hasKey.
    async listModels(): Promise<ModelInfo[]> {
      const cat = await getCatalogue();
      return cat.models
        .filter(isTextModel)
        .map(m => ({
          id: m.id,
          displayName: m.name,
          description: describeModel(m),
          inputTokenLimit: m.contextLength || undefined,
          outputTokenLimit: m.maxCompletionTokens ?? undefined,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },

    async generate(input: GenerateInput): Promise<GenerateResult> {
      if (!opts.apiKey) {
        throw new MissingApiKeyError("openrouter", "OPENROUTER_API_KEY (or add one in the dashboard)");
      }
      const client = new OpenAI({ apiKey: opts.apiKey, baseURL: OPENROUTER_BASE_URL });
      const model = input.modelOverride
        || (input.tier === "pro" ? opts.proModel : opts.flashModel);
      console.log(`[openrouter] model=${model} key=${maskKey(opts.apiKey)}`);

      const userContent = await Promise.all(input.userParts.map(toOpenRouterContent));
      const messages = buildMessages({
        systemPrompt: input.systemPrompt,
        userContent,
        cacheableFlags: input.userParts.map(p => p.type === "text" && p.cacheable === true),
      });

      // Clamp against the advertised ceiling from the CACHED catalogue only —
      // generate() must never block on a network fetch. No cache yet means no
      // clamp, which is exactly today's behaviour on every other adapter.
      const requested = input.maxOutputTokens ?? 4096;
      const ceiling = findModel(readCachedCatalogue(), model)?.maxCompletionTokens ?? null;
      const maxTokens = ceiling !== null ? Math.min(requested, ceiling) : requested;

      // The OpenAI SDK's params type has no `provider` field — it is
      // OpenRouter-specific — so the body is assembled loosely and cast at
      // the call. Casting the body rather than the client keeps the rest of
      // the call type-checked.
      const body = {
        model,
        messages,
        max_tokens: maxTokens,
        provider: routingFor(model, opts.dataSharingOptIn),
      };

      let response: OpenAI.Chat.Completions.ChatCompletion;
      try {
        response = (await withRetry(() => client.chat.completions.create(body as never), {
          scope: "openrouter",
        })) as OpenAI.Chat.Completions.ChatCompletion;
      } catch (err) {
        // Enriched only after the retries are spent, so the retry layer still
        // sees the SDK's own error shape and its status detection keeps
        // working.
        throw enrichOpenRouterError(err);
      }

      const choice = response.choices?.[0];
      const raw = (choice?.message?.content ?? "").trim();
      if (!raw) {
        throw new Error(
          [
            "OpenRouter returned an empty response.",
            `Model:         ${model}`,
            `Finish reason: ${choice?.finish_reason ?? "?"}`,
            choice?.finish_reason === "length"
              ? `Hit the output ceiling (${maxTokens} tokens). Pick a model with a larger output limit.`
              : "An empty body with a non-length finish reason usually means the upstream refused the prompt — mature campaign content gets filtered by moderated hosts. Pick an unmoderated model (the model browser flags them).",
          ].join("\n")
        );
      }

      const cleaned = stripTaggedReasoning(raw);
      if (cleaned.stripped) {
        console.warn(`[openrouter] ${model} wrote tagged reasoning into its reply; removed before use.`);
      }

      const usage = response.usage as OpenRouterUsage | undefined;
      return {
        text: cleaned.text,
        modelUsed: model,
        ...(typeof usage?.cost === "number" ? { costUsd: usage.cost } : {}),
      };
    },
  };
}

/**
 * Verify a key against the authenticated /key endpoint.
 *
 * The model catalogue is public, so listModels() succeeds with ANY key —
 * which would make the Key Vault's "Test" button always pass. This is the
 * check that actually exercises the credential.
 */
export async function verifyOpenRouterKey(
  apiKey: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${OPENROUTER_BASE_URL}/key`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.ok) return { ok: true };
  if (res.status === 401) {
    return { ok: false, error: "OpenRouter rejected the key (401). Check it at openrouter.ai/keys." };
  }
  return { ok: false, error: `OpenRouter key check returned HTTP ${res.status}.` };
}

/** One-line capability summary for the model dropdown. */
function describeModel(m: {
  isFree: boolean;
  inputPerM: number;
  outputPerM: number;
  isModerated: boolean;
  leaksReasoning?: boolean;
}): string {
  const bits: string[] = [];
  if (m.isFree) {
    bits.push("free tier — usually unreachable under the zero-retention privacy floor");
  } else {
    bits.push(`$${formatRate(m.inputPerM)}/M in · $${formatRate(m.outputPerM)}/M out`);
  }
  if (m.isModerated) bits.push("moderated");
  if (m.leaksReasoning) bits.push("leaks reasoning into replies");
  return bits.join(" · ");
}

function formatRate(perM: number): string {
  if (perM === 0) return "0";
  return perM < 0.01 ? perM.toFixed(4) : perM.toFixed(2);
}

async function toOpenRouterContent(part: ContentPart): Promise<OpenAiUserContent> {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "image":
      return { type: "image_url", image_url: { url: `data:${part.mime};base64,${part.base64}` } };
    case "document": {
      // Chat Completions takes no native PDFs — pre-extract to text, same as
      // the OpenAI adapter.
      try {
        const extracted = await extractPdfText(Buffer.from(part.base64, "base64"));
        return { type: "text", text: `Context from PDF ${part.name}:\n${extracted.substring(0, 30000)}` };
      } catch (err) {
        console.error(`[openrouter] failed to extract PDF text from ${part.name}:`, err);
        return { type: "text", text: describePdfFailure(err, part.name) };
      }
    }
  }
}
