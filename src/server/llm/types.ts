export type LlmTier = "pro" | "flash";

export type ContentPart =
  // `cacheable` marks a part whose bytes are stable across consecutive calls
  // (the knowledge-base block). Adapters that support prompt caching (today:
  // OpenRouter) place their cache breakpoint after the last leading cacheable
  // part; every other adapter ignores the flag. Only prompt assembly may set
  // it — a wrongly-marked variable part silently re-writes the cache on every
  // call, which shows up as a bill several times larger than expected.
  | { type: "text"; text: string; cacheable?: boolean }
  | { type: "image"; mime: string; base64: string }
  | { type: "document"; mime: string; base64: string; name: string };

export interface GenerateInput {
  systemPrompt: string;
  userParts: ContentPart[];
  tier: LlmTier;
  maxOutputTokens?: number;
  // Model override at call time. When set, takes precedence over the adapter's
  // pro/flash defaults. Used by the front-page "Active Channel" picker which
  // lets the user pin a specific model id.
  modelOverride?: string;
}

export interface GenerateResult {
  text: string;
  modelUsed: string;
  // Actual billed cost in USD, when the provider reports it on the response
  // (today: OpenRouter's usage.cost). Absent everywhere else — a displayed
  // cost is either real or missing, never estimated.
  costUsd?: number;
}

export interface ModelInfo {
  id: string;              // identifier passed to the API on call
  displayName: string;     // human-friendly name
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

export interface LlmAdapter {
  readonly name: string;
  generate(input: GenerateInput): Promise<GenerateResult>;
  // Optional: providers that support a "what models can this key call?"
  // endpoint implement this so the UI can populate a real dropdown instead
  // of asking the user to type model ids by hand.
  listModels?(): Promise<ModelInfo[]>;
}

export class MissingApiKeyError extends Error {
  constructor(public readonly provider: string, public readonly envVar: string) {
    super(`Missing API key for ${provider}. Set ${envVar} in .env.local.`);
    this.name = "MissingApiKeyError";
  }
}
