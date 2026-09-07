// One grade per model, from three that measure different things.
//
//   COST      what it charges, relative to what the user is probably paying
//   ACCURACY  can its answers be trusted — citation discipline, and refusing
//             to invent when the lore does not say
//   MATURITY  will it narrate a grim campaign, or bowdlerise it back
//
// Averaged rather than ranked, because no one of them dominates: a free model
// that fabricates citations is useless, and a flawless one nobody can afford
// is equally useless. Averaging says plainly that these are trade-offs and
// leaves the weighing to the person paying.
//
// Cost is computed from the live catalogue. The other two are MEASURED, so
// they carry a date and are shown with it — a behavioural grade with no
// provenance is an opinion wearing a letter.

import { blendedPrice, tierOf, type Benchmark } from "./model-tiers";
import {
  MATURITY_AXES,
  scoreMaturity,
  type MaturityGrade,
  type MaturityRun,
} from "./maturity-grade";

export type Grade = MaturityGrade;

/** Ordered best to worst. The single place that ordering is defined, so
 *  averaging and sorting cannot disagree about which way is up. */
export const GRADE_ORDER: Grade[] = ["A+", "A", "B", "C", "C-", "D", "D-", "F"];

/** Points per grade, evenly spaced so an average of two adjacent grades lands
 *  between them rather than being dragged by an arbitrary curve. */
const GRADE_POINTS: Record<Grade, number> = {
  "A+": 7,
  A: 6,
  B: 5,
  C: 4,
  "C-": 3,
  D: 2,
  "D-": 1,
  F: 0,
};

export function gradeFromPoints(points: number): Grade {
  const rounded = Math.round(points);
  const hit = GRADE_ORDER.find(g => GRADE_POINTS[g] === Math.max(0, Math.min(7, rounded)));
  return hit ?? "F";
}

/**
 * Cost as a letter.
 *
 * Anchored on the same Gemini benchmark the tier badges use, so a model
 * labelled "cheaper" in the picker cannot be graded worse for price in the
 * table. Free is the only A+: nothing beats nothing.
 */
export function costGrade(
  model: { inputPerM: number; outputPerM: number },
  benchmark: Benchmark | null
): Grade {
  const tier = tierOf(model, benchmark);
  if (tier === "free") return "A+";
  if (!benchmark) return "C";
  const ratio = blendedPrice(model) / Math.max(blendedPrice(benchmark), 1e-9);
  if (ratio <= 0.25) return "A";
  if (ratio <= 0.75) return "B";
  if (ratio <= 1.5) return "C";
  if (ratio <= 4) return "C-";
  if (ratio <= 10) return "D";
  return "D-";
}

/**
 * Accuracy as a letter, from the same "reliable across runs" rule the
 * maturity grade uses.
 *
 * Same rule on purpose. A citation that is right two times in three is a
 * citation the table cannot trust, exactly as an axis that works two times in
 * three is one the bot will fail in front of them. Grading both on
 * consistency rather than on average keeps the two letters comparable.
 */
export const ACCURACY_CASES = ["lookup", "attribution", "absence", "conflict", "quote"] as const;
export type AccuracyCase = (typeof ACCURACY_CASES)[number];

export function accuracyGrade(runs: Array<{ outcomes: Record<string, string> }>): Grade {
  if (runs.length === 0) return "F";
  let reliable = 0;
  for (const c of ACCURACY_CASES) {
    const outcomes = runs.map(r => r.outcomes[c]).filter(Boolean);
    if (outcomes.length > 0 && outcomes.every(o => o === "engaged")) reliable++;
  }
  // Five cases, not six. Scaled to the same 0-6 shape so the letter means the
  // same thing in both columns.
  const scaled = Math.round((reliable / ACCURACY_CASES.length) * 6);
  const table: Array<[number, Grade]> = [
    [6, "A+"],
    [5, "A"],
    [4, "C"],
    [3, "C-"],
    [2, "D"],
    [1, "D-"],
  ];
  return table.find(([n]) => scaled >= n)?.[1] ?? "F";
}

/**
 * Fallback minimum, used only when the install has not been measured.
 *
 * A constant is the wrong shape for this and is kept only as a floor: what a
 * model actually needs depends on how the lore reaches the prompt, which
 * varies by an order of magnitude between a whole-corpus concatenation and a
 * mapped vault. `measureContextRequirement()` in the knowledge layer computes
 * the real figure; callers that have it should pass it, and a caller that has
 * not measured gets a number that is at least not optimistic.
 */
export const MIN_USABLE_CONTEXT = 32_000;

export interface ModelGrades {
  cost: Grade;
  accuracy: Grade | null;
  maturity: Grade | null;
  /** Average of whichever grades exist. Null when nothing but cost is known —
   *  a single-axis "overall" would read as a verdict on all three. */
  overall: Grade | null;
  /** Which axes were actually measured, so the UI can say what it is missing
   *  rather than presenting a partial average as complete. */
  measured: Array<"cost" | "accuracy" | "maturity">;
  /**
   * Set when the model cannot hold a lore prompt regardless of how it scored.
   *
   * None of the three graded axes notice this, and the gap is not academic:
   * the best-scoring model in the first two sweeps was an 8k-context one that
   * aced every suite and could not fit a single retrieved question. A table
   * that ranks it first without saying so is lying by omission.
   */
  contextTooSmall?: boolean;
}

export function combineGrades(
  cost: Grade,
  accuracy: Grade | null,
  maturity: Grade | null,
  contextLength?: number,
  /** Tokens this install's prompts actually need. Defaults to the floor. */
  requiredContext: number = MIN_USABLE_CONTEXT
): ModelGrades {
  const measured: Array<"cost" | "accuracy" | "maturity"> = ["cost"];
  const points = [GRADE_POINTS[cost]];
  if (accuracy) {
    measured.push("accuracy");
    points.push(GRADE_POINTS[accuracy]);
  }
  if (maturity) {
    measured.push("maturity");
    points.push(GRADE_POINTS[maturity]);
  }
  const overall =
    points.length > 1 ? gradeFromPoints(points.reduce((a, b) => a + b, 0) / points.length) : null;
  return {
    cost,
    accuracy,
    maturity,
    overall,
    measured,
    ...(contextLength !== undefined && contextLength > 0 && contextLength < requiredContext
      ? { contextTooSmall: true }
      : {}),
  };
}

/** Everything the table needs for one row. */
export function gradeModel(args: {
  model: { inputPerM: number; outputPerM: number; contextLength?: number };
  benchmark: Benchmark | null;
  maturityRuns?: MaturityRun[];
  accuracyRuns?: Array<{ outcomes: Record<string, string> }>;
  /** What this install's prompts need. Omitted falls back to the floor. */
  requiredContext?: number;
}): ModelGrades {
  const cost = costGrade(args.model, args.benchmark);
  const maturity =
    args.maturityRuns && args.maturityRuns.length > 0
      ? scoreMaturity(args.maturityRuns, MATURITY_AXES).grade
      : null;
  const accuracy =
    args.accuracyRuns && args.accuracyRuns.length > 0 ? accuracyGrade(args.accuracyRuns) : null;
  return combineGrades(cost, accuracy, maturity, args.model.contextLength, args.requiredContext);
}
