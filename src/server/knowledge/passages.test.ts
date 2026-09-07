import { describe, expect, it } from "vitest";
import { PASSAGE_CAP, extractPassages } from "./passages";
import { buildSurfaceIndex } from "./surface-index";
import type { LoreUnit } from "./units";

function unit(id: string, title: string, aliases: string[] = []): LoreUnit {
  return {
    id,
    title,
    file: id,
    start: 0,
    end: 0,
    aliases,
    relations: [],
    depth: 0,
    hash: "h",
    chars: 0,
  };
}

const index = buildSurfaceIndex([
  unit("people/marren.md", "Marren Koll", ["the Ledgerman"]),
  unit("people/tovin.md", "Tovin Ashe"),
  unit("places/ivory-gate.md", "The Ivory Gate"),
]);

/** Filter by SUBJECT, the way the planner does — the caller knows which unit
 *  it is asking about, not which of that unit's names the corpus used. */
const marren = new Set(["people/marren.md"]);
const tovin = new Set(["people/tovin.md"]);

describe("extractPassages", () => {
  const text = [
    "# Opening",
    "The council met at dawn and argued about grain.",
    "",
    "Nothing of consequence was decided.",
    "",
    "# The Argument",
    "Marren Koll spoke against the levy.",
    "",
    "A vote was taken and lost.",
  ].join("\n");

  it("returns the paragraph around the mention, not the document", () => {
    // The whole point: 6x cheaper than including the unit.
    const [p] = extractPassages(text, index, { subjects: marren });
    expect(p.text).toBe("Marren Koll spoke against the levy.");
    expect(p.text).not.toContain("grain");
  });

  it("tags the passage with the heading in force above it", () => {
    const [p] = extractPassages(text, index, { subjects: marren });
    expect(p.heading).toBe("The Argument");
  });

  it("returns offsets that slice back to the passage", () => {
    const [p] = extractPassages(text, index, { subjects: marren });
    expect(text.slice(p.start, p.end).trim()).toBe(p.text);
  });

  it("returns nothing when the requested name is absent", () => {
    expect(extractPassages(text, index, { subjects: tovin })).toEqual([]);
  });

  it("finds a name written as an alias", () => {
    const aliased = "# Report\nThe Ledgerman refused to sign.";
    const [p] = extractPassages(aliased, index, { subjects: marren });
    expect(p.text).toContain("Ledgerman");
  });

  it("matches a possessive form of the name", () => {
    const possessive = "# Report\nMarren Koll's ledger was missing.";
    expect(extractPassages(possessive, index, { subjects: marren })).toHaveLength(1);
  });
});

describe("extractPassages — merging and bounds", () => {
  it("merges consecutive mentioning paragraphs into one passage", () => {
    // Two adjacent paragraphs are one piece of evidence; splitting them
    // doubles the per-passage overhead for nothing.
    const text = "Marren Koll arrived.\n\nMarren Koll left again.\n\nUnrelated line.";
    const passages = extractPassages(text, index, { subjects: marren });
    expect(passages).toHaveLength(1);
    expect(passages[0].text).toContain("arrived");
    expect(passages[0].text).toContain("left again");
    expect(passages[0].text).not.toContain("Unrelated");
  });

  it("keeps separate mentions separate when they are not adjacent", () => {
    const text = "Marren Koll arrived.\n\nSomething else entirely.\n\nMarren Koll left.";
    expect(extractPassages(text, index, { subjects: marren })).toHaveLength(2);
  });

  it("caps a runaway paragraph", () => {
    const text = `Marren Koll ${"and more text ".repeat(500)}`;
    const [p] = extractPassages(text, index, { subjects: marren });
    expect(p.text.length).toBeLessThanOrEqual(PASSAGE_CAP);
  });

  it("honours the per-unit passage limit", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Marren Koll did thing ${i}.`).join("\n\n");
    expect(extractPassages(text, index, { subjects: marren, limit: 3 })).toHaveLength(3);
  });

  it("does not collapse a long run of mentions into one truncated passage", () => {
    // Unbounded merging would fold every paragraph into a single passage that
    // the length cap then cuts, discarding the rest without saying so. The
    // last mention must still be reachable.
    const text = Array.from({ length: 12 }, (_, i) => `Marren Koll did thing ${i}.`).join("\n\n");
    const passages = extractPassages(text, index, { subjects: marren, limit: 10 });
    expect(passages.length).toBeGreaterThan(1);
    expect(passages.map(p => p.text).join(" ")).toContain("thing 11");
  });

  it("does not quote a passage under a heading it does not belong to", () => {
    // Reaching back for context must not cross a section boundary: the
    // heading line would land inside the quoted text and attribute it wrongly.
    const text = "# Trade\nA long paragraph about the grain levy and its discontents.\n\n# Attendance\nMarren Koll.";
    const [p] = extractPassages(text, index, { subjects: marren });
    expect(p.heading).toBe("Attendance");
    expect(p.text).not.toContain("grain levy");
    expect(p.text).not.toContain("#");
  });

  it("reaches back a paragraph when the match line is too short to stand alone", () => {
    // A line of dialogue attributed on the line before it means nothing on
    // its own.
    const text = "The steward read the charge aloud to the assembled council.\n\nMarren Koll.";
    const [p] = extractPassages(text, index, { subjects: marren });
    expect(p.text).toContain("steward");
  });
});

describe("extractPassages — relationship signal", () => {
  it("counts how many known names share the passage", () => {
    // Passages naming several subjects are where relationships get stated,
    // so the planner ranks them up.
    const text = "Marren Koll and Tovin Ashe met at the Ivory Gate.";
    const [p] = extractPassages(text, index, { subjects: marren });
    expect(p.formsPresent).toBe(3);
  });

  it("returns every named subject's passages when no filter is given", () => {
    const text = "Marren Koll waited.\n\nSomething neutral.\n\nTovin Ashe waited too.";
    expect(extractPassages(text, index)).toHaveLength(2);
  });
});
