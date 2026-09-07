import { describe, expect, it } from "vitest";
import {
  CORNERS,
  PRESETS,
  PRIORITIES,
  explainPick,
  fitScore,
  gradeStrength,
  isRankable,
  pointFromWeights,
  positionOf,
  rankByFit,
  weightsFromPoint,
  weightsFromPriorities,
  headroomOf,
  headroomRatio,
  HEADROOM_WEIGHT,
  type FitCandidate,
} from "./model-fit";
import { GRADE_ORDER, combineGrades, type Grade, type ModelGrades } from "./model-grades";

const grades = (cost: Grade, accuracy: Grade | null, maturity: Grade | null, ctx?: number): ModelGrades =>
  combineGrades(cost, accuracy, maturity, ctx);

const candidate = (id: string, g: ModelGrades): FitCandidate => ({ id, grades: g });

describe("grade strength", () => {
  it("runs the full range with the best at 1 and the worst at 0", () => {
    expect(gradeStrength("A+")).toBe(1);
    expect(gradeStrength("F")).toBe(0);
  });

  it("agrees with the grading module about which way is up", () => {
    // Two sources of truth about grade ordering would eventually disagree,
    // and the disagreement would surface as a model ranked backwards.
    const strengths = GRADE_ORDER.map(gradeStrength);
    for (let i = 1; i < strengths.length; i++) {
      expect(strengths[i]).toBeLessThan(strengths[i - 1]);
    }
  });

  it("treats an unmeasured axis as no strength rather than guessing", () => {
    expect(gradeStrength(null)).toBe(0);
    expect(gradeStrength(undefined)).toBe(0);
  });
});

describe("weights from ticked boxes", () => {
  it("splits evenly between the ticked ones", () => {
    const w = weightsFromPriorities(["cost", "accuracy"]);
    expect(w.cost).toBeCloseTo(0.5);
    expect(w.accuracy).toBeCloseTo(0.5);
    expect(w.maturity).toBe(0);
  });

  it("reads nothing ticked as everything ticked", () => {
    // "I have no preference" and "all three matter" are the same request, and
    // an empty selection must not empty the list.
    expect(weightsFromPriorities([])).toEqual(weightsFromPriorities(PRIORITIES));
  });

  it("always sums to one, so scores stay comparable between weightings", () => {
    for (const preset of PRESETS) {
      const w = weightsFromPriorities(preset.priorities);
      expect(w.cost + w.accuracy + w.maturity).toBeCloseTo(1);
    }
  });
});

describe("the triangle", () => {
  it("puts a single priority exactly on its own corner", () => {
    for (const p of PRIORITIES) {
      const point = pointFromWeights(weightsFromPriorities([p]));
      expect(point.x).toBeCloseTo(CORNERS[p].x);
      expect(point.y).toBeCloseTo(CORNERS[p].y);
    }
  });

  it("round-trips a point back to the weights that produced it", () => {
    // The tickboxes and the triangle are one control with two faces. A lossy
    // conversion would make them drift apart as the user switched between.
    for (const preset of PRESETS) {
      const w = weightsFromPriorities(preset.priorities);
      const p = pointFromWeights(w);
      const back = weightsFromPoint(p.x, p.y);
      expect(back.cost).toBeCloseTo(w.cost);
      expect(back.accuracy).toBeCloseTo(w.accuracy);
      expect(back.maturity).toBeCloseTo(w.maturity);
    }
  });

  it("snaps a click outside the shape to the nearest valid mix", () => {
    // A click lands where the pointer was, including outside the triangle.
    // Rejecting it reads as a broken control, so it slides onto the edge.
    const w = weightsFromPoint(-0.4, 1.3);
    expect(w.cost).toBeGreaterThan(0);
    expect(w.maturity).toBe(0);
    expect(w.cost + w.accuracy + w.maturity).toBeCloseTo(1);
  });

  it("never returns a negative or unnormalised weight, wherever you click", () => {
    for (let x = -0.5; x <= 1.5; x += 0.25) {
      for (let y = -0.5; y <= 1.5; y += 0.25) {
        const w = weightsFromPoint(x, y);
        for (const p of PRIORITIES) expect(w[p]).toBeGreaterThanOrEqual(0);
        expect(w.cost + w.accuracy + w.maturity).toBeCloseTo(1);
      }
    }
  });

  it("places a model that is good at one thing on that corner", () => {
    const p = positionOf(grades("F", "F", "A+"));
    expect(p.x).toBeCloseTo(CORNERS.maturity.x);
    expect(p.y).toBeCloseTo(CORNERS.maturity.y);
  });

  it("places an all-round model in the middle", () => {
    const p = positionOf(grades("B", "B", "B"));
    expect(p.x).toBeCloseTo(0.5);
    expect(p.y).toBeCloseTo(2 / 3);
  });
});

describe("ranking", () => {
  const cheapLiar = candidate("cheap-liar", grades("A+", "D-", "D"));
  const pricyOracle = candidate("pricy-oracle", grades("D-", "A+", "A+"));
  const allRound = candidate("all-round", grades("B", "A", "A"));
  const pool = [cheapLiar, pricyOracle, allRound];

  it("gives the cheapest model to somebody who only ticked price", () => {
    expect(rankByFit(pool, weightsFromPriorities(["cost"]))[0].id).toBe("cheap-liar");
  });

  it("gives the trustworthy one to somebody who only ticked accuracy", () => {
    expect(rankByFit(pool, weightsFromPriorities(["accuracy"]))[0].id).toBe("pricy-oracle");
  });

  it("changes its answer when the priorities change", () => {
    // The whole point of the control: if every weighting produced the same
    // winner there would be nothing to choose, and the UI would be theatre.
    const byCost = rankByFit(pool, weightsFromPriorities(["cost"]))[0].id;
    const byQuality = rankByFit(pool, weightsFromPriorities(["accuracy", "maturity"]))[0].id;
    expect(byCost).not.toBe(byQuality);
  });

  it("leaves out models never measured on all three axes", () => {
    // Two known grades and a blank is not a position, it is a guess — and a
    // guess plotted among measurements reads as a measurement.
    const unmeasured = candidate("unmeasured", grades("A", null, null));
    expect(isRankable(unmeasured.grades)).toBe(false);
    expect(rankByFit([...pool, unmeasured], weightsFromPriorities([])).map(r => r.id)).not.toContain(
      "unmeasured"
    );
  });

  it("ranks a model that cannot hold a prompt last, however well it scored", () => {
    // An 8k-context model swept both behavioural suites. Ranking it first
    // would send a user to a model that cannot answer a single question.
    const tiny = candidate("tiny-window", grades("A+", "A+", "A+", 8_000));
    const ranked = rankByFit([...pool, tiny], weightsFromPriorities([]));
    expect(ranked[ranked.length - 1].id).toBe("tiny-window");
    expect(ranked[ranked.length - 1].contextTooSmall).toBe(true);
  });

  it("keeps that model listed rather than hiding it", () => {
    // A user who has heard of it should find it and see why it is not the
    // answer, rather than conclude the table is incomplete.
    const tiny = candidate("tiny-window", grades("A+", "A+", "A+", 8_000));
    expect(rankByFit([tiny], weightsFromPriorities([]))).toHaveLength(1);
  });

  it("breaks ties by name so the list does not reshuffle between renders", () => {
    const a = candidate("aaa", grades("B", "A", "A"));
    const b = candidate("bbb", grades("B", "A", "A"));
    expect(rankByFit([b, a], weightsFromPriorities([])).map(r => r.id)).toEqual(["aaa", "bbb"]);
  });

  it("scores a perfect model at 1 and a hopeless one at 0 for any weighting", () => {
    const w = weightsFromPoint(0.4, 0.7);
    expect(fitScore(grades("A+", "A+", "A+"), w)).toBeCloseTo(1);
    expect(fitScore(grades("F", "F", "F"), w)).toBeCloseTo(0);
  });
});

describe("presets", () => {
  it("covers every useful combination of the three boxes exactly once", () => {
    // Seven, not eight: ticking nothing already means ticking all three, so
    // an eighth preset would be a duplicate wearing a different name.
    const keys = PRESETS.map(p => [...p.priorities].sort().join("+"));
    expect(new Set(keys).size).toBe(PRESETS.length);
    expect(PRESETS).toHaveLength(7);
  });

  it("gives every preset a distinct id and something to read", () => {
    expect(new Set(PRESETS.map(p => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) expect(p.hint.length).toBeGreaterThan(0);
  });
});

describe("explaining the pick", () => {
  it("names only the axes the user asked about", () => {
    const [top] = rankByFit([candidate("m", grades("A+", "D", "D"))], weightsFromPriorities(["cost"]));
    const line = explainPick(top, weightsFromPriorities(["cost"]));
    expect(line).toContain("runs cheap");
    expect(line).not.toContain("never invents");
  });

  it("says plainly when the winner is not actually usable", () => {
    const [top] = rankByFit(
      [candidate("tiny", grades("A+", "A+", "A+", 8_000))],
      weightsFromPriorities([])
    );
    expect(explainPick(top, weightsFromPriorities([])).toLowerCase()).toContain("context window");
  });
});

describe("headroom — how hard this install makes the job", () => {
  it("calls a window that cannot hold the prompt blocked", () => {
    expect(headroomOf(8_000, 44_000)).toBe("blocked");
  });

  it("calls a window that only just holds it tight", () => {
    // Fits, but with nothing spare to answer in and recall happening across
    // a nearly-full context.
    expect(headroomOf(50_000, 44_000)).toBe("tight");
  });

  it("calls two to three times over workable, and more than that ample", () => {
    expect(headroomOf(88_000, 44_000)).toBe("workable");
    expect(headroomOf(1_000_000, 44_000)).toBe("ample");
  });

  it("makes no claim when the window is unknown", () => {
    // A guess about headroom is worse than no claim: it would rank a model
    // on a number nobody measured.
    expect(headroomRatio(undefined, 44_000)).toBe(Infinity);
  });

  it("penalises only the tight case, and never rewards a huge window", () => {
    // Rewarding ample would rank million-token models first regardless of
    // how they scored — the exact failure the grades exist to prevent.
    expect(HEADROOM_WEIGHT.tight).toBeLessThan(1);
    expect(HEADROOM_WEIGHT.workable).toBe(1);
    expect(HEADROOM_WEIGHT.ample).toBe(1);
  });
});

describe("ranking with the install's requirement in hand", () => {
  const roomy = { ...candidate("roomy", grades("B", "A", "A")), contextLength: 1_000_000 };
  const cramped = { ...candidate("cramped", grades("B", "A", "A")), contextLength: 50_000 };

  it("prefers the model with room when two are otherwise identical", () => {
    const ranked = rankByFit([cramped, roomy], weightsFromPriorities([]), 44_000);
    expect(ranked[0].id).toBe("roomy");
    expect(ranked.find(r => r.id === "cramped")!.headroom).toBe("tight");
  });

  it("does not disturb the order when nothing has been measured", () => {
    // Without a requirement there is no headroom to judge, and the ranking
    // must fall back to the grades alone rather than inventing a tiebreak.
    const ranked = rankByFit([cramped, roomy], weightsFromPriorities([]));
    expect(ranked.map(r => r.id)).toEqual(["cramped", "roomy"]);
    expect(ranked[0].headroom).toBeUndefined();
  });

  it("leaves a well-graded roomy model ahead of a badly-graded roomy one", () => {
    // Headroom is a mild tiebreak, not a new axis. It must never outrank the
    // thing that was actually measured.
    const good = { ...candidate("good", grades("B", "A+", "A+")), contextLength: 50_000 };
    const bad = { ...candidate("bad", grades("B", "D-", "D-")), contextLength: 1_000_000 };
    expect(rankByFit([bad, good], weightsFromPriorities([]), 44_000)[0].id).toBe("good");
  });

  it("still ranks a blocked model last, penalty or no penalty", () => {
    const tiny = { ...candidate("tiny", grades("A+", "A+", "A+", 8_000)), contextLength: 8_000 };
    const ranked = rankByFit([tiny, roomy], weightsFromPriorities([]), 44_000);
    expect(ranked[ranked.length - 1].id).toBe("tiny");
  });
});
