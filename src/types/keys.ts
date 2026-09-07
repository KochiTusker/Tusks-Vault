// Shared types + constants for the API Keys surface. Lives outside App.tsx
// so the KeyVaultPanel component and the App container can share a single
// definition rather than duplicating type declarations.

// The four connections Vault can actually call. There is no Anthropic or
// OpenAI slot: those models are reached through OpenRouter — one key, one
// bill, same models.
export type LlmProvider = "gemini" | "openrouter" | "ollama" | "claudeCode";

export type LlmTier = "pro" | "flash";
export type KeyTier = "free" | "paid" | "n/a";

export interface StoredKey {
  id: string;
  provider: LlmProvider;
  label: string;
  tier: KeyTier;
  maskedKey: string;
  createdAt: string;
}

// Per-key test status for the Settings → API Keys panel. Mirrors Tomes'
// ProviderSettings: clicking "Test" pings the provider's models endpoint
// via /api/keys/:id/test and stores the result here so the row can show a
// green check (ok) or a red error pill (fail) until the next reload.
export type TestResult = {
  status: "pending" | "ok" | "fail";
  modelCount?: number;
  error?: string;
};

// Section descriptors for the API Keys panel — ordering and copy mirror the
// Tusks-Tomes layout. The Gemini section is split into Paid + Free sub-rows
// because Gemini's no-billing project is billed separately and many users
// keep both.
export interface KeySectionDef {
  provider: "gemini" | "openrouter";
  tier: KeyTier;
  heading: string;
  description?: string;
  labelHint: string;
  keyPlaceholder: string;
}

// OpenRouter leads: it is the one key that reaches Claude, GPT, Llama and
// the rest, so it is what a new user most likely wants. Gemini keeps its own
// slot below because direct Gemini is measurably cheaper than the same model
// through the aggregator — routing it through OpenRouter would charge more
// for identical output.
export const KEY_SECTIONS: KeySectionDef[] = [
  {
    provider: "openrouter",
    tier: "n/a",
    heading: "OpenRouter",
    description:
      "One key for ~400 models across every major lab — Claude, GPT, Llama, Qwen and the rest. Requests route only to hosts that don't retain prompts.",
    labelHint: "openrouter.ai/keys",
    keyPlaceholder: "sk-or-…",
  },
  {
    provider: "gemini",
    tier: "paid",
    heading: "Google Gemini · Paid tier",
    description:
      "Billing-enabled project. Gemini keeps a direct slot because it is cheaper called directly than the same model through OpenRouter.",
    labelHint: "Workspace billing",
    keyPlaceholder: "AIza…",
  },
  {
    provider: "gemini",
    tier: "free",
    heading: "Google Gemini · Free tier",
    description: "No-billing project. Paid-only models will be greyed out when this key is selected.",
    labelHint: "Personal free tier",
    keyPlaceholder: "AIza…",
  },
];
