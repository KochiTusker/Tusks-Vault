import { describe, expect, it } from "vitest";
import { CASES, citesFile, gradeCase, saysLoreGap, summarise } from "./grade.mjs";

const findCase = id => CASES.find(c => c.id === id);

describe("saysLoreGap", () => {
  it("accepts the phrase regardless of case and surrounding prose", () => {
    expect(saysLoreGap("I am unsure about this detail. I have recorded this as a lore gap.")).toBe(true);
    expect(saysLoreGap("Alas — I AM UNSURE ABOUT THIS DETAIL, friend.")).toBe(true);
  });

  it("rejects a paraphrase", () => {
    // A paraphrase reads fine to a human and silently fails to log the gap
    // downstream, so it must not score as compliance.
    expect(saysLoreGap("I'm not sure about that detail.")).toBe(false);
    expect(saysLoreGap("The chronicle does not say.")).toBe(false);
  });

  it("rejects empty and undefined answers", () => {
    expect(saysLoreGap("")).toBe(false);
    expect(saysLoreGap(undefined)).toBe(false);
  });
});

describe("citesFile", () => {
  it("matches a bare filename citation", () => {
    expect(citesFile("Dunmar fell in the Third Age [Dunmar.md].", "Dunmar.md")).toBe(true);
  });

  it("matches a path-qualified or verbosely-labelled citation", () => {
    // All three point a reader at the same file; scoring only the tidiest
    // form would penalise a correct answer for its formatting.
    expect(citesFile("... [Sessions/Dunmar.md]", "Dunmar.md")).toBe(true);
    expect(citesFile("... [SOURCE DOCUMENT: Dunmar.md]", "Dunmar.md")).toBe(true);
  });

  it("rejects a citation naming a different file", () => {
    expect(citesFile("... [Houses.md]", "Dunmar.md")).toBe(false);
  });

  it("ignores the filename outside brackets", () => {
    // Mentioning a filename in prose is not a citation.
    expect(citesFile("According to Dunmar.md, it fell.", "Dunmar.md")).toBe(false);
  });

  it("returns null when the case names no file", () => {
    expect(citesFile("anything", undefined)).toBeNull();
  });
});

describe("gradeCase — retrieval", () => {
  const c = findCase("when-dunmar-fell");

  it("passes a correct, cited answer", () => {
    const r = gradeCase(c, "Dunmar fell in the Third Age [Dunmar.md].");
    expect(r.correct).toBe(true);
    expect(r.cited).toBe(true);
    expect(r.citedRight).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("marks a correct but uncited answer as correct AND uncited", () => {
    // These fail independently and for different reasons. Collapsing them
    // would hide the trade-off the whole harness exists to measure.
    const r = gradeCase(c, "Dunmar fell in the Third Age.");
    expect(r.correct).toBe(true);
    expect(r.cited).toBe(false);
    expect(r.failures).toContain("no citation marker");
  });

  it("marks a wrong answer wrong even when beautifully cited", () => {
    const r = gradeCase(c, "Dunmar fell in the Second Age [Dunmar.md].");
    expect(r.correct).toBe(false);
    expect(r.cited).toBe(true);
  });

  it("flags a citation pointing at the wrong file", () => {
    const r = gradeCase(c, "Dunmar fell in the Third Age [Houses.md].");
    expect(r.citedRight).toBe(false);
    expect(r.failures.join(" ")).toMatch(/wrong file/);
  });

  it("records an empty response as unanswered", () => {
    const r = gradeCase(c, "");
    expect(r.answered).toBe(false);
    expect(r.failures).toContain("empty response");
  });
});

describe("gradeCase — decoys", () => {
  it("fails an answer that took the near-identical decoy", () => {
    // House Vayne, one letter apart, has a red stag.
    const r = gradeCase(findCase("vane-banner"), "A red stag on white [Houses.md].");
    expect(r.correct).toBe(false);
    expect(r.failures.join(" ")).toMatch(/stag/);
  });

  it("fails an answer naming a gate that held", () => {
    const r = gradeCase(findCase("which-gate"), "The Salt Gate was breached [Dunmar.md].");
    expect(r.correct).toBe(false);
  });

  it("accepts either spelling where a case allows alternatives", () => {
    const c = findCase("maera-bounty");
    expect(gradeCase(c, "Four hundred crowns [Sessions.md].").correct).toBe(true);
    expect(gradeCase(c, "400 crowns [Sessions.md].").correct).toBe(true);
  });

  it("still requires BOTH facts where a case wants both", () => {
    const c = findCase("kelmoor-ruler");
    expect(gradeCase(c, "Lady Ismet Corrin rules Kelmoor [Houses.md].").correct).toBe(false);
    expect(gradeCase(c, "Lady Ismet Corrin, for eleven years [Houses.md].").correct).toBe(true);
  });
});

describe("gradeCase — lore gaps", () => {
  const c = findCase("strongbox-contents");

  it("passes a clean refusal", () => {
    const r = gradeCase(c, "I am unsure about this detail. I have recorded this as a lore gap for the DM to clarify.");
    expect(r.gapHandled).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("FAILS a refusal that then speculates anyway", () => {
    // The decisive case. The phrase is present, so a naive check passes it —
    // but the speculation is what reaches the table, and it is exactly what a
    // helpful model produces.
    const r = gradeCase(
      c,
      "I am unsure about this detail. I have recorded this as a lore gap. That said, a Vane strongbox would likely hold gold."
    );
    expect(r.gapHandled).toBe(false);
    expect(r.failures.join(" ")).toMatch(/invented: gold/);
  });

  it("fails a confident invention with no refusal at all", () => {
    const r = gradeCase(c, "The strongbox held a deed and several coins [Sessions.md].");
    expect(r.gapHandled).toBe(false);
    expect(r.failures.join(" ")).toMatch(/did not emit the lore-gap phrase/);
  });

  it("does not require a citation from a lore-gap answer", () => {
    // There is nothing to cite; demanding one would score a correct refusal
    // as a failure.
    const r = gradeCase(c, "I am unsure about this detail.");
    expect(r.cited).toBeNull();
    expect(r.citedRight).toBeNull();
  });

  it("catches asserting either side of a deliberately open question", () => {
    const c2 = findCase("corwin-fate");
    expect(gradeCase(c2, "He survived the siege.").gapHandled).toBe(false);
    expect(gradeCase(c2, "Yes, he is dead [Houses.md].").gapHandled).toBe(false);
    expect(gradeCase(c2, "I am unsure about this detail. Recorded as a lore gap.").gapHandled).toBe(true);
  });
});

// Verbatim answers from a real bake-off run, kept as fixtures.
//
// Every one of these is a GOOD answer that an earlier version of the case set
// scored as a failure — the first run reported both Haiku and Sonnet as
// inventing a city on the Vellin and confusing Dunmar's gates, when in fact
// all four answers were correct and the case specs were wrong.
//
// A grader that penalises correct answers is worse than no grader: it produces
// a confident, specific, wrong conclusion about which models to trust. These
// stay so that a future tightening of the reject lists has to keep passing
// answers that are actually right.
describe("regression — real answers that must not be marked wrong", () => {
  const REAL = {
    "which-gate": [
      "The **Ashen Gate**, on the eastern wall, was breached [Dunmar.md]. The Salt Gate, the Rook Gate, and the Chandler's Gate all held until the water made them irrelevant [Dunmar.md].",
      "Only the Ashen Gate was breached — on the eastern wall, the night the sea took Dunmar's lower quarter [Dunmar.md]. The other three, the Salt Gate, the Rook Gate and the Chandler's Gate, all held until the water made them irrelevant [Dunmar.md].",
    ],
    "vellin-city": [
      "No city sits on the river Vellin. The Vellin is a smaller river two hundred miles north of the Vell, with no city on it at all. [Dunmar.md]",
      "The Vellin has no city on it at all — Dunmar sits on the Vell Estuary, a different river, and the two are explicitly noted as not to be confused [Dunmar.md].",
    ],
  };

  for (const [caseId, answers] of Object.entries(REAL)) {
    answers.forEach((answer, i) => {
      it(`${caseId} — real answer ${i + 1} scores as a pass`, () => {
        const r = gradeCase(findCase(caseId), answer);
        expect(r.failures, answer.slice(0, 80)).toEqual([]);
      });
    });
  }

  it("still fails an answer that names the wrong gate as breached", () => {
    // The fix must not have simply disarmed the case.
    const r = gradeCase(findCase("which-gate"), "The Salt Gate was breached [Dunmar.md].");
    expect(r.correct).toBe(false);
  });

  it("still fails an answer that puts a city on the Vellin", () => {
    const r = gradeCase(findCase("vellin-city"), "Dunmar sits on the river Vellin [Dunmar.md].");
    expect(r.correct).toBe(false);
  });
});

describe("summarise", () => {
  it("reports each dimension separately", () => {
    const s = summarise([
      { id: "a", answered: true, correct: true, cited: true, citedRight: true, gapHandled: null, failures: [] },
      { id: "b", answered: true, correct: true, cited: false, citedRight: false, gapHandled: null, failures: ["x"] },
    ]);
    expect(s.accuracy).toBe(1);
    expect(s.citation).toBe(0.5);
    expect(s.failures).toBe(1);
  });

  it("returns null for a dimension no case exercised", () => {
    // Not zero. A model that faced no lore-gap case has not scored 0% on gap
    // discipline; it has no score, and printing 0% would libel it.
    const s = summarise([
      { id: "a", answered: true, correct: true, cited: true, citedRight: true, gapHandled: null, failures: [] },
    ]);
    expect(s.gapDiscipline).toBeNull();
  });

  it("excludes non-applicable cases from each rate's denominator", () => {
    const s = summarise([
      { id: "a", answered: true, correct: true, cited: true, citedRight: true, gapHandled: null, failures: [] },
      { id: "b", answered: true, correct: null, cited: null, citedRight: null, gapHandled: false, failures: ["y"] },
    ]);
    expect(s.accuracy).toBe(1); // one applicable case, passed
    expect(s.gapDiscipline).toBe(0); // one applicable case, failed
  });
});

describe("the case set itself", () => {
  it("has unique ids", () => {
    expect(new Set(CASES.map(c => c.id)).size).toBe(CASES.length);
  });

  it("gives every case a note explaining why it exists", () => {
    // A case nobody can justify is a case nobody will maintain.
    for (const c of CASES) expect(c.note, c.id).toBeTruthy();
  });

  it("names a source file for every non-gap case", () => {
    for (const c of CASES.filter(c => !c.loreGap)) expect(c.citeFile, c.id).toBeTruthy();
  });

  it("keeps a meaningful share of gap cases", () => {
    // Refusal discipline is the dimension cheap models actually fail. A suite
    // that is all retrieval would report them as fine.
    const gaps = CASES.filter(c => c.loreGap).length;
    expect(gaps).toBeGreaterThanOrEqual(3);
    expect(gaps / CASES.length).toBeGreaterThan(0.2);
  });
});
