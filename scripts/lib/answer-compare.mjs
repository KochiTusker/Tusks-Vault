// Build the prompts a retrieval plan would actually send, and ask a model.
//
// Separated from the footprint comparison because the two answer different
// questions. Footprint is exact arithmetic and needs no model; this asks
// whether the smaller prompt still ANSWERS, which no amount of arithmetic
// can tell you. A cheaper prompt that dropped the evidence is not a saving,
// it is a worse bot, and only reading the answers catches that.
//
// Runs through the Claude Code subscription rather than a metered key: these
// comparisons want the full-corpus baseline too, which is expensive per call
// and free on a subscription.

const RULES =
  "You are a lore assistant for a tabletop campaign. Answer ONLY from the source " +
  "material below. Every factual claim must end with a [filename] citation. If the " +
  "answer is not in the sources, say so plainly instead of guessing. Be concise.";

/** Matches the loader's cap, so the baseline is what Vault actually sends. */
export const KB_CAP = 500_000;

/**
 * Assemble the prompt from a retrieval plan.
 *
 * `deps` carries the retrieval functions so this module stays free of import
 * order concerns and can be pointed at a different tier set later.
 */
export function buildPlanPrompt(corpus, question, deps) {
  const {
    resolveQuestion,
    extractCandidateNames,
    surfaceIndexOfNames,
    mergeSurfaceIndexes,
    unresolvedUnitId,
    unitsMentioning,
    extractPassages,
    resolveTemporalQuery,
    detectCohortQuery,
    resolveCohort,
    formsOfSubject,
  } = deps;

  const subjects = resolveQuestion(corpus.surface, question);
  const candidates = extractCandidateNames(corpus.surface, question);
  const adhoc = surfaceIndexOfNames(candidates);
  const scanIndex = mergeSurfaceIndexes(corpus.surface, adhoc);
  const subjIds = new Set([...subjects.flatMap(s => s.unitIds), ...candidates.map(unresolvedUnitId)]);
  const realIds = new Set(subjects.flatMap(s => s.unitIds));
  const unitById = new Map(corpus.units.map(u => [u.id, u]));
  const blocks = [];

  for (const id of realIds) {
    const u = unitById.get(id);
    if (u) blocks.push(`[SOURCE DOCUMENT: ${u.file}]\n${corpus.bodies.get(id) ?? ""}`);
  }

  const temporal = resolveTemporalQuery(question, corpus.sessions);
  for (const sess of temporal.sessions) {
    for (const id of sess.unitIds) {
      const u = unitById.get(id);
      if (u) blocks.push(`[SOURCE DOCUMENT: ${u.file} > ${u.title}]\n${corpus.bodies.get(id) ?? ""}`);
    }
  }

  if (detectCohortQuery(question).isCohort) {
    const sessionTexts = corpus.sessions.map(s => ({
      session: `${s.campaign}#${s.number}`,
      text: s.unitIds.map(id => corpus.bodies.get(id) ?? "").join("\n"),
    }));
    const cohort = resolveCohort({ sessionTexts, surface: corpus.surface });
    // The cohort note goes in whether or not members were found: an answer
    // that ranked an empty or guessed field must say so.
    blocks.push(`[COHORT] ${cohort.note}`);
    for (const m of cohort.members) {
      if (!m.unitId) continue;
      const u = unitById.get(m.unitId);
      if (u) blocks.push(`[SOURCE DOCUMENT: ${u.file}]\n${(corpus.bodies.get(m.unitId) ?? "").slice(0, 4000)}`);
    }
  }

  if (subjIds.size > 0) {
    const mentioning = unitsMentioning(
      corpus.mentions,
      subjects.map(s => ({ id: s.unitIds[0], forms: formsOfSubject(corpus, s) })),
      realIds
    );
    if (candidates.length > 0) {
      const seen = new Set(mentioning.map(m => m.unitId));
      for (const u of corpus.units) {
        if (seen.has(u.id) || realIds.has(u.id)) continue;
        const body = corpus.bodies.get(u.id);
        if (body && extractPassages(body, adhoc, { limit: 1 }).length > 0) {
          mentioning.push({ unitId: u.id, count: 1, subjectsMatched: 1 });
        }
      }
    }
    for (const m of mentioning.slice(0, 40)) {
      const body = corpus.bodies.get(m.unitId);
      if (!body) continue;
      const u = unitById.get(m.unitId);
      for (const psg of extractPassages(body, scanIndex, { subjects: subjIds, limit: 4 })) {
        const where = `${u?.file ?? m.unitId}${psg.heading ? ` > ${psg.heading}` : ""}`;
        blocks.push(`[SOURCE DOCUMENT: ${where}]\n${psg.text}`);
      }
    }
  }

  return `${RULES}\n\n${blocks.join("\n\n")}\n\nQUESTION: ${question}`;
}

/** The baseline: concatenate everything, capped — what Vault sends today. */
export function buildFullPrompt(corpus, question) {
  let text = "";
  for (const u of corpus.units) {
    if (text.length > KB_CAP) break;
    text += `\n[SOURCE DOCUMENT: ${u.file}]\n${corpus.bodies.get(u.id) ?? ""}\n`;
  }
  return `${RULES}\n\n${text.slice(0, KB_CAP)}\n\nQUESTION: ${question}`;
}

/** One call, never throwing — a failed run is a result to report, not a
 *  reason to lose the runs that succeeded. */
export async function ask(runClaudeCode, label, prompt, model = "sonnet") {
  const started = Date.now();
  try {
    const r = await runClaudeCode({ prompt, model });
    return { label, chars: prompt.length, ms: Date.now() - started, text: (r.text ?? "").trim() };
  } catch (err) {
    return { label, chars: prompt.length, ms: Date.now() - started, text: `ERROR: ${err.message}` };
  }
}
