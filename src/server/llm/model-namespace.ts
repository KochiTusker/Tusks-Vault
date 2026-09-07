// Which provider does a model id belong to?
//
// Each connection names its models in its own namespace, and the namespaces
// do not overlap: OpenRouter is always `vendor/model`, Gemini is always a
// bare `gemini-…` id, Claude Code is one of three fixed aliases. Nothing in
// the settings file enforces that, so switching connection used to leave the
// PREVIOUS provider's model id saved against the NEW provider — a Gemini
// connection pointed at `cognitivecomputations/dolphin-…`, which Google
// answers with a 404 on every question, and which the dashboard then
// re-offered in the Gemini dropdown as the selected model.
//
// The check below is deliberately DIRECTIONAL rather than a validator. It
// answers "could this id possibly belong to that provider" and nothing more:
// a wrong `false` silently discards a model the user deliberately chose, so
// it says false only where the namespaces make it impossible. Anything it
// cannot rule out is left alone.

// Type-only, so this stays a leaf module: config/settings imports it during
// its own normalisation, and a runtime edge back would be a cycle.
import type { LlmProvider } from "../config/settings";

/** The three aliases the Claude Code CLI accepts.
 *
 *  Owned here rather than in the CLI wrapper because it is data about a
 *  namespace, and this module is the one thing that may not depend on a
 *  process-spawning module. claude-code-cli re-exports it. */
export const CLAUDE_CODE_MODELS = ["sonnet", "opus", "haiku"];

/** Per-provider fallbacks, used when a saved id provably belongs elsewhere.
 *
 *  Flash-class on both cloud providers: it is what a lore question actually
 *  wants (large input, short answer) and what the rest of the app defaults
 *  to. Keeping these here rather than in the dashboard means a connection
 *  switched from any surface lands somewhere callable. */
export const PROVIDER_DEFAULT_MODELS: Record<LlmProvider, { pro: string; flash: string }> = {
  gemini: { pro: "gemini-2.5-pro", flash: "gemini-3-flash-preview" },
  openrouter: { pro: "google/gemini-2.5-pro", flash: "google/gemini-2.5-flash" },
  claudeCode: { pro: "opus", flash: "haiku" },
  ollama: { pro: "llama3.1:8b", flash: "phi3:mini" },
};

/**
 * Could `modelId` belong to `provider`?
 *
 * False means "provably not", never "unrecognised". The caller resets the
 * saved model only on a false, so a new Gemini family or an unfamiliar Ollama
 * tag must pass rather than be silently swapped out from under the user.
 */
export function couldBelongTo(provider: LlmProvider, modelId: string): boolean {
  const id = modelId.trim();
  if (!id) return false;

  switch (provider) {
    case "gemini":
      // Google's ids never carry a vendor prefix. A slash means the id came
      // from OpenRouter's namespace, which is the whole bug this catches.
      return !id.includes("/");

    case "openrouter":
      // Every catalogue entry is `vendor/model`; `~vendor/model` is the
      // floating-alias form of the same shape.
      return id.replace(/^~/, "").includes("/");

    case "claudeCode":
      // A closed set of three aliases — anything else cannot be passed to the
      // CLI, so there is no forward-compatibility cost to being strict.
      return CLAUDE_CODE_MODELS.includes(id);

    case "ollama":
      // `name:tag`, but custom registries legitimately use `namespace/name`.
      // Nothing here is impossible, so nothing is rejected.
      return true;
  }
}

/**
 * The models to save for `provider`, keeping the user's choices where they
 * can still be called and falling back only where they cannot.
 *
 * Returns null when both ids already fit — the caller can then skip the write
 * entirely rather than rewriting settings with identical content.
 */
export function reconcileModels(
  provider: LlmProvider,
  current: { proModel: string; flashModel: string }
): { proModel: string; flashModel: string } | null {
  const defaults = PROVIDER_DEFAULT_MODELS[provider];
  const proOk = couldBelongTo(provider, current.proModel);
  const flashOk = couldBelongTo(provider, current.flashModel);
  if (proOk && flashOk) return null;
  return {
    proModel: proOk ? current.proModel : defaults.pro,
    flashModel: flashOk ? current.flashModel : defaults.flash,
  };
}
