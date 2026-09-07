// Which model is right for THIS user?
//
// The grades say what each model is good at. They do not say which one to
// pick, because that depends on what the person cares about — and the three
// axes genuinely trade off: the cheapest model in the table invents campaign
// facts, and the best narrator costs seven times the cheapest that works.
//
// So the user states priorities and the ranking follows. Two ways in, one
// model behind both:
//
//   TICKBOXES  "what matters to you" — three boxes, seven useful combinations
//   TRIANGLE   the same thing continuously, with every model plotted at its
//              own strengths so the trade-off is visible rather than implied
//
// Ticking boxes moves the marker; moving the marker is the same as ticking
// with weights in between. Neither is the "real" control.

import { GRADE_ORDER, type Grade, type ModelGrades } from "./model-grades";

export type Priority = "cost" | "accuracy" | "maturity";
export const PRIORITIES: Priority[] = ["cost", "accuracy", "maturity"];

export const PRIORITY_LABEL: Record<Priority, string> = {
  cost: "Runs cheap",
  accuracy: "Never invents",
  maturity: "Handles dark themes",
};

export const PRIORITY_BLURB: Record<Priority, string> = {
  cost: "What it charges per question.",
  accuracy: "Cites the right source, and says so when your lore does not know.",
  maturity: "Narrates violence, cruelty and adult themes instead of softening them.",
};

export type Weights = Record<Priority, number>;

/** Every grade as a 0–1 strength. Shared with the grading module's ordering so
 *  the two cannot disagree about which way is up. */
export function gradeStrength(grade: Grade | null | undefined): number {
  if (!grade) return 0;
  const i = GRADE_ORDER.indexOf(grade);
  if (i === -1) return 0;
  return 1 - i / (GRADE_ORDER.length - 1);
}

/**
 * Weights from ticked boxes.
 *
 * Ticked priorities share the weight equally; ticking nothing is the same as
 * ticking everything, because "I have no preference" and "all three matter"
 * are the same request and an empty selection should not produce an empty
 * list.
 */
export function weightsFromPriorities(ticked: Priority[]): Weights {
  const active = ticked.length > 0 ? ticked : PRIORITIES;
  const share = 1 / active.length;
  return {
    cost: active.includes("cost") ? share : 0,
    accuracy: active.includes("accuracy") ? share : 0,
    maturity: active.includes("maturity") ? share : 0,
  };
}

/** The seven useful tickbox combinations, named so the control reads as a
 *  choice rather than a formula. */
export const PRESETS: Array<{ id: string; label: string; hint: string; priorities: Priority[] }> = [
  { id: "balanced", label: "Balanced", hint: "No axis matters more than another.", priorities: ["cost", "accuracy", "maturity"] },
  { id: "cheap", label: "As cheap as possible", hint: "Price above all; expect trade-offs.", priorities: ["cost"] },
  { id: "trustworthy", label: "Trustworthy answers", hint: "Cites correctly and refuses to invent.", priorities: ["accuracy"] },
  { id: "unflinching", label: "Unflinching narration", hint: "Writes the grim register without softening.", priorities: ["maturity"] },
  { id: "cheap-trustworthy", label: "Cheap and trustworthy", hint: "For a bot that mostly answers lore questions.", priorities: ["cost", "accuracy"] },
  { id: "cheap-dark", label: "Cheap and unflinching", hint: "For narration on a budget.", priorities: ["cost", "maturity"] },
  { id: "quality", label: "Trustworthy and unflinching", hint: "Ignore price; get both.", priorities: ["accuracy", "maturity"] },
];

export interface FitCandidate {
  id: string;
  grades: ModelGrades;
  contextLength?: number;
}

// ── headroom ─────────────────────────────────────────────────────────────
//
// The measured accuracy grade says how well a model cites when the material
// is in front of it. It does not say how well it will do THAT job HERE, and
// the difference is the size of the haystack.
//
// A model with a 128k window answering a 40k prompt is reading a third of
// its capacity. The same model on a 120k prompt is reading almost all of it,
// with nothing left for a long answer, and doing recall across a nearly-full
// context — the regime where retrieval from the middle of the input is
// weakest. Same model, same grade, worse odds.
//
// This is a structural argument, not a measured one: no accuracy suite was
// run at varying prompt sizes, and the letters are not adjusted by it.
// Ranking is a recommendation and may weigh it; the grade is a measurement
// and must not move.

export type Headroom = "blocked" | "tight" | "workable" | "ample";

/** How many times over the model's window covers what this install needs. */
export function headroomRatio(contextLength: number | undefined, required: number): number {
  if (!contextLength || contextLength <= 0 || required <= 0) return Infinity;
  return contextLength / required;
}

export function headroomOf(contextLength: number | undefined, required: number): Headroom {
  const ratio = headroomRatio(contextLength, required);
  if (ratio < 1) return "blocked";
  if (ratio < 1.5) return "tight";
  if (ratio < 3) return "workable";
  return "ample";
}

/**
 * Ranking multiplier.
 *
 * Only "tight" is penalised, and only mildly. A bigger window past the point
 * of comfort does NOT make a model more accurate, so there is no bonus for
 * ample — rewarding it would just rank million-token models first regardless
 * of how they scored, which is the failure this whole grading system exists
 * to avoid.
 */
export const HEADROOM_WEIGHT: Record<Headroom, number> = {
  blocked: 1, // handled by ordering, not by score — see rankByFit
  tight: 0.85,
  workable: 1,
  ample: 1,
};

export interface FitResult {
  id: string;
  score: number;
  grades: ModelGrades;
  /** Where this model sits in the triangle, from its own strengths. */
  position: { x: number; y: number };
  /** True when the model cannot hold a lore prompt however well it scored. */
  contextTooSmall: boolean;
  /** How much room this install leaves the model. Absent when nothing was
   *  measured — a guess about headroom is worse than no claim. */
  headroom?: Headroom;
}

/** Only models measured on all three axes can be ranked or placed — two
 *  known grades and a blank is not a position, it is a guess. */
export function isRankable(g: ModelGrades): boolean {
  return Boolean(g.accuracy && g.maturity);
}

export function fitScore(g: ModelGrades, w: Weights): number {
  return (
    gradeStrength(g.cost) * w.cost +
    gradeStrength(g.accuracy) * w.accuracy +
    gradeStrength(g.maturity) * w.maturity
  );
}

// ── the triangle ─────────────────────────────────────────────────────────
//
// Accuracy at the apex, cost bottom-left, maturity bottom-right, in a unit
// square with y growing downward so the numbers drop straight into SVG.

export const CORNERS: Record<Priority, { x: number; y: number }> = {
  accuracy: { x: 0.5, y: 0 },
  cost: { x: 0, y: 1 },
  maturity: { x: 1, y: 1 },
};

export function pointFromWeights(w: Weights): { x: number; y: number } {
  const total = w.cost + w.accuracy + w.maturity || 1;
  return {
    x: (w.cost * CORNERS.cost.x + w.accuracy * CORNERS.accuracy.x + w.maturity * CORNERS.maturity.x) / total,
    y: (w.cost * CORNERS.cost.y + w.accuracy * CORNERS.accuracy.y + w.maturity * CORNERS.maturity.y) / total,
  };
}

/**
 * Weights from a point, clamped into the triangle.
 *
 * A click lands wherever the pointer was, including outside the shape. Rather
 * than rejecting it — which feels broken — the nearest valid mix is used:
 * negative weights are zeroed and the rest renormalised, which is the same as
 * sliding the point onto the nearest edge.
 */
export function weightsFromPoint(x: number, y: number): Weights {
  const accuracy = 1 - y;
  const maturity = x - 0.5 * accuracy;
  const cost = y - maturity;
  const raw = { cost, accuracy, maturity };
  const clamped = {
    cost: Math.max(0, raw.cost),
    accuracy: Math.max(0, raw.accuracy),
    maturity: Math.max(0, raw.maturity),
  };
  const total = clamped.cost + clamped.accuracy + clamped.maturity;
  if (total <= 0) return weightsFromPriorities([]);
  return {
    cost: clamped.cost / total,
    accuracy: clamped.accuracy / total,
    maturity: clamped.maturity / total,
  };
}

/** Where a model sits: its three strengths, normalised, read as a mix. */
export function positionOf(g: ModelGrades): { x: number; y: number } {
  return pointFromWeights({
    cost: gradeStrength(g.cost),
    accuracy: gradeStrength(g.accuracy),
    maturity: gradeStrength(g.maturity),
  });
}

/**
 * Rank the candidates for one set of priorities.
 *
 * Models too small to hold a lore prompt are ranked last regardless of score
 * rather than hidden: a user who has heard of one should find it, see the
 * warning, and understand why it is not the answer.
 */
export function rankByFit(
  candidates: FitCandidate[],
  w: Weights,
  /** Tokens this install's prompts need. Omitted leaves headroom unjudged,
   *  which is the honest state before anything has been measured. */
  requiredContext?: number
): FitResult[] {
  return candidates
    .filter(c => isRankable(c.grades))
    .map(c => {
      const headroom =
        requiredContext && c.contextLength ? headroomOf(c.contextLength, requiredContext) : undefined;
      return {
        id: c.id,
        score: fitScore(c.grades, w) * (headroom ? HEADROOM_WEIGHT[headroom] : 1),
        grades: c.grades,
        position: positionOf(c.grades),
        contextTooSmall: Boolean(c.grades.contextTooSmall),
        ...(headroom ? { headroom } : {}),
      };
    })
    .sort(
      (a, b) =>
        Number(a.contextTooSmall) - Number(b.contextTooSmall) || b.score - a.score || a.id.localeCompare(b.id)
    );
}

/** One line explaining why the top pick won, in the user's own terms. */
export function explainPick(top: FitResult, w: Weights): string {
  const ranked = PRIORITIES.filter(p => w[p] > 0).sort((a, b) => w[b] - w[a]);
  const strengths = ranked
    .map(p => `${PRIORITY_LABEL[p].toLowerCase()}: ${top.grades[p] ?? "—"}`)
    .join(", ");
  return top.contextTooSmall
    ? `${top.id} scores highest (${strengths}) — but its context window cannot hold a lore prompt, so it is not a real option.`
    : `${top.id} — ${strengths}.`;
}
