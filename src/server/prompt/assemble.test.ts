import { describe, expect, it } from "vitest";
import { buildSystemInstruction } from "./assemble";
import {
  CANONICAL_RULES_BLOCK,
  DEFAULT_SYSTEM_INSTRUCTION,
  SPECULATIVE_OVERRIDE,
  buildGuardrailsNudge,
  hasCanonicalRules,
} from "./system";

describe("buildSystemInstruction — bot name substitution", () => {
  it("replaces {{BOT_NAME}} when present in the base", () => {
    const out = buildSystemInstruction("You are {{BOT_NAME}}, archivist.", { botName: "Arnold" });
    expect(out).toContain("You are Arnold, archivist.");
    expect(out).not.toContain("{{BOT_NAME}}");
  });

  it("prepends a name-identity preamble when the base has no placeholder and no mention", () => {
    const out = buildSystemInstruction("Just answer questions.", { botName: "Arnold" });
    expect(out.startsWith("Your name is Arnold.")).toBe(true);
  });

  it("does NOT prepend the preamble when the bot name already appears in the base (case-insensitive)", () => {
    const out = buildSystemInstruction("You are arnold. Be brief.", { botName: "Arnold" });
    expect(out.startsWith("Your name is")).toBe(false);
  });
});

describe("buildSystemInstruction — overrides", () => {
  it("appends SPECULATIVE_OVERRIDE only when speculativeMode is on", () => {
    const on = buildSystemInstruction("base.", { speculativeMode: true, speculativeOverride: SPECULATIVE_OVERRIDE });
    expect(on).toContain("[speculation]");
  });

  it("appends the guardrails nudge when any category is enabled", () => {
    const nudge = buildGuardrailsNudge({ harassment: true });
    const out = buildSystemInstruction("base.", { guardrailsNudge: nudge });
    expect(out).toContain("Harassment");
  });
});

describe("buildSystemInstruction — canonical rules enforcement", () => {
  it("appends CANONICAL_RULES_BLOCK when the base is a user persona that drops the seven rules", () => {
    const persona = "You are a pirate. Speak in pirate slang. Make up history as you go.";
    const out = buildSystemInstruction(persona);
    expect(out).toContain("CORE RULES");
    expect(hasCanonicalRules(out)).toBe(true);
    // Original persona text is preserved BEFORE the canonical block.
    expect(out.indexOf("pirate slang")).toBeLessThan(out.indexOf("CORE RULES"));
  });

  it("does NOT append the canonical block when the base already contains all seven rules (no duplication)", () => {
    const out = buildSystemInstruction(DEFAULT_SYSTEM_INSTRUCTION);
    // Exactly one "1. SOURCE ADHERENCE" — the one from the base. No second copy.
    const count = (out.match(/1\.\s*SOURCE ADHERENCE/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("appends canonical block AFTER the guardrails nudge so rule 3 (verbatim trigger) wins last", () => {
    const persona = "Be helpful.";
    const out = buildSystemInstruction(persona, {
      guardrailsNudge: buildGuardrailsNudge({ harassment: true }),
    });
    const harassIdx = out.indexOf("Harassment");
    const canonicalIdx = out.indexOf("CORE RULES");
    expect(harassIdx).toBeGreaterThan(-1);
    expect(canonicalIdx).toBeGreaterThan(harassIdx);
  });

  it("appends the canonical block AFTER a silly base prompt too", () => {
    // The rules must survive any voice, including one written to be flippant.
    const out = buildSystemInstruction("Be silly.", {
      speculativeMode: true,
      speculativeOverride: SPECULATIVE_OVERRIDE,
    });
    const overrideIdx = out.indexOf("[speculation]");
    const canonicalIdx = out.indexOf("CORE RULES");
    expect(canonicalIdx).toBeGreaterThan(overrideIdx);
  });

  it("matches the CANONICAL_RULES_BLOCK constant byte-for-byte when appended", () => {
    const persona = "Just answer.";
    const out = buildSystemInstruction(persona);
    expect(out.endsWith(CANONICAL_RULES_BLOCK)).toBe(true);
  });
});
