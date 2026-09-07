import { GoogleGenAI } from "@google/genai";
import { ContentPart, GenerateInput, GenerateResult, LlmAdapter, MissingApiKeyError, ModelInfo } from "./types";
import { maskKey } from "../config/env";
import { withRetry } from "./retry";
import { compareGeminiModels, isGeminiTextModel } from "./gemini-text-models";
import type { GuardrailFlags } from "../config/settings";

interface GeminiAdapterOptions {
  apiKey: string;
  proModel: string;
  flashModel: string;
  // Per-category guardrail toggles. Absent/all-false = the historical
  // BLOCK_NONE-for-everything behaviour. Each toggled-on category bumps that
  // category's threshold to BLOCK_MEDIUM_AND_ABOVE — Google's standard
  // moderate-safety setting. We don't expose finer granularity yet; if a user
  // wants stricter, they can clamp via the Discord channel admin tools.
  guardrails?: GuardrailFlags;
}

// Gemini is the only provider with an API-level safety toggle. Anthropic and
// OpenAI bake refusals into the RLHF training and don't expose a per-call
// equivalent; the prompt-level nudge in prompt/system.ts handles those.
type GeminiSafetySetting = { category: string; threshold: string };

function buildSafetySettings(g?: GuardrailFlags): GeminiSafetySetting[] {
  const pick = (on: boolean | undefined): string =>
    on ? "BLOCK_MEDIUM_AND_ABOVE" : "BLOCK_NONE";
  return [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: pick(g?.harassment) },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: pick(g?.hate) },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: pick(g?.sexual) },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: pick(g?.dangerous) },
  ];
}

export function createGeminiAdapter(opts: GeminiAdapterOptions): LlmAdapter {
  return {
    name: "gemini",
    async listModels(): Promise<ModelInfo[]> {
      if (!opts.apiKey) throw new MissingApiKeyError("gemini", "GEMINI_API_KEY");
      // Use the REST endpoint directly. Note what it does NOT tell you:
      // Google returns the SAME ids to a free-tier key and a billing-enabled
      // one. The refusal arrives later, as a 429 carrying `"limit": 0`, at
      // the moment someone asks the bot a question — so this list is an
      // advertisement, not an entitlement, and a free key sees every Pro
      // model in it. llm/model-probe.ts is what establishes which of these
      // are actually callable; the dashboard filters on that, not on this.
      // (An earlier comment here claimed the opposite. It was wrong, and the
      // probe exists precisely because it was wrong.)
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(opts.apiKey)}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Gemini models list returned HTTP ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as {
        models?: Array<{
          name: string;
          displayName?: string;
          description?: string;
          inputTokenLimit?: number;
          outputTokenLimit?: number;
          supportedGenerationMethods?: string[];
        }>;
      };
      const models = data.models ?? [];
      return models
        // Necessary but nowhere near sufficient: the image models advertise
        // generateContent too. isGeminiTextModel is what separates modalities.
        .filter(m => (m.supportedGenerationMethods ?? []).includes("generateContent"))
        .filter(m => isGeminiTextModel(m.name.replace(/^models\//, "")))
        .map(m => ({
          id: m.name.replace(/^models\//, ""),
          displayName: m.displayName || m.name.replace(/^models\//, ""),
          description: m.description,
          inputTokenLimit: m.inputTokenLimit,
          outputTokenLimit: m.outputTokenLimit,
        }))
        // Pro first, Flash next, Flash-Lite last; newest version within tier first.
        .sort((a, b) => compareGeminiModels(a.id, b.id));
    },
    async generate(input: GenerateInput): Promise<GenerateResult> {
      if (!opts.apiKey) {
        throw new MissingApiKeyError("gemini", "GEMINI_API_KEY (or add one in the dashboard)");
      }
      const client = new GoogleGenAI({ apiKey: opts.apiKey });
      const model = input.modelOverride
        || (input.tier === "pro" ? opts.proModel : opts.flashModel);
      console.log(`[gemini] model=${model} key=${maskKey(opts.apiKey)}`);

      const response = await withRetry(
        () =>
          client.models.generateContent({
            model,
            contents: [{ parts: input.userParts.map(toGeminiPart) as any }],
            config: {
              systemInstruction: input.systemPrompt,
              safetySettings: buildSafetySettings(opts.guardrails),
              maxOutputTokens: input.maxOutputTokens ?? 8192,
            } as any,
          }),
        { scope: "gemini" }
      );

      return { text: response.text ?? "", modelUsed: model };
    },
  };
}

function toGeminiPart(part: ContentPart): unknown {
  switch (part.type) {
    case "text":
      return { text: part.text };
    case "image":
      return { inlineData: { data: part.base64, mimeType: part.mime } };
    case "document":
      return { inlineData: { data: part.base64, mimeType: part.mime } };
  }
}
