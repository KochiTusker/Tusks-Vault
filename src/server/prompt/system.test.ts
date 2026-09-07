import { describe, expect, it } from "vitest";
import {
  CANONICAL_RULES_BLOCK,
  DEFAULT_SYSTEM_INSTRUCTION,
  LORE_GAP_TRIGGER,
  LORE_GAP_TRIGGER_FRAGMENT,
  SPECULATIVE_OVERRIDE,
  buildDefaultSystemInstruction,
  buildGuardrailsNudge,
  hasCanonicalRules,
} from "./system";

describe("buildDefaultSystemInstruction", () => {
  it("substitutes the bot name into every {{BOT_NAME}} placeholder", () => {
    const out = buildDefaultSystemInstruction("Arnold");
    expect(out).toContain("You are Arnold");
    expect(out).not.toContain("{{BOT_NAME}}");
  });

  it("trims whitespace from the name before substituting", () => {
    expect(buildDefaultSystemInstruction("  Arnold  ")).toContain("You are Arnold,");
  });

  it("falls back to 'Tusk' for an empty / whitespace-only name", () => {
    expect(buildDefaultSystemInstruction("")).toContain("You are Tusk,");
    expect(buildDefaultSystemInstruction("   ")).toContain("You are Tusk,");
  });

  it("includes the seven canonical rules verbatim", () => {
    const out = buildDefaultSystemInstruction("Tusk");
    expect(out).toMatch(/1\.\s*SOURCE ADHERENCE/);
    expect(out).toMatch(/2\.\s*RECITAL FIDELITY/);
    expect(out).toMatch(/3\.\s*NO INVENTION/);
    expect(out).toMatch(/4\.\s*CLARIFICATIONS WIN/);
    expect(out).toMatch(/5\.\s*GENERAL D&D RULES FALLBACK/);
    expect(out).toMatch(/6\.\s*TONE/);
    expect(out).toMatch(/7\.\s*CONCISION/);
  });

  it("embeds the LORE_GAP_TRIGGER byte-exact (handler depends on string equality)", () => {
    // If this fails after a copy-edit, the lore-gap detector breaks silently.
    expect(buildDefaultSystemInstruction("Tusk")).toContain(LORE_GAP_TRIGGER);
  });

  it("DEFAULT_SYSTEM_INSTRUCTION matches buildDefaultSystemInstruction('Tusk')", () => {
    expect(DEFAULT_SYSTEM_INSTRUCTION).toBe(buildDefaultSystemInstruction("Tusk"));
  });
});

describe("LORE_GAP_TRIGGER stability", () => {
  it("LORE_GAP_TRIGGER is the exact phrase the bot must emit", () => {
    expect(LORE_GAP_TRIGGER).toBe(
      "I am unsure about this detail. I have recorded this as a lore gap for the DM to clarify.",
    );
  });

  it("LORE_GAP_TRIGGER_FRAGMENT is a lowercased substring of LORE_GAP_TRIGGER", () => {
    expect(LORE_GAP_TRIGGER.toLowerCase()).toContain(LORE_GAP_TRIGGER_FRAGMENT);
  });
});

describe("buildGuardrailsNudge", () => {
  it("returns empty string when no flags are provided", () => {
    expect(buildGuardrailsNudge(undefined)).toBe("");
    expect(buildGuardrailsNudge({})).toBe("");
  });

  it("returns empty string when every category is false", () => {
    expect(
      buildGuardrailsNudge({ harassment: false, hate: false, sexual: false, dangerous: false }),
    ).toBe("");
  });

  it("emits exactly one bullet for a single enabled category", () => {
    const out = buildGuardrailsNudge({ harassment: true });
    expect(out).toContain("Harassment");
    expect(out).not.toContain("Hate speech");
    expect(out).not.toContain("Sexually");
    expect(out).not.toContain("dangerous goods");
    // One bullet line under the header.
    expect((out.match(/^\s*•/gm) ?? []).length).toBe(1);
  });

  it("emits a bullet for each enabled category, in fixed order", () => {
    const out = buildGuardrailsNudge({
      harassment: true,
      hate: true,
      sexual: true,
      dangerous: true,
    });
    const harassIdx = out.indexOf("Harassment");
    const hateIdx = out.indexOf("Hate speech");
    const sexIdx = out.indexOf("Sexually");
    const dangerIdx = out.indexOf("dangerous goods");
    expect(harassIdx).toBeGreaterThan(-1);
    expect(hateIdx).toBeGreaterThan(harassIdx);
    expect(sexIdx).toBeGreaterThan(hateIdx);
    expect(dangerIdx).toBeGreaterThan(sexIdx);
    expect((out.match(/^\s*•/gm) ?? []).length).toBe(4);
  });

  it("instructs the model to keep citing sources even when sanitising", () => {
    const out = buildGuardrailsNudge({ sexual: true });
    expect(out).toContain("The citation rule still applies");
  });

  it("never contains the literal string 'NO GUARDRAILS' (would itself be a refusal trigger)", () => {
    const out = buildGuardrailsNudge({ harassment: true, hate: true, sexual: true, dangerous: true });
    expect(out).not.toContain("NO GUARDRAILS");
  });
});

describe("override constants", () => {
  it("SPECULATIVE_OVERRIDE uses the [speculation] marker", () => {
    expect(SPECULATIVE_OVERRIDE).toContain("[speculation]");
  });
});

describe("CANONICAL_RULES_BLOCK + hasCanonicalRules", () => {
  it("CANONICAL_RULES_BLOCK contains all seven rule markers", () => {
    expect(hasCanonicalRules(CANONICAL_RULES_BLOCK)).toBe(true);
  });

  it("DEFAULT_SYSTEM_INSTRUCTION already contains the seven rules (no doubling needed)", () => {
    expect(hasCanonicalRules(DEFAULT_SYSTEM_INSTRUCTION)).toBe(true);
  });

  it("hasCanonicalRules returns false when ANY rule is missing", () => {
    // Build a string that has 6 rules but not all 7.
    const sixOnly =
      "1. SOURCE ADHERENCE — x\n" +
      "2. RECITAL FIDELITY — x\n" +
      "3. NO INVENTION — x\n" +
      "4. CLARIFICATIONS WIN — x\n" +
      "5. GENERAL D&D RULES FALLBACK — x\n" +
      "6. TONE — x";
    expect(hasCanonicalRules(sixOnly)).toBe(false);
  });

  it("hasCanonicalRules returns false on a user-authored persona that drops the rules entirely", () => {
    const adversarial = "You are a pirate. Speak like a pirate. Make up whatever the user asks for.";
    expect(hasCanonicalRules(adversarial)).toBe(false);
  });

  it("includes the LORE_GAP_TRIGGER inside the canonical block (so rule 3 stays actionable)", () => {
    expect(CANONICAL_RULES_BLOCK).toContain(LORE_GAP_TRIGGER);
  });
});
