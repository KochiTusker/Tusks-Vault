import { describe, expect, it } from "vitest";
import { sectionDocument } from "../knowledge/units";
import { fieldHeadings, planForge } from "./plan";

/** Two character write-ups in the shape a campaign folder actually uses: a
 *  title, then the same handful of fields under each. */
const primer = (name: string) =>
  `# ${name}\n\nA one-line framing of ${name}.\n\n` +
  `## Background\n\nWhere ${name} came from.\n\n` +
  `## Roleplay Questions\n\nWhat does ${name} want?\n`;

const unitsFor = (docs: Record<string, string>) =>
  Object.entries(docs).flatMap(([file, text]) => sectionDocument(file, text));

describe("telling a form field from a topic", () => {
  it("calls a heading that repeats across documents a field", () => {
    const fields = fieldHeadings(unitsFor({ "a.md": primer("One"), "b.md": primer("Two") }));
    expect(fields.has("roleplay questions")).toBe(true);
    expect(fields.has("background")).toBe(true);
  });

  it("leaves a heading that appears in one document alone", () => {
    // A topic discussed once is a topic. The repeat rule is the whole signal;
    // without this the forge would fold genuine subjects into their neighbour.
    const fields = fieldHeadings(
      unitsFor({ "world.md": "## The Long Winter\n\nIt was cold.\n\n## The Thaw\n\nThen it was not.\n" })
    );
    expect(fields.has("the long winter")).toBe(false);
    expect(fields.has("the thaw")).toBe(false);
  });

  it("still catches an obvious field in a corpus of one document", () => {
    const fields = fieldHeadings(
      unitsFor({ "solo.md": "# Someone\n\nFraming.\n\n## Background\n\nX\n\n## Secrets\n\nY\n" })
    );
    expect(fields.has("background")).toBe(true);
    expect(fields.has("secrets")).toBe(true);
  });

  it("never treats a whole document as a field of itself", () => {
    // Depth 0 is the document or its preamble. Two documents with the same
    // stem would otherwise mark that stem a field and fold both away.
    const fields = fieldHeadings([
      ...sectionDocument("one/Notes.md", "Body text with no headings at all.\n"),
      ...sectionDocument("two/Notes.md", "Different body, also headingless.\n"),
    ]);
    expect(fields.size).toBe(0);
  });
});

describe("planning notes from documents that share a template", () => {
  const plan = planForge(unitsFor({ "One.md": primer("One"), "Two.md": primer("Two") }));
  const paths = plan.notes.map(n => n.relPath);

  it("makes one note per subject, not one per field", () => {
    // The bug this replaces: seven character write-ups produced seven notes
    // called "Roleplay Questions", numbered (2) to (7), and no note for any
    // of the seven characters.
    expect(plan.notes).toHaveLength(2);
  });

  it("names them after the documents rather than after the fields", () => {
    expect(paths.some(p => p.endsWith("/One.md"))).toBe(true);
    expect(paths.some(p => p.endsWith("/Two.md"))).toBe(true);
    expect(paths.some(p => /Roleplay Questions/.test(p))).toBe(false);
    expect(paths.some(p => /Background/.test(p))).toBe(false);
  });

  it("never emits a numbered duplicate", () => {
    // `(2)` discards the only thing that distinguished the two notes — whose
    // questions they were. A suffix like that is data loss wearing a filename.
    expect(paths.some(p => /\(\d+\)\.md$/.test(p))).toBe(false);
  });

  it("keeps every unit's text, attached to its subject", () => {
    const all = unitsFor({ "One.md": primer("One"), "Two.md": primer("Two") });
    const placed = new Set(plan.notes.flatMap(n => n.unitIds));
    for (const u of all) expect(placed.has(u.id)).toBe(true);
  });

  it("carries the heading through so the fields stay legible in the note", () => {
    const one = plan.notes.find(n => n.relPath.endsWith("/One.md"))!;
    const headings = one.segments.map(s => s.heading).filter(Boolean);
    expect(headings).toEqual(["Background", "Roleplay Questions"]);
  });

  it("attaches each field to its own document's subject", () => {
    // Folding is per document. A field from One must never land on Two.
    for (const note of plan.notes) {
      const stem = note.relPath.split("/").pop()!.replace(/\.md$/, "");
      for (const id of note.unitIds) expect(id.startsWith(`${stem}.md`)).toBe(true);
    }
  });
});

describe("planning notes from a document that is a list of subjects", () => {
  // The other common shape: one document, many subjects, each a heading.
  // These must keep becoming one note each.
  const doc =
    "# The Pantheon\n\nFraming.\n\n## Aster\n\nGod of one thing.\n\n## Brine\n\nGod of another.\n";
  const plan = planForge(unitsFor({ "Deities.md": doc }));

  it("gives every subject its own note", () => {
    const titles = plan.notes.map(n => n.title);
    expect(titles).toContain("Aster");
    expect(titles).toContain("Brine");
  });

  it("keeps the document's framing rather than dropping it", () => {
    expect(plan.notes.map(n => n.title)).toContain("Deities");
  });

  it("types them from the document name", () => {
    const aster = plan.notes.find(n => n.title === "Aster")!;
    expect(aster.type).toBe("deity");
    expect(aster.typeSource).toBe("document");
  });
});

describe("a document that opens straight into a field", () => {
  const plan = planForge(
    unitsFor({
      "Someone.md": "## Background\n\nX\n\n## Secrets\n\nY\n",
      "Else.md": "## Background\n\nZ\n\n## Secrets\n\nW\n",
    })
  );

  it("uses the document as the subject when no heading above it can be", () => {
    // There is no framing paragraph to become the parent, but the document is
    // still about something, and its name is the best statement of what.
    expect(plan.notes.map(n => n.title).sort()).toEqual(["Else", "Someone"]);
  });

  it("loses nothing on the way", () => {
    expect(plan.notes.flatMap(n => n.unitIds)).toHaveLength(4);
  });
});

describe("what the planner still guarantees", () => {
  it("reports units it was told to skip rather than dropping them quietly", () => {
    const plan = planForge(unitsFor({ "s.md": "## A\n\nx\n\n## B\n\ny\n" }), {
      skip: u => (u.title === "A" ? "held back" : null),
    });
    expect(plan.skipped.map(s => s.reason)).toContain("held back");
  });

  it("counts the notes nobody could type as the review queue", () => {
    const plan = planForge(unitsFor({ "Untyped.md": "Some prose with no headings.\n" }));
    expect(plan.needsDecision).toBe(plan.notes.filter(n => n.typeSource === "unknown").length);
    expect(plan.needsDecision).toBe(1);
  });

  it("still suffixes a genuine filename clash between different subjects", () => {
    // Folding removed the numbered duplicates that came from fields. Two
    // documents can still name a real subject the same thing, and losing one
    // to the other silently is the failure the suffix exists to prevent.
    const plan = planForge(
      unitsFor({
        "a.md": "## Harbour\n\nOne harbour.\n\n## Elsewhere\n\nx\n",
        "b.md": "## Harbour\n\nA different harbour.\n\n## Other\n\ny\n",
      })
    );
    // "Harbour" repeats, so it folds — but the fold must not lose either.
    const bodies = plan.notes.flatMap(n => n.unitIds);
    expect(bodies).toHaveLength(4);
    expect(new Set(plan.notes.map(n => n.relPath)).size).toBe(plan.notes.length);
  });
});
