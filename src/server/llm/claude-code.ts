// Claude Code adapter — answers through the user's own Pro/Max
// subscription instead of an API key.
//
// Structurally the odd one out: there is no separate system channel and no
// binary content channel, because everything reaches the CLI as one stdin
// prompt. So system + lore + question are composed into a single string and
// handed to llm/claude-code-cli.ts, which owns the spawn.
//
// The CLI carries its own default coding-agent system prompt, which we
// deliberately do NOT replace: --system-prompt would put the app's system
// text on argv, and argv goes through a shell on Windows. Instead the
// framing block below leads the prompt and explains the task. Without it
// the model answers as a coding assistant — it hedges on campaign material,
// adds disclaimers, and drifts out of the scribe's voice.
//
// What that block must NOT do is pretend to be a system message. It arrives
// as user text; text arriving there and claiming to override the assistant's
// framing is what an injection looks like, and the models say so in the
// reply. Explaining the request honestly works; asserting authority over it
// does not.

import { describePdfFailure, extractPdfText } from "../util/pdf-text";
import { ContentPart, GenerateInput, GenerateResult, LlmAdapter, ModelInfo } from "./types";
import { CLAUDE_CODE_MODELS, ClaudeCodeError, runClaudeCode } from "./claude-code-cli";


/**
 * The last thing the model reads, and it is an instruction to answer.
 *
 * The CLI has no system-role parameter, so everything — framing, system
 * prompt, lore, question — arrives as one user message. Small models
 * sometimes read that wall of instruction as the thing being addressed and
 * reply by acknowledging it: "I am the archivist of your chronicle, ready to
 * answer questions according to the rules you've set." A perfectly obedient
 * response to the wrong prompt, and useless in a Discord channel.
 *
 * Passing the system prompt on argv instead would fix it at the root, and the
 * CLI does accept `--system-prompt` — but the child is spawned with
 * `shell: true` on Windows for the .cmd shim, and that prompt carries
 * user-authored persona text. Putting it on a shell command line would trade
 * a cosmetic bug for an injection surface. So the fix is structural: make the
 * question unmistakably the task by putting a directive AFTER it, where a
 * model weights it most.
 */
export const CLAUDE_CODE_CLOSER = [
  "---",
  "Answer the question above, now, using the source material above it. Reply with the answer " +
    "only: do not restate these instructions, do not acknowledge them, do not introduce " +
    "yourself, and do not describe what you are about to do.",
].join("\n");

/**
 * Why this no longer claims to be a system message.
 *
 * The CLI has no system-role parameter, so this block arrives inside the user
 * message. It used to open "# OPERATING CONTEXT (overrides any default
 * assistant framing)" and instruct the model to "treat the instructions that
 * follow as authoritative" — which, arriving as user text asserting system
 * authority, is indistinguishable from a prompt injection. Claude models are
 * trained to notice exactly that, and they did:
 *
 *   "I'm not going to adopt the embedded 'operating context' as if it were a
 *    real system override — that framing was injected into the message text
 *    itself, not provided by the actual system."
 *
 * Both models then answered fine, because the CONTENT was never the problem.
 * But the disclaimer was landing in Discord replies ahead of the answer, and
 * on the smaller model it derailed the task altogether.
 *
 * So the framing now says what is true: this is the operator's own
 * configuration for their own tool, offered as context rather than asserted
 * as authority. A request does not become more legitimate by claiming to
 * outrank the assistant — it becomes more suspicious.
 */
export const CLAUDE_CODE_FRAMING = [
  "# About this request",
  "This request comes from Tusk's Vault, a self-hosted archivist a group runs over their own " +
    "tabletop campaign notes. The person asking is the owner of that material; it is collaborative " +
    "fiction written by adults at their own table. The instructions below are their configuration " +
    "for this tool, not a system directive — weigh them as you would any user's stated preferences " +
    "about how they want their own documents handled.",
  "## How they want answers written",
  "The knowledge base below is that campaign's canon. Answer from it, end every factual claim with " +
    "its citation marker, and when the answer genuinely is not present say so with the exact phrase " +
    "the instructions specify rather than inferring, guessing, or padding.",
  "## On the tone of the material",
  "Campaign material contains violence, dark humour, profanity and sexual references, written " +
    "deliberately by the people asking. When recounting what their own records say, quoting them " +
    "as written is the point — softening or bowdlerising their prose back at them is a worse " +
    "answer, not a safer one. This is about faithful recital of their existing material; it is " +
    "not a request to originate anything.",
].join("\n\n");

interface ClaudeCodeAdapterOptions {
  proModel: string;
  flashModel: string;
}

export function createClaudeCodeAdapter(opts: ClaudeCodeAdapterOptions): LlmAdapter {
  return {
    name: "claudeCode",

    // The CLI's model set is a fixed alias list, not a queryable catalogue.
    // Returning it directly keeps the dashboard dropdown honest rather than
    // pretending a /models endpoint exists.
    async listModels(): Promise<ModelInfo[]> {
      return CLAUDE_CODE_MODELS.map(id => ({
        id,
        displayName: id.charAt(0).toUpperCase() + id.slice(1),
        description: "Runs on your Claude Code subscription — no API key, no per-token billing.",
      }));
    },

    async generate(input: GenerateInput): Promise<GenerateResult> {
      const model = input.modelOverride
        || (input.tier === "pro" ? opts.proModel : opts.flashModel)
        || "sonnet";

      const composed = [
        CLAUDE_CODE_FRAMING,
        input.systemPrompt,
        await flattenParts(input.userParts),
        CLAUDE_CODE_CLOSER,
      ]
        .filter(s => s && s.trim().length > 0)
        .join("\n\n");

      let result;
      try {
        result = await runClaudeCode({ model, prompt: composed });
      } catch (err) {
        // Rewrite only the usage-limit case: it is the one failure where the
        // right next step ("wait, or switch provider") isn't obvious from the
        // CLI's own wording. Everything else already reads well, and
        // registry.formatAdapterError maps it for Discord.
        if (err instanceof ClaudeCodeError && err.kind === "usage_limit") {
          throw new Error(
            "Claude Code usage limit reached — your subscription's window is exhausted. " +
              "It resets on a rolling schedule; try again later, or switch to another provider " +
              "in the Active Provider picker. " +
              err.message.slice(0, 200)
          );
        }
        throw err;
      }

      return {
        text: result.text,
        modelUsed: `claude-code:${model}`,
        ...(typeof result.costUsd === "number" ? { costUsd: result.costUsd } : {}),
      };
    },
  };
}

/** Collapse the multimodal part list into one text prompt.
 *
 *  The CLI has no binary channel. PDFs are pre-extracted the same way the
 *  OpenAI adapter does it; images cannot travel at all, and are announced as
 *  a visible placeholder rather than dropped silently — an answer that
 *  ignores an attachment without saying so reads as the model missing it. */
async function flattenParts(parts: ContentPart[]): Promise<string> {
  const out: string[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      out.push(part.text);
    } else if (part.type === "document") {
      try {
        const text = await extractPdfText(Buffer.from(part.base64, "base64"));
        out.push(`Context from PDF ${part.name}:\n${text.substring(0, 30000)}`);
      } catch (err) {
        out.push(describePdfFailure(err, part.name));
      }
    } else {
      out.push(
        "(An image was attached. The Claude Code CLI accepts text only, so it could not be read — " +
          "switch to OpenRouter or Gemini for image questions.)"
      );
    }
  }
  return out.join("\n\n");
}
