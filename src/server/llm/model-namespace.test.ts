import { describe, it, expect } from "vitest";
import {
  CLAUDE_CODE_MODELS,
  PROVIDER_DEFAULT_MODELS,
  couldBelongTo,
  reconcileModels,
} from "./model-namespace";

describe("couldBelongTo", () => {
  it("rejects an OpenRouter id under Gemini — the bug this exists for", () => {
    // The real report: settings said provider=gemini while both model slots
    // held this id, so the Gemini dropdown offered it as the chosen model and
    // every call to Google 404'd on it.
    expect(couldBelongTo("gemini", "cognitivecomputations/dolphin-mistral-24b-venice-edition")).toBe(false);
    expect(couldBelongTo("gemini", "google/gemini-2.5-pro")).toBe(false);
  });

  it("accepts bare Gemini ids, including families that do not exist yet", () => {
    expect(couldBelongTo("gemini", "gemini-2.5-pro")).toBe(true);
    expect(couldBelongTo("gemini", "gemini-3-flash-preview")).toBe(true);
    // Forward compatibility is the point: a new Google family must not be
    // swapped out from under the user just because this file has not heard
    // of it.
    expect(couldBelongTo("gemini", "gemini-9-something-entirely-new")).toBe(true);
    expect(couldBelongTo("gemini", "gemma-4-31b-it")).toBe(true);
  });

  it("requires a vendor prefix on OpenRouter, alias form included", () => {
    expect(couldBelongTo("openrouter", "google/gemini-2.5-flash")).toBe(true);
    expect(couldBelongTo("openrouter", "~anthropic/claude-latest")).toBe(true);
    expect(couldBelongTo("openrouter", "gemini-2.5-pro")).toBe(false);
  });

  it("holds Claude Code to its three aliases", () => {
    for (const id of CLAUDE_CODE_MODELS) expect(couldBelongTo("claudeCode", id)).toBe(true);
    expect(couldBelongTo("claudeCode", "gemini-2.5-pro")).toBe(false);
    expect(couldBelongTo("claudeCode", "opus-4")).toBe(false);
  });

  it("rules nothing out for Ollama, whose tags are unknowable from here", () => {
    expect(couldBelongTo("ollama", "llama3.1:8b")).toBe(true);
    // Custom registries legitimately namespace with a slash, so the slash
    // rule that catches OpenRouter ids must not be applied here.
    expect(couldBelongTo("ollama", "myregistry/custom-model:latest")).toBe(true);
  });

  it("treats blank and whitespace-only ids as belonging to nobody", () => {
    expect(couldBelongTo("gemini", "")).toBe(false);
    expect(couldBelongTo("gemini", "   ")).toBe(false);
    expect(couldBelongTo("ollama", "")).toBe(false);
  });
});

describe("reconcileModels", () => {
  it("returns null when both ids already fit, so no needless write happens", () => {
    expect(
      reconcileModels("gemini", { proModel: "gemini-2.5-pro", flashModel: "gemini-3-flash-preview" })
    ).toBeNull();
  });

  it("replaces only the slot that cannot belong", () => {
    const out = reconcileModels("gemini", {
      proModel: "gemini-2.5-pro",
      flashModel: "cognitivecomputations/dolphin-mistral-24b-venice-edition",
    });
    // The valid choice survives; only the foreign one is swapped.
    expect(out).toEqual({
      proModel: "gemini-2.5-pro",
      flashModel: PROVIDER_DEFAULT_MODELS.gemini.flash,
    });
  });

  it("repairs the reported state end to end", () => {
    const out = reconcileModels("gemini", {
      proModel: "cognitivecomputations/dolphin-mistral-24b-venice-edition",
      flashModel: "cognitivecomputations/dolphin-mistral-24b-venice-edition",
    });
    expect(out).toEqual({
      proModel: PROVIDER_DEFAULT_MODELS.gemini.pro,
      flashModel: PROVIDER_DEFAULT_MODELS.gemini.flash,
    });
  });

  it("gives every provider a default that belongs to its own namespace", () => {
    for (const provider of ["gemini", "openrouter", "claudeCode", "ollama"] as const) {
      const d = PROVIDER_DEFAULT_MODELS[provider];
      expect(couldBelongTo(provider, d.pro)).toBe(true);
      expect(couldBelongTo(provider, d.flash)).toBe(true);
      // A default that itself needed reconciling would loop forever.
      expect(reconcileModels(provider, { proModel: d.pro, flashModel: d.flash })).toBeNull();
    }
  });
});
