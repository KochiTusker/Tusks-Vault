import { describe, it, expect } from "vitest";
import { sourceNamesIn, stripReferenceMarkers } from "./strip-references";

/**
 * The bug this block exists to stop recurring: "hide references" appeared to do
 * nothing at all for anyone whose lore is an Obsidian vault.
 *
 * The syntactic patterns only match a citation carrying a whitelisted file
 * extension. Asked to cite `02 - NPCs/Retainers/Alder Finch.md`, models
 * routinely write `[Alder Finch]` — and in a vault, where notes are named the
 * way people talk about them, that is the normal case rather than the
 * exception. Nothing matched, nothing was stripped, and the toggle looked dead.
 *
 * The fix matches the corpus the prompt actually carried rather than
 * broadening the syntax, which is what keeps ordinary bracketed prose safe.
 */
describe("stripReferenceMarkers with the corpus in hand", () => {
  const header = (name: string) => `[SOURCE DOCUMENT: ${name}]\nbody\n`;
  const parts = [
    {
      type: "text",
      text: [
        header("02 - NPCs/Retainers/Alder Finch.md"),
        header("04 - Locations/Westreach/Millbrook.md"),
        header("Noble Houses.docx"),
      ].join(""),
    },
  ];
  const names = sourceNamesIn(parts);

  it("reads the source list back out of the assembled prompt", () => {
    expect(names).toEqual([
      "02 - NPCs/Retainers/Alder Finch.md",
      "04 - Locations/Westreach/Millbrook.md",
      "Noble Houses.docx",
    ]);
  });

  it("strips the citation however the model shortened it", () => {
    for (const form of [
      "He serves House Dunmar [02 - NPCs/Retainers/Alder Finch.md].",
      "He serves House Dunmar [Alder Finch.md].",
      "He serves House Dunmar [Alder Finch].",
      "He serves House Dunmar [[Alder Finch]].",
    ]) {
      expect(stripReferenceMarkers(form, names)).toBe("He serves House Dunmar.");
    }
  });

  it("strips the folder path with the extension dropped", () => {
    // Observed from a live model: it keeps the folders, which disambiguate,
    // and drops the extension, which does not.
    expect(
      stripReferenceMarkers("They watch the walls [02 - NPCs/Retainers/Alder Finch].", names)
    ).toBe("They watch the walls.");
  });

  it("strips a bare note name, which no extension rule can catch", () => {
    expect(stripReferenceMarkers("Millbrook sits in Westreach [Millbrook].", names)).toBe(
      "Millbrook sits in Westreach."
    );
  });

  it("leaves bracketed prose alone, because it names no loaded document", () => {
    // The whole reason for matching the corpus rather than the syntax.
    const prose = "The party split [the rogue went east] and regrouped [later].";
    expect(stripReferenceMarkers(prose, names)).toBe(prose);
  });

  it("still strips the syntactic markers when no corpus is supplied", () => {
    expect(stripReferenceMarkers("Ruled so [clarification: x].")).toBe("Ruled so.");
  });

  // Mapped mode is the default for a vault of any size: every note appears as
  // one line in a VAULT MAP block, and only the few most relevant are
  // reproduced under a SOURCE DOCUMENT header. The model reads the whole map
  // and cites from it, so harvesting only the headers left most citations
  // untouched — which is what a real vault actually hit.
  it("harvests notes listed in the vault map, not only those reproduced in full", () => {
    const mapped = sourceNamesIn([
      {
        type: "text",
        text: [
          "### VAULT MAP",
          "",
          "- 04 - Locations/Westreach/Millbrook.md [location] — A humble town where the party first met.",
          "- 02 - NPCs/Dockmaster.md [npc] — Keeps the tide-ledger. (aka The Tidewarden, Old Bramble)",
          "",
        ].join("\n"),
      },
    ]);

    expect(mapped).toContain("04 - Locations/Westreach/Millbrook.md");
    expect(mapped).toContain("02 - NPCs/Dockmaster.md");
    // The vault's own other names for a note are real citations too.
    expect(mapped).toContain("The Tidewarden");
    expect(mapped).toContain("Old Bramble");

    expect(stripReferenceMarkers("They met in Millbrook [Millbrook].", mapped)).toBe(
      "They met in Millbrook."
    );
    expect(stripReferenceMarkers("He keeps the ledger [The Tidewarden].", mapped)).toBe(
      "He keeps the ledger."
    );
  });

  it("prefers the longest form, so a prefix cannot half-eat a citation", () => {
    const both = sourceNamesIn([
      { type: "text", text: header("Session 01.md") + header("Session 01 - The Crossing.md") },
    ]);
    expect(stripReferenceMarkers("It began there [Session 01 - The Crossing].", both)).toBe(
      "It began there."
    );
  });
});

describe("stripReferenceMarkers", () => {
  it("removes single filename citation at end of sentence", () => {
    expect(stripReferenceMarkers("He fled the city [chronicle.md].")).toBe("He fled the city.");
  });

  it("removes multiple filename citations within one sentence", () => {
    const input = "He fled the city [chronicle.md] and arrived in the south [history.md] later [diary.txt].";
    expect(stripReferenceMarkers(input)).toBe("He fled the city and arrived in the south later.");
  });

  it("removes clarification citations with various id shapes", () => {
    expect(stripReferenceMarkers("The dragon is gold [clarification: cl-123].")).toBe(
      "The dragon is gold."
    );
    expect(stripReferenceMarkers("It was Tuesday [clarification: 9f3a-uuid-2024].")).toBe(
      "It was Tuesday."
    );
  });

  it("removes the [D&D 5e] rules-fallback marker, including spacing variants", () => {
    expect(stripReferenceMarkers("Counterspell uses a reaction [D&D 5e].")).toBe(
      "Counterspell uses a reaction."
    );
    expect(stripReferenceMarkers("Trip attack [D&D5e]. Then proceed.")).toBe(
      "Trip attack. Then proceed."
    );
    expect(stripReferenceMarkers("Heal [D & D 5e].")).toBe("Heal.");
  });

  it("removes [speculation] and [sanitised per active guardrails] markers", () => {
    expect(stripReferenceMarkers("Probably the cleric [speculation].")).toBe("Probably the cleric.");
    expect(stripReferenceMarkers("The scene continued [sanitised per active guardrails].")).toBe(
      "The scene continued."
    );
  });

  it("handles a wide range of file extensions", () => {
    for (const ext of ["md", "markdown", "txt", "json", "html", "htm", "pdf", "doc", "docx", "csv", "tsv", "yaml", "yml", "rtf", "odt"]) {
      const input = `Claim [file.${ext}].`;
      expect(stripReferenceMarkers(input)).toBe("Claim.");
    }
  });

  it("preserves generic stage directions and non-citation bracketed prose", () => {
    // Personas may emit stage directions; those must survive.
    const input = "*[chuckles darkly]* The vault holds many secrets [chronicle.md].";
    expect(stripReferenceMarkers(input)).toBe("*[chuckles darkly]* The vault holds many secrets.");
  });

  it("does not strip brackets without a known extension or keyword", () => {
    // "[OOC]" and "[loremaster note]" must pass through.
    const input = "[OOC] just a quick note [loremaster note] before the scene.";
    expect(stripReferenceMarkers(input)).toBe(input);
  });

  it("collapses double spaces left behind by mid-sentence stripping", () => {
    const input = "She was [chronicle.md] cunning [chronicle.md] and quick.";
    expect(stripReferenceMarkers(input)).toBe("She was cunning and quick.");
  });

  it("handles citations with no leading space", () => {
    expect(stripReferenceMarkers("He fled[chronicle.md].")).toBe("He fled.");
    expect(stripReferenceMarkers("[chronicle.md]At the start.")).toBe("At the start.");
  });

  it("preserves block structure (newlines and paragraphs)", () => {
    const input = "Line one [chronicle.md].\n\nLine two [history.md].\n\nLine three.";
    expect(stripReferenceMarkers(input)).toBe("Line one.\n\nLine two.\n\nLine three.");
  });

  it("trims trailing whitespace per line but preserves leading indent", () => {
    const input = "  Indented line [chronicle.md]   \n  Next line [history.md]   ";
    expect(stripReferenceMarkers(input)).toBe("  Indented line\n  Next line");
  });

  it("returns empty/falsy input unchanged", () => {
    expect(stripReferenceMarkers("")).toBe("");
  });

  it("is idempotent — running twice produces the same result", () => {
    const input = "Two citations [chronicle.md] in [clarification: x-1] one sentence.";
    const once = stripReferenceMarkers(input);
    const twice = stripReferenceMarkers(once);
    expect(twice).toBe(once);
  });

  it("handles a paragraph of mixed marker types", () => {
    const input = [
      "The Vault was sealed by Thorne [chronicle.md] in the third age [history.md].",
      "DM clarification confirms this: it was a Tuesday [clarification: cl-42].",
      "Counterspell would not have helped [D&D 5e].",
      "Most likely the rogue did it [speculation].",
      "The duel ended badly [sanitised per active guardrails].",
    ].join("\n");
    const expected = [
      "The Vault was sealed by Thorne in the third age.",
      "DM clarification confirms this: it was a Tuesday.",
      "Counterspell would not have helped.",
      "Most likely the rogue did it.",
      "The duel ended badly.",
    ].join("\n");
    expect(stripReferenceMarkers(input)).toBe(expected);
  });
});
