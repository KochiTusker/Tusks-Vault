import { describePdfFailure, extractPdfText } from "../util/pdf-text";
import { ContentPart, GenerateInput, GenerateResult, LlmAdapter, ModelInfo } from "./types";


interface OllamaAdapterOptions {
  proModel: string;
  flashModel: string;
  baseUrl: string;
}

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

interface OllamaChatResponse {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

// Ollama (local). PDFs are pre-extracted to text — open-source local models
// rarely have native PDF support. Vision support depends on the model pulled
// (e.g. llava); for text-only models the images array is simply ignored.
export function createOllamaAdapter(opts: OllamaAdapterOptions): LlmAdapter {
  return {
    name: "ollama",
    // Lists the models currently pulled into the local Ollama server. Vision
    // / multimodal tags are kept (some users explicitly run llava-style
    // models for image questions) but any model whose family is clearly
    // non-text (e.g. embedding-only) is dropped — same philosophy as the
    // cloud adapters.
    async listModels(): Promise<ModelInfo[]> {
      const res = await fetch(`${opts.baseUrl}/api/tags`, {
        // Every other outbound fetch in the codebase is bounded; this one held
        // the request open indefinitely against a black-holing host. `manual`
        // keeps a redirect from carrying the request off the loopback host the
        // guard just checked.
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        throw new Error(`Ollama models list returned HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        models?: Array<{ name: string; size?: number; details?: { family?: string } }>;
      };
      return (data.models ?? [])
        .filter(m => !/^(nomic-embed|mxbai-embed|bge-|all-minilm)/i.test(m.name))
        .map(m => ({
          id: m.name,
          displayName: m.name,
          description: m.details?.family ? `family: ${m.details.family}` : undefined,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    async generate(input: GenerateInput): Promise<GenerateResult> {
      const model = input.tier === "pro" ? opts.proModel : opts.flashModel;
      console.log(`[ollama] model=${model} baseUrl=${opts.baseUrl}`);

      const textBuf: string[] = [];
      const images: string[] = [];
      for (const part of input.userParts) {
        if (part.type === "text") {
          textBuf.push(part.text);
        } else if (part.type === "image") {
          images.push(part.base64);
        } else if (part.type === "document") {
          try {
            const extracted = await extractPdfText(Buffer.from(part.base64, "base64"));
            textBuf.push(`Context from PDF ${part.name}:\n${extracted.substring(0, 30000)}`);
          } catch (err) {
            console.error(`[ollama] failed to extract PDF text from ${part.name}:`, err);
            textBuf.push(describePdfFailure(err, part.name));
          }
        }
      }

      const userMessage: OllamaMessage = {
        role: "user",
        content: textBuf.join("\n\n"),
      };
      if (images.length > 0) userMessage.images = images;

      const messages: OllamaMessage[] = [
        { role: "system", content: input.systemPrompt },
        userMessage,
      ];

      const res = await fetch(`${opts.baseUrl}/api/chat`, {
        // This request carries the system prompt and the whole lore corpus, so
        // it needs the redirect guard MORE than the model list does: a 307/308
        // preserves method and body, which would carry the corpus to whatever
        // the redirect names.
        redirect: "manual",
        signal: AbortSignal.timeout(120_000),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          options: { num_predict: input.maxOutputTokens ?? 4096 },
        }),
      });

      if (!res.ok) {
        throw new Error(`Ollama HTTP ${res.status}`);
      }
      const data = (await res.json()) as OllamaChatResponse;
      if (data.error) throw new Error(`Ollama: ${data.error}`);

      return { text: data.message?.content ?? "", modelUsed: model };
    },
  };
}
