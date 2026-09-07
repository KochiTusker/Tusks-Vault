// Which Gemini models can answer a lore question in text?
//
// Google's ListModels returns everything the key is offered, across every
// modality, and `supportedGenerationMethods: ["generateContent"]` does NOT
// mean "replies with text": the image models generate through generateContent
// too. `gemini-3-pro-image` — the one Google markets as Nano Banana Pro — is
// advertised exactly like `gemini-3-flash` is, and picking it means every
// question comes back as an image or an error.
//
// So the filter is by modality, expressed two ways:
//
//   Deny by SEGMENT. Ids are hyphen-delimited, and the modality is a segment
//   of the name (`gemini-3-pro-IMAGE`, `gemini-3.1-flash-LIVE-preview`).
//   Matching segments rather than substrings is what lets `image` be a
//   denied word without it also killing some future `imaginative-flash`.
//
//   Allow by FAMILY. Anything in Google's text families passes, rather than
//   an allow-list of known tiers. An earlier version required
//   `gemini-<version>-(pro|flash|flash-lite)`, which silently dropped the
//   perfectly callable `gemini-flash-latest`, `gemini-flash-lite-latest` and
//   the whole `gemma-*` family — invisible to the user, with no warning. A
//   new Google text family should appear the day it ships; a new modality
//   should not.
//
// This is a shape filter, not an entitlement check. Whether the key can
// actually CALL what survives is a different question, and llm/model-probe.ts
// is what answers it.

/** Modality markers, matched as whole hyphen-delimited segments. */
const NON_TEXT_SEGMENTS = new Set([
  "image",
  "images",
  "imagen",
  "veo",
  "lyria",
  "banana",
  "tts",
  "audio",
  "speech",
  "whisper",
  "voice",
  "music",
  "video",
  "live",
  "vision",
  "dialog",
  "embed",
  "embedding",
  "embeddings",
  "robotics",
  "aqa",
]);

/** Markers that span a hyphen and so cannot be caught segment-wise. */
const NON_TEXT_PHRASES = [
  /computer-use/,
  /deep-research/,
  /nano-banana/,
  /text-to-speech/,
  /native-audio/,
  /image-edit/,
  /live-translate/,
];

/** Google's text-generation families. `learnlm` is included because it is a
 *  Gemini-derived text model that has appeared and disappeared from the list
 *  before; excluding it would be an arbitrary omission. */
const TEXT_FAMILY = /^(gemini|gemma|learnlm)-/;

/**
 * True when `modelId` names something that answers in text.
 *
 * Takes the bare id (`gemini-3-flash-preview`), not the `models/`-prefixed
 * form the API returns — strip it first.
 */
export function isGeminiTextModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id) return false;
  if (!TEXT_FAMILY.test(id)) return false;
  if (NON_TEXT_PHRASES.some(re => re.test(id))) return false;
  return !id.split("-").some(segment => NON_TEXT_SEGMENTS.has(segment));
}

/** Google's size tiers, as named in the model id. `other` covers the ids
 *  that name no tier at all — the Gemma family, mostly. */
export type GeminiTier = "pro" | "flash" | "flash-lite" | "other";

/**
 * Which size tier `modelId` belongs to.
 *
 * Matched on hyphen-delimited segments for the same reason the modality
 * filter above is: `pro` as a substring would also claim a future
 * `gemini-4-propeller`, and the tier drives both the sort order and the
 * paid-key gate below — a wrong answer there hides a working model.
 * Flash-Lite is checked first because it spans a hyphen and its id also
 * contains the `flash` segment.
 */
export function geminiTierOf(modelId: string): GeminiTier {
  const id = modelId.trim().toLowerCase();
  if (/(^|-)flash-lite(-|$)/.test(id)) return "flash-lite";
  const segments = new Set(id.split("-"));
  if (segments.has("flash")) return "flash";
  if (segments.has("pro")) return "pro";
  return "other";
}

/**
 * True when this model can only be called by a billing-enabled key.
 *
 * Google removed Pro from the API's free tier: a no-billing project is
 * still ADVERTISED every Pro model by ListModels, and still gets a 429
 * carrying `"limit": 0` the moment it calls one. That is a permanent no, so
 * offering the model to a free key is offering a question that never gets
 * answered.
 *
 * Scoped to the `gemini-` family deliberately. Gemma is open-weight and
 * carries no tier gate, and `learnlm` has never shipped a Pro variant —
 * blocking either on a name match would be inventing a restriction Google
 * does not impose.
 *
 * This is a statement about the MODEL, not about any particular key. It is
 * a default, not a verdict: `llm/model-probe.ts` makes a real call, and a
 * probe that comes back accessible is evidence which outranks this.
 */
export function requiresPaidGeminiKey(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id.startsWith("gemini-")) return false;
  return geminiTierOf(id) === "pro";
}

/** Sort rank per tier: Pro, then Flash, then Flash-Lite, then the rest. */
const TIER_RANK: Record<GeminiTier, number> = { pro: 0, flash: 1, "flash-lite": 2, other: 3 };

/**
 * Sort order for the model dropdown: Pro, then Flash, then Flash-Lite, and
 * newest version first inside each tier. Anything that names no tier — the
 * Gemma models — sorts last, since they are the specialist choice here.
 */
export function compareGeminiModels(a: string, b: string): number {
  const ta = TIER_RANK[geminiTierOf(a)];
  const tb = TIER_RANK[geminiTierOf(b)];
  if (ta !== tb) return ta - tb;
  return b.localeCompare(a);
}
