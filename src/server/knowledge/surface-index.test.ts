import { describe, expect, it } from "vitest";
import type { LoreUnit } from "./units";
import {
  buildSurfaceIndex,
  formsOf,
  normaliseForm,
  resolveQuestion,
  scanForms,
  tokenize,
} from "./surface-index";

function unit(id: string, title: string, extra: Partial<LoreUnit> = {}): LoreUnit {
  return {
    id,
    title,
    file: id.split("#")[0],
    start: 0,
    end: 0,
    aliases: [],
    relations: [],
    depth: 0,
    hash: "h",
    chars: 0,
    ...extra,
  };
}

describe("tokenize", () => {
  it("folds possessives so ownership still matches the owner", () => {
    // The corpus writes about what a subject has; the question asks about the
    // subject. Treating those as different strings loses most family and
    // ownership mentions, which is the kind of link this retrieval follows.
    expect(tokenize("Marren's ledger").map(t => t.text)).toEqual(["marren", "ledger"]);
    expect(tokenize("the Wardens' hall").map(t => t.text)).toEqual(["the", "wardens", "hall"]);
  });

  it("handles typographic apostrophes the same as straight ones", () => {
    expect(tokenize("Marren’s ledger").map(t => t.text)).toEqual(["marren", "ledger"]);
  });

  it("keeps offsets pointing at the original text", () => {
    const text = "the Ivory Gate stands";
    const tokens = tokenize(text);
    expect(text.slice(tokens[1].start, tokens[1].end)).toBe("Ivory");
  });

  it("keeps hyphenated and accented names whole", () => {
    expect(tokenize("Ash-Maren Ólafur").map(t => t.text)).toEqual(["ash-maren", "ólafur"]);
  });
});

describe("formsOf", () => {
  it("indexes the title and every alias", () => {
    const u = unit("a.md", "Marren Koll", { aliases: ["the Ledgerman", "Kollward"] });
    expect(formsOf(u)).toEqual(["marren koll", "the ledgerman", "kollward"]);
  });

  it("refuses structural headings that name a section, not a subject", () => {
    // A "History" heading under every country would otherwise resolve every
    // question containing the word to a scattering of unrelated units.
    expect(formsOf(unit("a.md", "History"))).toEqual([]);
    expect(formsOf(unit("a.md", "Relationships"))).toEqual([]);
  });

  it("refuses forms too short to mean anything", () => {
    expect(formsOf(unit("a.md", "Ash"))).toEqual([]);
  });

  it("refuses purely numeric headings", () => {
    expect(formsOf(unit("a.md", "1247"))).toEqual([]);
  });
});

describe("scanForms — longest match wins", () => {
  const index = buildSurfaceIndex([
    unit("people/marren.md", "Marren Koll"),
    unit("families/koll.md", "Koll"),
    unit("places/ivory-gate.md", "The Ivory Gate"),
  ]);

  it("prefers the full name over the family name inside it", () => {
    // The failure this prevents: a question about a person resolving to their
    // family and never reaching them.
    const hits = scanForms(index, "tell me about Marren Koll");
    expect(hits).toHaveLength(1);
    expect(hits[0].form).toBe("marren koll");
    expect(hits[0].entry.unitIds).toEqual(["people/marren.md"]);
  });

  it("still matches the short form when it stands alone", () => {
    const hits = scanForms(index, "who leads the Koll household");
    expect(hits.map(h => h.form)).toEqual(["koll"]);
  });

  it("does not emit overlapping matches", () => {
    const hits = scanForms(index, "Marren Koll and Koll");
    expect(hits.map(h => h.form)).toEqual(["marren koll", "koll"]);
  });

  it("is case-insensitive and survives punctuation", () => {
    expect(scanForms(index, "MARREN KOLL, of the ivory gate.").map(h => h.form)).toEqual([
      "marren koll",
      "the ivory gate",
    ]);
  });

  it("returns offsets into the scanned text", () => {
    const text = "at the Ivory Gate";
    const [hit] = scanForms(index, text);
    expect(text.slice(hit.start, hit.end)).toBe("the Ivory Gate");
  });

  it("finds nothing in text that names nothing", () => {
    expect(scanForms(index, "what happened last week")).toEqual([]);
  });
});

describe("buildSurfaceIndex", () => {
  it("maps one form to every unit that answers to it", () => {
    // Two subjects can legitimately share a name. Resolving to both and
    // letting the planner include them beats guessing.
    const index = buildSurfaceIndex([
      unit("a.md", "Kollward"),
      unit("b.md", "Somebody", { aliases: ["Kollward"] }),
    ]);
    expect(index.forms.get("kollward")!.unitIds).toEqual(["a.md", "b.md"]);
  });

  it("records the longest form so the scanner knows how far to look", () => {
    const index = buildSurfaceIndex([unit("a.md", "The Order Of The Ivory Gate")]);
    expect(index.maxWords).toBe(6);
  });
});

describe("resolveQuestion", () => {
  const index = buildSurfaceIndex([
    unit("people/marren.md", "Marren Koll", { aliases: ["the Ledgerman"] }),
    unit("places/ivory-gate.md", "The Ivory Gate"),
  ]);

  it("names the subjects a question is about", () => {
    const subjects = resolveQuestion(index, "was Marren Koll ever at the Ivory Gate?");
    expect(subjects.map(s => s.form)).toEqual(["marren koll", "the ivory gate"]);
  });

  it("resolves an alias to the same unit as the name", () => {
    const [subject] = resolveQuestion(index, "who is the Ledgerman");
    expect(subject.unitIds).toEqual(["people/marren.md"]);
  });

  it("keeps the order the question asked in", () => {
    const subjects = resolveQuestion(index, "the Ivory Gate and Marren Koll");
    expect(subjects.map(s => s.form)).toEqual(["the ivory gate", "marren koll"]);
  });

  it("does not repeat a subject named twice", () => {
    expect(resolveQuestion(index, "Marren Koll, and again Marren Koll")).toHaveLength(1);
  });

  it("returns nothing when the question names nobody known", () => {
    // The signal the planner uses to fall through to semantic selection.
    expect(resolveQuestion(index, "what is the mood in the city")).toEqual([]);
  });
});

describe("normaliseForm", () => {
  it("is the same normalisation the scanner uses", () => {
    expect(normaliseForm("The  Ivory   Gate")).toBe("the ivory gate");
    expect(normaliseForm("Marren's")).toBe("marren");
  });
});
