import { describe, it, expect } from "vitest";
import { SIGNATURES, runSignatures, type DiagnoseState } from "./signatures";

// Every signature gets a positive AND a negative fixture — a matcher that
// can't be shown NOT to fire is noise, not a signature.
function cleanState(): DiagnoseState {
  return {
    clarifications: [
      { id: "a", embedded: true },
      { id: "b", embedded: true },
    ],
    lore: { resolution: "sibling", loreRootExists: true, defaultSiblingExists: true, documentCount: 12 },
    keyTests: [{ label: "main", provider: "gemini", ok: true }],
    nodeModulesStale: false,
    modelReachability: { proModel: "m-pro", flashModel: "m-flash", listed: ["m-pro", "m-flash"] },
    botStatus: "Online",
    discordTokenConfigured: true,
  };
}

describe("signatures — the clean state fires nothing", () => {
  it("runSignatures returns [] on a healthy install", () => {
    expect(runSignatures(cleanState())).toEqual([]);
  });
});

describe("each signature fires on its condition", () => {
  it("clarifications_unembedded", () => {
    const s = cleanState();
    s.clarifications[1] = { id: "b", embedded: false };
    const hits = runSignatures(s).map(f => f.id);
    expect(hits).toContain("clarifications_unembedded");
  });

  it("lore_fallback_with_sibling_present — only when BOTH conditions hold", () => {
    const s = cleanState();
    s.lore.resolution = "fallback";
    s.lore.defaultSiblingExists = true;
    expect(runSignatures(s).map(f => f.id)).toContain("lore_fallback_with_sibling_present");
    // Fallback WITHOUT a sibling is a normal fresh install, not a finding.
    s.lore.defaultSiblingExists = false;
    expect(runSignatures(s).map(f => f.id)).not.toContain("lore_fallback_with_sibling_present");
  });

  it("lore_root_missing", () => {
    const s = cleanState();
    s.lore.loreRootExists = false;
    expect(runSignatures(s).map(f => f.id)).toContain("lore_root_missing");
  });

  it("empty_knowledge_base — but not when the root itself is missing (that finding owns it)", () => {
    const s = cleanState();
    s.lore.documentCount = 0;
    expect(runSignatures(s).map(f => f.id)).toContain("empty_knowledge_base");
    s.lore.loreRootExists = false;
    expect(runSignatures(s).map(f => f.id)).not.toContain("empty_knowledge_base");
  });

  it("stored_key_rejected names the key and its error", () => {
    const s = cleanState();
    s.keyTests = [{ label: "Paid", provider: "gemini", ok: false, error: "API key not valid" }];
    const hit = runSignatures(s).find(f => f.id === "stored_key_rejected");
    expect(hit?.detail).toContain('"Paid"');
    expect(hit?.detail).toContain("API key not valid");
  });

  it("node_modules_stale", () => {
    const s = cleanState();
    s.nodeModulesStale = true;
    expect(runSignatures(s).map(f => f.id)).toContain("node_modules_stale");
  });

  it("configured_model_unlisted — silent when the list is unknown", () => {
    const s = cleanState();
    s.modelReachability = { proModel: "gone-model", flashModel: "m-flash", listed: ["m-flash"] };
    expect(runSignatures(s).map(f => f.id)).toContain("configured_model_unlisted");
    // null list = provider not probed — unknown must not read as broken.
    s.modelReachability.listed = null;
    expect(runSignatures(s).map(f => f.id)).not.toContain("configured_model_unlisted");
  });

  it("discord_configured_but_offline", () => {
    const s = cleanState();
    s.botStatus = "Disconnected";
    expect(runSignatures(s).map(f => f.id)).toContain("discord_configured_but_offline");
    // No token = expected offline, not a finding.
    s.discordTokenConfigured = false;
    expect(runSignatures(s).map(f => f.id)).not.toContain("discord_configured_but_offline");
  });
});

describe("registry hygiene", () => {
  it("ids are unique and kebab/snake stable", () => {
    const ids = SIGNATURES.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+$/);
  });
});
