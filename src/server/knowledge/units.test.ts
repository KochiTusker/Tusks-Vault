import { describe, expect, it } from "vitest";
import {
  MAX_UNIT_CHARS,
  cleanHeading,
  documentStem,
  organisingLevel,
  sectionDocument,
  unitFromNote,
} from "./units";

/** Round-tripping offsets is the property everything downstream depends on:
 *  the index stores ranges, not bodies, so a wrong offset silently retrieves
 *  the wrong passage rather than failing. */
function slice(text: string, u: { start: number; end: number }): string {
  return text.slice(u.start, u.end);
}

describe("cleanHeading", () => {
  it("reduces a decorated heading to a name", () => {
    expect(cleanHeading("**The Warden** *(the keeper)*")).toBe("The Warden (the keeper)");
    expect(cleanHeading("`Codex Entry`")).toBe("Codex Entry");
    expect(cleanHeading("[[Places/Harbour Town|the harbour]]")).toBe("the harbour");
    expect(cleanHeading("[A Link](http://example.invalid)")).toBe("A Link");
  });

  it("drops trailing closing hashes and collapses whitespace", () => {
    expect(cleanHeading("A   Name")).toBe("A Name");
  });
});

describe("organisingLevel", () => {
  it("is the level a document actually uses per subject", () => {
    const flat = "# One\nbody\n\n# Two\nbody\n";
    expect(organisingLevel(flat)).toBe(1);
  });

  it("skips a lone title to find the repeating level", () => {
    // The case that makes this more than "shallowest heading": cutting at `#`
    // here would produce one unit holding the entire document.
    const titled = "# Document\nintro\n\n## One\nbody\n\n## Two\nbody\n";
    expect(organisingLevel(titled)).toBe(2);
  });

  it("falls back to the shallowest level when nothing repeats", () => {
    expect(organisingLevel("## Only\nbody\n")).toBe(2);
  });

  it("reports 0 for a document with no headings", () => {
    expect(organisingLevel("just prose, no headings at all")).toBe(0);
  });
});

describe("sectionDocument", () => {
  it("splits a reference document into one unit per heading", () => {
    const text = "# Alpha\nfirst body\n\n# Beta\nsecond body\n";
    const units = sectionDocument("Reference.md", text);
    expect(units.map(u => u.title)).toEqual(["Alpha", "Beta"]);
    expect(units.map(u => u.id)).toEqual(["Reference.md#Alpha", "Reference.md#Beta"]);
    expect(slice(text, units[0])).toContain("first body");
    expect(slice(text, units[0])).not.toContain("second body");
    expect(slice(text, units[1])).toContain("second body");
  });

  it("keeps every unit pointing at the source file for citation", () => {
    const units = sectionDocument("Reference.md", "# Alpha\nbody\n\n# Beta\nbody\n");
    expect(units.every(u => u.file === "Reference.md")).toBe(true);
  });

  it("keeps the preamble before the first heading", () => {
    // It usually holds the document's framing. Dropping it would lose content
    // no heading claims, which is the failure this module replaces.
    const text = "# Document\nframing sentence\n\n## Alpha\nbody\n\n## Beta\nbody\n";
    const units = sectionDocument("Doc.md", text);
    expect(units[0].title).toBe("Doc");
    expect(slice(text, units[0])).toContain("framing sentence");
    expect(units.slice(1).map(u => u.title)).toEqual(["Alpha", "Beta"]);
  });

  it("does not invent a preamble unit when there is no preamble", () => {
    const units = sectionDocument("Doc.md", "# Alpha\nbody\n\n# Beta\nbody\n");
    expect(units).toHaveLength(2);
  });

  it("emits a single whole-file unit for a document with no headings", () => {
    const units = sectionDocument("Plain.md", "prose with no headings whatsoever");
    expect(units).toHaveLength(1);
    expect(units[0].id).toBe("Plain.md");
    expect(units[0].depth).toBe(0);
  });

  it("returns nothing for an empty document", () => {
    expect(sectionDocument("Empty.md", "   \n\n  ")).toEqual([]);
  });

  it("skips a heading with no body under it", () => {
    const units = sectionDocument("Doc.md", "# Alpha\n\n# Beta\nreal body\n");
    expect(units.map(u => u.title)).toEqual(["Beta"]);
  });

  it("disambiguates repeated heading text instead of losing one", () => {
    const units = sectionDocument("Doc.md", "# Same\nfirst\n\n# Same\nsecond\n");
    expect(units).toHaveLength(2);
    expect(new Set(units.map(u => u.id)).size).toBe(2);
  });

  it("covers the document contiguously", () => {
    // No gap between sections means no passage can fall between two units and
    // become unretrievable.
    const text = "# Alpha\nbody one\n\n# Beta\nbody two\n\n# Gamma\nbody three\n";
    const units = sectionDocument("Doc.md", text);
    for (let i = 1; i < units.length; i++) {
      expect(units[i].start).toBeGreaterThanOrEqual(units[i - 1].end - 1);
    }
    expect(units[units.length - 1].end).toBe(text.length);
  });
});

describe("sectionDocument — oversized sections", () => {
  const huge = `# Long\n${"a paragraph of text.\n\n".repeat(4000)}`;

  it("splits a section that would otherwise blow any budget", () => {
    const units = sectionDocument("Log.md", huge);
    expect(units.length).toBeGreaterThan(1);
    expect(units.every(u => u.chars <= MAX_UNIT_CHARS)).toBe(true);
  });

  it("labels the parts so a citation still finds them", () => {
    const units = sectionDocument("Log.md", huge);
    expect(units[0].title).toMatch(/^Long \(part 1 of \d+\)$/);
  });

  it("splits on a paragraph boundary, not mid-sentence", () => {
    const units = sectionDocument("Log.md", huge);
    for (const u of units.slice(0, -1)) {
      expect(huge.slice(u.end - 2, u.end)).toBe("\n\n");
    }
  });

  it("still covers the whole section", () => {
    const units = sectionDocument("Log.md", huge);
    expect(units[0].start).toBe(units[0].start);
    expect(units[units.length - 1].end).toBe(huge.length);
    const rejoined = units.map(u => slice(huge, u)).join("");
    expect(rejoined).toBe(huge.slice(units[0].start));
  });

  it("does not leave a one-line scrap as its own unit", () => {
    const text = `# Long\n${"x".repeat(MAX_UNIT_CHARS + 50)}`;
    const units = sectionDocument("Log.md", text);
    expect(units).toHaveLength(1);
  });
});

describe("unitFromNote", () => {
  const note = {
    title: "A Subject",
    type: "npc",
    aliases: ["the epithet"],
    relations: [{ key: "affiliations", targets: ["A Faction"] }],
    body: "## Description\nsome prose\n\n## Relationships\nmore prose",
  };

  it("makes one unit per note, not one per internal heading", () => {
    // A note's `##` headings are its internal structure, not separate
    // subjects. Cutting there would scatter one subject across several units
    // and make each a worse match than the whole note.
    const u = unitFromNote("People/A Subject.md", note);
    expect(u).not.toBeNull();
    expect(u!.id).toBe("People/A Subject.md");
    expect(u!.chars).toBe(note.body.length);
  });

  it("carries the declared type, aliases and relations through", () => {
    const u = unitFromNote("People/A Subject.md", note)!;
    expect(u.type).toBe("npc");
    expect(u.aliases).toEqual(["the epithet"]);
    expect(u.relations[0].targets).toEqual(["A Faction"]);
  });

  it("returns null for an empty note", () => {
    expect(unitFromNote("Empty.md", { ...note, body: "  \n " })).toBeNull();
  });
});

describe("hashing", () => {
  it("is stable for unchanged text and changes with it", () => {
    const a = sectionDocument("Doc.md", "# Alpha\nbody\n");
    const b = sectionDocument("Doc.md", "# Alpha\nbody\n");
    const c = sectionDocument("Doc.md", "# Alpha\nbody edited\n");
    expect(a[0].hash).toBe(b[0].hash);
    expect(a[0].hash).not.toBe(c[0].hash);
  });
});

describe("unit ids are unique", () => {
  it("gives every part of a heading-less oversized document its own id", () => {
    // Regression: the id was decided per section, so a document with no
    // headings — one section, several oversized parts — handed every part the
    // bare file path. The index keys by id, so all but one silently vanished.
    const text = "a paragraph of prose.\n\n".repeat(6000);
    const units = sectionDocument("Transcript.docx", text);
    expect(units.length).toBeGreaterThan(1);
    expect(new Set(units.map(u => u.id)).size).toBe(units.length);
  });

  it("still uses the bare file path when the document is one unit", () => {
    const units = sectionDocument("Short.md", "a short document with no headings");
    expect(units).toHaveLength(1);
    expect(units[0].id).toBe("Short.md");
  });

  it("gives every unit of a sectioned document a distinct id", () => {
    const text = `# Alpha\n${"x".repeat(30_000)}\n\n# Beta\nshort\n`;
    const units = sectionDocument("Doc.md", text);
    expect(new Set(units.map(u => u.id)).size).toBe(units.length);
  });
});

describe("documentStem", () => {
  it("names a document the way a person would", () => {
    // The stem becomes a surface form. A full path would tokenise into words
    // nobody would ever type into a question.
    expect(documentStem("Sessions/Campaign/Session One.docx")).toBe("Session One");
    expect(documentStem("Notes.md")).toBe("Notes");
    expect(documentStem("no-extension")).toBe("no-extension");
  });
});

describe("split sections stay reassemblable", () => {
  const huge = `# Chronicle\n${"a paragraph of text.\n\n".repeat(4000)}`;

  it("marks every part with the section it came from", () => {
    // Without this, anything rebuilding the source has to parse "(part 2 of
    // 7)" out of a title — and the vault forge turned one long chapter into
    // seven notes all named after it.
    const units = sectionDocument("Log.md", huge);
    expect(units.length).toBeGreaterThan(1);
    expect(new Set(units.map(u => u.partOf)).size).toBe(1);
    expect(units.map(u => u.partIndex)).toEqual(units.map((_, i) => i + 1));
  });

  it("leaves an unsplit unit unmarked", () => {
    const units = sectionDocument("Doc.md", "# Alpha\nshort body\n");
    expect(units[0].partOf).toBeUndefined();
    expect(units[0].partIndex).toBeUndefined();
  });

  it("groups parts of different sections separately", () => {
    const two = `# One\n${"x ".repeat(15_000)}\n\n# Two\n${"y ".repeat(15_000)}`;
    const units = sectionDocument("Doc.md", two);
    const groups = new Set(units.filter(u => u.partOf).map(u => u.partOf));
    expect(groups.size).toBe(2);
  });

  it("reassembles to the original section text in order", () => {
    const units = sectionDocument("Log.md", huge).sort((a, b) => a.partIndex! - b.partIndex!);
    const rejoined = units.map(u => huge.slice(u.start, u.end)).join("");
    expect(rejoined).toBe(huge.slice(units[0].start));
  });
});
