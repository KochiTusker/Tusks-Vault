import { describe, it, expect } from "vitest";
import {
  compareGeminiModels,
  geminiTierOf,
  isGeminiTextModel,
  requiresPaidGeminiKey,
} from "./gemini-text-models";

// Ids taken from a live ListModels response, so these are the shapes Google
// actually ships rather than ones invented to suit the filter.
const NON_TEXT = [
  // The reported case: Google markets gemini-3-pro-image as "Nano Banana
  // Pro", so the dropdown showed a friendly name and hid an image generator.
  "gemini-3-pro-image",
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3.1-flash-lite-image",
  // Realtime audio, not chat.
  "gemini-3.1-flash-live-preview",
  "gemini-3.5-live-translate-preview",
  "gemini-2.5-flash-native-audio-latest",
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-pro-preview-tts",
  "gemini-3.1-flash-tts-preview",
  "gemini-embedding-001",
  "gemini-embedding-2-preview",
  "gemini-2.5-computer-use-preview-10-2025",
  "gemini-robotics-er-2-preview",
  // Not in a text family at all.
  "veo-3.1-generate-preview",
  "lyria-3-pro-preview",
  "nano-banana-pro-preview",
  "deep-research-pro-preview-12-2025",
  "aqa",
  "antigravity-preview-05-2026",
];

const TEXT = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-3.1-pro-preview-customtools",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.7-flash",
  // The version-less aliases. An earlier filter required a digit right after
  // `gemini-`, so these were dropped despite being callable — the inverse
  // failure, and invisible because a hidden model looks like one that was
  // never offered.
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-pro-latest",
  // Same: excluded wholesale by the old `gemini-` requirement.
  "gemma-4-31b-it",
  "gemma-4-26b-a4b-it",
];

describe("isGeminiTextModel", () => {
  it("rejects every non-text model Google advertises", () => {
    for (const id of NON_TEXT) {
      expect(isGeminiTextModel(id), `${id} should be rejected`).toBe(false);
    }
  });

  it("accepts every text model, aliases and Gemma included", () => {
    for (const id of TEXT) {
      expect(isGeminiTextModel(id), `${id} should be accepted`).toBe(true);
    }
  });

  it("matches modality markers as whole segments, not substrings", () => {
    // `image` is a denied segment; a name that merely contains those letters
    // inside a larger word is not an image model.
    expect(isGeminiTextModel("gemini-4-imaginative-flash")).toBe(true);
    expect(isGeminiTextModel("gemini-4-flash-image")).toBe(false);
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(isGeminiTextModel("  GEMINI-3-FLASH-PREVIEW  ")).toBe(true);
    expect(isGeminiTextModel("GEMINI-3-PRO-IMAGE")).toBe(false);
  });

  it("rejects empty input rather than treating it as a model", () => {
    expect(isGeminiTextModel("")).toBe(false);
    expect(isGeminiTextModel("   ")).toBe(false);
  });

  it("lets an unknown FAMILY through but never an unknown MODALITY", () => {
    // Forward compatibility is one-directional on purpose: a text family that
    // does not exist yet must appear the day it ships...
    expect(isGeminiTextModel("gemini-9-turbo-preview")).toBe(true);
    // ...while anything naming a non-text modality stays out.
    expect(isGeminiTextModel("gemini-9-turbo-audio")).toBe(false);
  });
});

describe("compareGeminiModels", () => {
  it("orders Pro, then Flash, then Flash-Lite, then everything else", () => {
    const sorted = [
      "gemma-4-31b-it",
      "gemini-3.1-flash-lite",
      "gemini-3-flash-preview",
      "gemini-2.5-pro",
    ].sort(compareGeminiModels);
    expect(sorted).toEqual([
      "gemini-2.5-pro",
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite",
      "gemma-4-31b-it",
    ]);
  });

  it("puts the newer version first within a tier", () => {
    expect(["gemini-3.5-flash", "gemini-3.7-flash"].sort(compareGeminiModels)).toEqual([
      "gemini-3.7-flash",
      "gemini-3.5-flash",
    ]);
  });
});

describe("geminiTierOf", () => {
  it("names the tier for every shape Google ships it in", () => {
    expect(geminiTierOf("gemini-2.5-pro")).toBe("pro");
    expect(geminiTierOf("gemini-3.1-pro-preview-customtools")).toBe("pro");
    expect(geminiTierOf("gemini-pro-latest")).toBe("pro");
    expect(geminiTierOf("gemini-3-flash-preview")).toBe("flash");
    expect(geminiTierOf("gemini-flash-latest")).toBe("flash");
    expect(geminiTierOf("gemini-3.1-flash-lite")).toBe("flash-lite");
    expect(geminiTierOf("gemini-flash-lite-latest")).toBe("flash-lite");
    expect(geminiTierOf("gemma-4-31b-it")).toBe("other");
  });

  it("reads Flash-Lite as its own tier, not as Flash", () => {
    // The id contains the `flash` segment too, so an unordered check would
    // rank every Lite model as full Flash — and, worse, price it as one.
    expect(geminiTierOf("gemini-2.5-flash-lite-preview-09-2025")).toBe("flash-lite");
  });

  it("matches the tier as a segment, not a substring", () => {
    expect(geminiTierOf("gemini-4-propeller")).toBe("other");
    expect(geminiTierOf("gemini-4-proto-preview")).toBe("other");
  });
});

describe("requiresPaidGeminiKey", () => {
  it("gates every Pro model — the reported case", () => {
    // A free-tier key is advertised all of these by ListModels and refused
    // by generateContent, so the picker must not offer them.
    for (const id of [
      "gemini-2.5-pro",
      "gemini-3-pro-preview",
      "gemini-3.1-pro-preview",
      "gemini-3.1-pro-preview-customtools",
      "gemini-pro-latest",
    ]) {
      expect(requiresPaidGeminiKey(id), `${id} should need a paid key`).toBe(true);
    }
  });

  it("leaves Flash and Flash-Lite alone — the free tier's whole point", () => {
    for (const id of [
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-flash-latest",
      "gemini-3.1-flash-lite",
      "gemini-flash-lite-latest",
    ]) {
      expect(requiresPaidGeminiKey(id), `${id} should stay available`).toBe(false);
    }
  });

  it("does not invent a tier gate for families that have none", () => {
    // Gemma is open-weight and learnlm has never shipped a Pro variant;
    // blocking either on a name match would hide a model that works.
    expect(requiresPaidGeminiKey("gemma-4-31b-it")).toBe(false);
    expect(requiresPaidGeminiKey("learnlm-2.0-pro-experimental")).toBe(false);
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(requiresPaidGeminiKey("  GEMINI-2.5-PRO  ")).toBe(true);
  });

  it("ignores ids that merely start with the letters", () => {
    expect(requiresPaidGeminiKey("")).toBe(false);
    expect(requiresPaidGeminiKey("geminium-pro")).toBe(false);
  });
});
