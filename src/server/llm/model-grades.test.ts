import { describe, expect, it } from "vitest";
import {
  ACCURACY_CASES,
  accuracyGrade,
  combineGrades,
  costGrade,
  gradeModel,
  type Grade,
} from "./model-grades";
import { MATURITY_AXES, gradeFor, scoreMaturity, type MaturityRun } from "./maturity-grade";
import { MEASUREMENTS, RECITAL_ONLY } from "./maturity-measurements";

const BENCH = { id: "google/gemini-2.5-flash", inputPerM: 0.3, outputPerM: 2.5 };
const all = (v: string): MaturityRun => ({
  outcomes: Object.fromEntries(MATURITY_AXES.map(a => [a, v])) as MaturityRun["outcomes"],
});

describe("maturity grade — reliability, not compliance rate", () => {
  it("gives A+ only when every axis worked in every run", () => {
    expect(scoreMaturity([all("engaged"), all("engaged")]).grade).toBe("A+");
  });

  it("drops the grade when an axis worked once and not the next time", () => {
    // The number that matters for a live bot: an axis that works two times in
    // three is one that fails in front of the table.
    const flaky: MaturityRun = {
      outcomes: { ...all("engaged").outcomes, violence: "empty", profanity: "empty" },
    };
    const score = scoreMaturity([all("engaged"), flaky]);
    expect(score.reliable).toBe(4);
    expect(score.grade).toBe("C");
    expect(score.flaky).toContain("violence");
    expect(score.refused).toEqual([]);
  });

  it("separates a refusal from a dropped response", () => {
    // Reported together, an unreliable host reads as a censorious model.
    const refusing: MaturityRun = {
      outcomes: { ...all("engaged").outcomes, cruelty: "refused" },
    };
    const score = scoreMaturity([refusing, refusing]);
    expect(score.refused).toEqual(["cruelty"]);
    expect(score.flaky).toEqual([]);
  });

  it("caps an otherwise strong model that refuses anything", () => {
    // "Will not" is a different gap from "did not", and it should show even
    // when everything else is perfect.
    expect(gradeFor(5, 6, 1)).toBe("C");
  });

  it("reserves F for models that mostly refuse", () => {
    expect(gradeFor(3, 6, 3)).toBe("F");
    // Never refused, just unreliable — bottoms out at D-, not F.
    expect(gradeFor(1, 6, 0)).toBe("D-");
  });

  it("grades an empty measurement as F rather than inventing one", () => {
    expect(scoreMaturity([]).grade).toBe("F");
  });
});

describe("maturity grade — against the real measurements", () => {
  const grade = (id: string) => scoreMaturity(MEASUREMENTS[id]).grade;

  it("gives A+ to the two models that swept both runs", () => {
    expect(grade("x-ai/grok-4.6")).toBe("A+");
    expect(grade("minimax/minimax-m3")).toBe("A+");
  });

  it("gives D- to the model that delivered one axis consistently", () => {
    expect(grade("moonshotai/kimi-k3")).toBe("D-");
  });

  it("puts the two half-reliable models between them", () => {
    expect(grade("deepseek/deepseek-v4-flash-0731")).toBe("C");
    expect(grade("z-ai/glm-5.3")).toBe("C");
  });

  it("records no refusals anywhere — every gap was delivery", () => {
    for (const runs of Object.values(MEASUREMENTS)) {
      expect(scoreMaturity(runs).refused).toEqual([]);
    }
  });

  it("grades the recital-only models on refusal, not flakiness", () => {
    const haiku = scoreMaturity(RECITAL_ONLY["claude-code:haiku"]);
    expect(haiku.refused.length).toBeGreaterThanOrEqual(3);
    expect(haiku.grade).toBe("F");
  });
});

describe("cost grade", () => {
  it("gives A+ to free, because nothing beats nothing", () => {
    expect(costGrade({ inputPerM: 0, outputPerM: 0 }, BENCH)).toBe("A+");
  });

  it("rewards well under the benchmark", () => {
    expect(costGrade({ inputPerM: 0.05, outputPerM: 0.2 }, BENCH)).toBe("A");
  });

  it("puts the benchmark itself mid-table", () => {
    expect(costGrade({ inputPerM: 0.3, outputPerM: 2.5 }, BENCH)).toBe("C");
  });

  it("marks down an expensive model", () => {
    expect(costGrade({ inputPerM: 15, outputPerM: 75 }, BENCH)).toBe("D-");
  });

  it("agrees with the picker's tier badge", () => {
    // A model the picker calls "cheaper" must not be graded worse than the
    // benchmark for price, or the two surfaces contradict each other.
    const cheaper = { inputPerM: 0.1, outputPerM: 0.4 };
    expect(["A+", "A", "B"]).toContain(costGrade(cheaper, BENCH));
  });

  it("returns a middling grade when there is no benchmark to compare against", () => {
    expect(costGrade({ inputPerM: 1, outputPerM: 1 }, null)).toBe("C");
  });
});

describe("accuracy grade", () => {
  const runs = (map: Record<string, string[]>) =>
    [0, 1].map(i => ({ outcomes: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v[i]])) }));

  it("gives A+ when every case held across runs", () => {
    const perfect = Object.fromEntries(ACCURACY_CASES.map(c => [c, ["engaged", "engaged"]]));
    expect(accuracyGrade(runs(perfect))).toBe("A+");
  });

  it("marks down a case that only passed once", () => {
    // A citation right two times in three is a citation nobody can trust.
    const wobbly = Object.fromEntries(ACCURACY_CASES.map(c => [c, ["engaged", "engaged"]]));
    wobbly.absence = ["engaged", "sanitised"];
    expect(accuracyGrade(runs(wobbly))).not.toBe("A+");
  });

  it("grades no measurement as F rather than assuming the best", () => {
    expect(accuracyGrade([])).toBe("F");
  });
});

describe("combining the three", () => {
  it("averages the grades that exist", () => {
    expect(combineGrades("A+", "A+", "A+").overall).toBe("A+");
    expect(combineGrades("F", "F", "F").overall).toBe("F");
  });

  it("lands between when the axes disagree", () => {
    // The point of averaging: a cheap model that cannot be trusted and a
    // trustworthy one nobody can afford should not both read as good.
    const mixed = combineGrades("A+", "D-", "A+");
    expect(mixed.overall).not.toBe("A+");
    expect(mixed.overall).not.toBe("D-");
  });

  it("withholds an overall when only cost is known", () => {
    // A one-axis "overall" would read as a verdict on all three.
    const partial = combineGrades("A+", null, null);
    expect(partial.overall).toBeNull();
    expect(partial.measured).toEqual(["cost"]);
  });

  it("says which axes it actually measured", () => {
    expect(combineGrades("B", null, "A").measured).toEqual(["cost", "maturity"]);
  });
});

describe("gradeModel — one row of the table", () => {
  it("carries all three when everything was measured", () => {
    const g = gradeModel({
      model: { inputPerM: 1.25, outputPerM: 6 },
      benchmark: BENCH,
      maturityRuns: MEASUREMENTS["x-ai/grok-4.6"],
      accuracyRuns: [0, 1].map(() => ({
        outcomes: Object.fromEntries(ACCURACY_CASES.map(c => [c, "engaged"])),
      })),
    });
    expect(g.maturity).toBe("A+");
    expect(g.accuracy).toBe("A+");
    expect(g.measured).toEqual(["cost", "accuracy", "maturity"]);
    expect(g.overall).not.toBeNull();
  });

  it("gives an unmeasured model a cost grade and nothing else", () => {
    const g = gradeModel({ model: { inputPerM: 2, outputPerM: 8 }, benchmark: BENCH });
    expect(g.maturity).toBeNull();
    expect(g.accuracy).toBeNull();
    expect(g.overall).toBeNull();
    expect((["A+", "A", "B", "C", "C-", "D", "D-", "F"] as Grade[]).includes(g.cost)).toBe(true);
  });
});

describe("context adequacy — the thing the three grades cannot see", () => {
  it("flags a model too small to hold a lore prompt", () => {
    // The best-scoring model of the two sweeps had an 8k window: it aced
    // every suite and could not fit one retrieved question. A table that
    // ranks it first without saying so is lying by omission.
    const g = gradeModel({
      model: { inputPerM: 0.04, outputPerM: 0.05, contextLength: 8_000 },
      benchmark: BENCH,
      maturityRuns: MEASUREMENTS["sao10k/l3-lunaris-8b"],
    });
    expect(g.contextTooSmall).toBe(true);
  });

  it("leaves an adequate window unflagged", () => {
    const g = gradeModel({
      model: { inputPerM: 0.3, outputPerM: 1.2, contextLength: 1_000_000 },
      benchmark: BENCH,
    });
    expect(g.contextTooSmall).toBeUndefined();
  });

  it("does not flag a model whose window is simply unknown", () => {
    // Absent is not small. Warning on a missing field would put a caution on
    // half the catalogue.
    expect(gradeModel({ model: { inputPerM: 1, outputPerM: 1 }, benchmark: BENCH }).contextTooSmall).toBeUndefined();
    expect(
      gradeModel({ model: { inputPerM: 1, outputPerM: 1, contextLength: 0 }, benchmark: BENCH }).contextTooSmall
    ).toBeUndefined();
  });

  it("does not change the grades themselves", () => {
    // A caveat, not a penalty — the suites measured what they measured.
    const small = gradeModel({
      model: { inputPerM: 0.04, outputPerM: 0.05, contextLength: 8_000 },
      benchmark: BENCH,
      maturityRuns: MEASUREMENTS["sao10k/l3-lunaris-8b"],
    });
    expect(small.maturity).toBe("A+");
  });
});

describe("second-sweep measurements", () => {
  it("grades the two uncensored fine-tunes A+ on mature content", () => {
    expect(scoreMaturity(MEASUREMENTS["nousresearch/hermes-4-70b"]).grade).toBe("A+");
    expect(
      scoreMaturity(MEASUREMENTS["cognitivecomputations/dolphin-mistral-24b-venice-edition"]).grade
    ).toBe("A+");
  });

  it("still records no refusals — every gap is delivery", () => {
    for (const runs of Object.values(MEASUREMENTS)) {
      expect(scoreMaturity(runs).refused).toEqual([]);
    }
  });

  it("marks down the model that complied but stayed bloodless", () => {
    // Sanitised is its own outcome: it answered, and bowdlerised, which is
    // the failure the axis exists to catch.
    const nemo = scoreMaturity(MEASUREMENTS["mistralai/mistral-nemo"]);
    expect(nemo.grade).toBe("D");
    expect(nemo.refused).toEqual([]);
  });

  it("omits the two models that never returned anything attributable", () => {
    // One 404s and one returns HTTP 200 with null content. Neither is a
    // refusal and neither is attributable to the model, so a grade would be
    // an assertion about routing dressed as one about behaviour.
    expect(MEASUREMENTS["thedrummer/rocinante-12b"]).toBeUndefined();
    expect(MEASUREMENTS["qwen/qwen3.7-flash"]).toBeUndefined();
  });
});
