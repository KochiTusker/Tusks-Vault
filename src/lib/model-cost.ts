// Cost, spelled out — on hover, where it does not crowd the page.
//
// The picker and the comparison table both need to answer "what does this
// actually cost me", and both want the answer out of the way until somebody
// asks for it. A tier badge is the at-a-glance signal; this is what sits
// behind it.
//
// Shared rather than written twice, because two formatters drift and then the
// same model quotes two different prices in two places, which is worse than
// quoting none.

/** Tokens in a representative Vault question.
 *
 *  A lore question ships retrieved passages plus the system prompt — with
 *  retrieval that is single-digit thousands, without it the whole corpus. 100k
 *  is a deliberately round, mid-range figure: the point is to turn "$/M" into
 *  money at a glance, not to predict a bill. The label says what it assumes so
 *  nobody reads it as a promise. */
export const TYPICAL_QUESTION_TOKENS = 100_000;
/** Tokens in a representative answer. */
const TYPICAL_ANSWER_TOKENS = 700;

export function formatRatePerM(perM: number): string {
  if (perM === 0) return "free";
  return perM < 0.01 ? `$${perM.toFixed(4)}` : `$${perM.toFixed(2)}`;
}

export function formatContext(tokens: number | null | undefined): string {
  if (!tokens) return "unknown";
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  // A 1,048,576-token window is "1M" to everyone who talks about it; the
  // trailing ".0" is precision nobody asked for.
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** Cost of one representative question, in dollars. */
export function estimateQuestionCost(inputPerM: number, outputPerM: number): number {
  return (
    (inputPerM * TYPICAL_QUESTION_TOKENS) / 1_000_000 +
    (outputPerM * TYPICAL_ANSWER_TOKENS) / 1_000_000
  );
}

function money(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `<$0.01`;
  return `$${usd.toFixed(2)}`;
}

export interface CostSubject {
  id?: string;
  inputPerM?: number;
  outputPerM?: number;
  contextLength?: number | null;
  isModerated?: boolean;
  leaksReasoning?: boolean;
  isAlias?: boolean;
}

/**
 * The hover text for one model.
 *
 * Plain newlines rather than markup because this goes in a `title`
 * attribute — which is deliberate: a native tooltip needs no portal, no
 * z-index fight with the dropdown it lives inside, and works on a control the
 * user is already keyboard-focusing.
 */
export function costTooltip(m: CostSubject): string {
  const lines: string[] = [];
  if (m.id) lines.push(m.id);

  if (m.inputPerM === undefined || m.outputPerM === undefined) {
    lines.push("Price unknown — this model is not in the catalogue.");
    return lines.join("\n");
  }

  if (m.inputPerM === 0 && m.outputPerM === 0) {
    lines.push("No charge.");
    lines.push(
      "Free models route to hosts that keep prompts, often to train on — " +
        "which is why they are free. Vault will not send your lore to one " +
        "until you opt that model in."
    );
  } else {
    lines.push(`Input   ${formatRatePerM(m.inputPerM)} per million tokens`);
    lines.push(`Output  ${formatRatePerM(m.outputPerM)} per million tokens`);
    lines.push(
      `≈ ${money(estimateQuestionCost(m.inputPerM, m.outputPerM))} for a ` +
        `${formatContext(TYPICAL_QUESTION_TOKENS)}-token question`
    );
  }

  if (m.contextLength) lines.push(`Context ${formatContext(m.contextLength)} tokens`);
  if (m.isAlias) lines.push("Floating alias — follows this vendor's current model.");
  if (m.isModerated) lines.push("Moderated host — may refuse mature campaign content.");
  if (m.leaksReasoning) lines.push("Known to put its reasoning in the reply.");
  return lines.join("\n");
}

/** Hover text for a collapsed vendor group: the range inside it. */
export function vendorTooltip(
  label: string,
  models: Array<{ inputPerM?: number; outputPerM?: number }>
): string {
  const priced = models.filter(m => m.inputPerM !== undefined) as Array<{
    inputPerM: number;
    outputPerM: number;
  }>;
  const count = `${models.length} model${models.length === 1 ? "" : "s"}`;
  if (priced.length === 0) return `${label} — ${count}, prices unknown`;

  const costs = priced.map(m => estimateQuestionCost(m.inputPerM, m.outputPerM)).sort((a, b) => a - b);
  const freeCount = priced.filter(m => m.inputPerM === 0 && m.outputPerM === 0).length;
  const lines = [`${label} — ${count}`];
  if (freeCount > 0) lines.push(`${freeCount} free to run`);
  lines.push(
    `Per ${formatContext(TYPICAL_QUESTION_TOKENS)}-token question: ` +
      `${money(costs[0])} to ${money(costs[costs.length - 1])}`
  );
  return lines.join("\n");
}
