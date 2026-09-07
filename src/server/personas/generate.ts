import { getAdapter } from "../llm/registry";
import { getSettings } from "../config/settings";
import { TEMPLATE_PROMPT } from "./presets";

// Generates a persona definition by calling the user's currently-active LLM
// adapter. Output is constrained to the same shape as the preset prompts —
// the seven core rules are preserved verbatim and only the intro paragraph
// plus the TONE rule get rewritten. We do this client-side-of-the-LLM by
// asking the model to produce JSON with name/description/intro/toneRule, then
// stitching the final prompt ourselves rather than trusting the model to
// reproduce 60 lines of citation discipline word-for-word.

export interface GeneratedPersona {
  name: string;
  description: string;
  prompt: string;
}

const META_SYSTEM_PROMPT = `You are designing a persona definition for a fantasy-chronicle Discord bot. The bot already has strict rules about citations, lore gaps, and source fidelity — those rules are immutable. Your only job is to write the voice/framing for a new persona.

Output STRICT JSON with exactly these four fields and nothing else:

{
  "name": "<short persona name, 1–4 words>",
  "description": "<one-sentence description for the UI, under 140 chars>",
  "intro": "<opening paragraph for the system prompt. Must start with 'You are {{BOT_NAME}}, the in-character archivist of a fantasy chronicle' and then describe THIS persona's voice. Include the line 'Your role is unchanged from any other archivist: recount the chronicle faithfully from the GLOBAL KNOWLEDGE BASE and RELEVANT DM CLARIFICATIONS.' Keep under 120 words.>",
  "toneRule": "<the single sentence(s) that will fill rule 6 (TONE) — describes voice, cadence, signature phrases, and instructs sparing use. Keep under 80 words.>"
}

Do not include the seven core rules, the word CORE RULES, or any rules text — only the persona's voice fields. Do not wrap the JSON in markdown fences. Do not add commentary.`;

function buildPromptFromParts(intro: string, toneRule: string): string {
  // Reuse the same structural template as the presets so generated personas
  // get the same seven rules byte-for-byte. We can't import the preset helper
  // directly without circular risk between presets.ts and generate.ts, so we
  // assemble the seven-rule body inline from TEMPLATE_PROMPT (which has the
  // canonical chronicler intro/tone we then swap out).
  const template = TEMPLATE_PROMPT;
  // The template's intro paragraph ends at the first "\n\n", and the TONE rule
  // is the line that begins with "6. TONE — ". Replace both surgically.
  const afterIntro = template.indexOf("\n\nCORE RULES:");
  const body = afterIntro === -1 ? template : template.slice(afterIntro);
  const rulesBlock = body
    .replace(/(\n6\. TONE — )[^\n]+/, `$1${toneRule.trim()}`);
  return `${intro.trim()}${rulesBlock}`;
}

function stripFences(text: string): string {
  // Models occasionally wrap JSON in ```json fences despite the instructions.
  // Strip them so JSON.parse doesn't trip.
  return text
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

export async function generatePersonaFromPrompt(userPrompt: string): Promise<GeneratedPersona> {
  if (!userPrompt.trim()) {
    throw new Error("Persona prompt is required.");
  }

  const settings = getSettings();
  const resolved = getAdapter(settings);

  const result = await resolved.adapter.generate({
    systemPrompt: META_SYSTEM_PROMPT,
    userParts: [
      {
        type: "text",
        text: `Persona brief from the user: ${userPrompt.trim()}\n\nReturn the JSON now.`,
      },
    ],
    tier: settings.defaultTier,
  });

  const raw = stripFences(result.text || "");
  if (!raw) throw new Error(`The ${resolved.provider} model returned an empty response.`);

  let parsed: { name?: unknown; description?: unknown; intro?: unknown; toneRule?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Could not parse persona JSON from the model. First 200 chars: ${raw.slice(0, 200)}`
    );
  }

  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
  const intro = typeof parsed.intro === "string" ? parsed.intro.trim() : "";
  const toneRule = typeof parsed.toneRule === "string" ? parsed.toneRule.trim() : "";

  if (!name || !intro || !toneRule) {
    throw new Error("The model's response was missing required fields (name, intro, toneRule).");
  }

  return {
    name,
    description: description || `A custom persona generated from "${userPrompt.trim().slice(0, 80)}".`,
    prompt: buildPromptFromParts(intro, toneRule),
  };
}
