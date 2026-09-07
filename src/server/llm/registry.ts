import { Settings, LlmProvider } from "../config/settings";
import { LlmAdapter, MissingApiKeyError } from "./types";
import { createGeminiAdapter } from "./gemini";
import { createOpenRouterAdapter } from "./openrouter";
import { createClaudeCodeAdapter } from "./claude-code";
import { claudeCodeInstalledSync } from "./claude-code-cli";
import { createOllamaAdapter } from "./ollama";
import { findGeminiKey, isPlaceholder } from "../config/env";
import { getActiveKey, resolveKeyForProvider } from "../keys/store";
import { couldBelongTo, reconcileModels } from "./model-namespace";

// Four reachable connections, and only two of them take a key.
//
// Anthropic and OpenAI were retired as direct-key providers: OpenRouter
// reaches the same models on one key at one bill, and maintaining three
// key slots to talk to two labs was cost with no benefit. Gemini keeps its
// own key deliberately — it is meaningfully cheaper direct than through
// OpenRouter, so routing it through the aggregator would charge the user
// more for the same model.
//
// Their adapters are gone. They were kept for a while as documentation of
// the OpenAI wire format — but openrouter.ts is a LIVE implementation of that
// same format, and a dead file is not better documentation than a working
// one. Deleting them also dropped an SDK from every install.

// Ollama needs no install state, and nothing asks whether it is "available":
// it is either reachable at the configured base URL or it is not, which the
// picker settles by probing. The constant-true predicate that used to sit here
// answered a question no caller had.

// Claude Code is available iff the user's CLI is on PATH. Cached: the
// provider list is rebuilt on every poll of /api/providers, and a process
// spawn per poll would be absurd.
let claudeCodeCache: { value: boolean; at: number } | null = null;
export function isClaudeCodeAvailable(): boolean {
  if (claudeCodeCache && Date.now() - claudeCodeCache.at < 30_000) return claudeCodeCache.value;
  const value = claudeCodeInstalledSync();
  claudeCodeCache = { value, at: Date.now() };
  return value;
}

// Two layers of key resolution, in order:
//  1. The user-managed registry in the encrypted key store (added via the dashboard).
//  2. .env.local fallback (for advanced users hand-editing env vars).
function lookupKey(provider: LlmProvider): string {
  const fromStore = resolveKeyForProvider(provider);
  if (fromStore) return fromStore;
  if (provider === "gemini") return findGeminiKey().key;
  if (provider === "openrouter") return (process.env.OPENROUTER_API_KEY ?? "").trim();
  return "";
}

// Resolve the provider + model the user actually wants to call:
//  - If the active key is set, use its provider.
//  - Else fall back to settings.provider.
//  - Pro/flash model come from settings; the front-page picker may also pin
//    a specific model id via modelOverride on the call site.
export interface ResolvedAdapter {
  adapter: LlmAdapter;
  provider: LlmProvider;
  keyConfigured: boolean;
}

/**
 * Which provider is actually in use.
 *
 * An active key OUTRANKS `settings.provider`, and the two drift apart in
 * ordinary use — activating a key does not always rewrite the field, and
 * deleting one re-points the active key entirely. Anything that reports or
 * reasons about "the current provider" has to ask this rather than read
 * `settings.provider`, or it describes a connection that is not the one
 * being called.
 */
export function resolveProvider(settings: Settings): LlmProvider {
  const active = getActiveKey();
  // A stored key may name a retired provider; those rows are inert, so fall
  // through to settings rather than trying to build an adapter for one.
  const activeProvider =
    active && (active.provider === "gemini" || active.provider === "openrouter")
      ? (active.provider as LlmProvider)
      : null;
  return activeProvider ?? settings.provider;
}

export interface GetAdapterOptions {
  /** Build for THIS provider regardless of which key is active.
   *
   *  For callers answering "what could this other connection do?" — the model
   *  list behind a provider the user is considering but has not switched to.
   *  Without it such a caller silently gets the active connection's answer
   *  labelled as the requested one. */
  explicitProvider?: LlmProvider;
}

export function getAdapter(settings: Settings, opts: GetAdapterOptions = {}): ResolvedAdapter {
  const provider = opts.explicitProvider ?? resolveProvider(settings);
  const key = lookupKey(provider);

  // Model namespaces do not overlap, and the id saved in settings can belong
  // to a DIFFERENT provider than the one resolved above — activating a key
  // outranks settings.provider without rewriting it, and deleting a key
  // re-points the active one entirely. Building the adapter with a foreign id
  // means every call fails at the provider: Google 404s on `owner/model`,
  // OpenRouter 404s on a bare `gemini-…`.
  //
  // Resolved here rather than in config/settings.ts because this is the only
  // place that knows which provider actually won. In memory only — a read
  // must not rewrite the user's saved choice, and the id is still correct for
  // the connection they can switch back to.
  const reconciled = reconcileModels(provider, settings);
  const proModel = reconciled?.proModel ?? settings.proModel;
  const flashModel = reconciled?.flashModel ?? settings.flashModel;

  let adapter: LlmAdapter;
  switch (provider) {
    case "openrouter":
      adapter = createOpenRouterAdapter({
        apiKey: key,
        proModel,
        flashModel,
        dataSharingOptIn: settings.openRouterDataSharingOptIn ?? [],
      });
      break;
    case "claudeCode":
      adapter = createClaudeCodeAdapter({ proModel, flashModel });
      break;
    case "ollama":
      adapter = createOllamaAdapter({
        proModel,
        flashModel,
        baseUrl: settings.ollamaBaseUrl,
      });
      break;
    case "gemini":
    default:
      adapter = createGeminiAdapter({
        apiKey: key,
        proModel,
        // modelName is the pre-split legacy field; it only applies when it is
        // itself callable by this provider.
        flashModel: couldBelongTo(provider, settings.modelName ?? "")
          ? (settings.modelName as string)
          : flashModel,
        guardrails: settings.guardrails,
      });
      break;
  }

  return {
    adapter,
    provider,
    // Neither of these carries a key: Ollama is a local endpoint, and Claude
    // Code rides the user's already-signed-in CLI. "Configured" for them
    // means "reachable", which the picker probes separately.
    keyConfigured:
      provider === "ollama" || provider === "claudeCode" ? true : !isPlaceholder(key),
  };
}

export interface ProviderStatus {
  id: LlmProvider;
  label: string;
  envVar: string;
  keyConfigured: boolean;
  isCurrent: boolean;
  storedKeyCount: number;
}

export function listProviderStatuses(settings: Settings): ProviderStatus[] {
  const currentProvider = resolveProvider(settings);

  const providers: Array<Omit<ProviderStatus, "keyConfigured" | "isCurrent" | "storedKeyCount">> = [
    { id: "gemini", label: "Google Gemini", envVar: "GEMINI_API_KEY" },
    { id: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY" },
    { id: "claudeCode", label: "Claude Code (subscription)", envVar: "(none — uses your signed-in CLI)" },
    { id: "ollama", label: "Ollama (local)", envVar: "(none — uses local server)" },
  ];

  return providers.map(p => ({
    ...p,
    keyConfigured:
      p.id === "ollama"
        ? true
        : p.id === "claudeCode"
          ? isClaudeCodeAvailable()
          : !isPlaceholder(lookupKey(p.id)),
    isCurrent: p.id === currentProvider,
    storedKeyCount: 0, // patched in by the route handler
  }));
}

export function formatAdapterError(err: unknown): string {
  if (err instanceof MissingApiKeyError) {
    return `Error: missing key for ${err.provider}. Open the dashboard's Key Vault section and add one, or set ${err.envVar} in .env.local.`;
  }
  if (err instanceof Error) {
    const msg = err.message || String(err);
    if (msg.includes("API key not valid") || msg.includes("API_KEY_INVALID")) {
      return "Error: the LLM provider rejected the API key. Open the dashboard and verify the active key.";
    }
    // OpenRouter's 404 when the privacy floor (zero-data-retention routing)
    // excludes every host serving the chosen model. Without this mapping the
    // raw message reads like the model doesn't exist at all.
    if (msg.includes("No endpoints found")) {
      // Not a dead end: the floor is per-model and can be lifted for one
      // model deliberately. Saying only "pick a different model" hides the
      // choice the user actually has and reads as a bug rather than a
      // policy — which is how this turned up as a support question.
      return (
        "Error: this model is only served by hosts that keep prompts, so Vault's privacy floor " +
        "blocked it. That is usually why a model is free. Open the model picker and choose it " +
        "again to allow data sharing for this one model — Vault will spell out what that means " +
        "before anything is sent. Everything else stays on the privacy floor."
      );
    }
    if (msg.includes("Claude Code usage limit")) {
      return `Error: ${msg}`;
    }
    if (msg.includes("Claude Code CLI not found")) {
      return "Error: the Claude Code CLI isn't on this machine's PATH. Install it and run `claude login`, or pick a different provider in the Active Provider card.";
    }
    // A free model's rate limit is not the user's quota running out — the
    // whole free tier shares one upstream allowance, and when it saturates
    // nothing about this account changes the outcome. Saying "quota" would
    // send them to their billing page to fix something that is not broken.
    if (msg.includes("SHARED_FREE_POOL")) {
      return (
        "Error: the free tier for this model is busy right now. Free models share one pool " +
        "across everyone using them, so this is not your quota running out and waiting is the " +
        "only fix — Vault already retried for about 40 seconds. Ask again in a minute, or pick " +
        "a paid model in the picker for something that answers reliably."
      );
    }
    if (msg.includes("rate-limited upstream")) {
      return (
        "Error: the provider behind this model is rate-limiting requests. Vault retried and it " +
        "kept refusing. Try again shortly, or pick a different model."
      );
    }
    if (msg.includes("quota") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("rate_limit")) {
      return "Error: quota / rate-limit hit. Try again shortly, or switch to a different key in the Active Channel picker.";
    }
    if (msg.includes("Ollama HTTP") || msg.includes("ECONNREFUSED")) {
      return "Error: could not reach Ollama. Make sure `ollama serve` is running and the base URL in Settings is correct.";
    }
    return `Error: ${msg}`;
  }
  return "Oops, I ran into an error while thinking. Please try again later.";
}
