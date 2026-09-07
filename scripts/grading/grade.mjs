// Pure scoring. No network, no model, no filesystem — so it is unit-testable
// and a grade never depends on the weather.

import { CASES, CITATION_RE, LORE_GAP_PHRASE } from "./cases.mjs";

/**
 * @typedef {Object} CaseResult
 * @property {string} id
 * @property {boolean} answered
 * @property {boolean|null} correct      null when the case has no expect/reject
 * @property {boolean|null} cited        null for lore-gap cases (nothing to cite)
 * @property {boolean|null} citedRight
 * @property {boolean|null} gapHandled   null for non-gap cases
 * @property {string[]} failures         human-readable, for the report
 */

function norm(s) {
  return (s ?? "").toLowerCase();
}

/** Did the model emit the exact refusal phrase the prompt specifies?
 *
 *  Loose on case and punctuation, strict on the words. A paraphrase reads
 *  fine to a human and silently fails to log the gap downstream, so it is
 *  not a pass. */
export function saysLoreGap(text) {
  return norm(text).includes(norm(LORE_GAP_PHRASE));
}

/** Does the answer cite this specific file?
 *
 *  Matches the basename inside any bracket, because a model may cite
 *  `[Dunmar.md]` or `[SOURCE DOCUMENT: Dunmar.md]` or `[Sessions/Dunmar.md]`
 *  and all three point a reader at the same file. */
export function citesFile(text, file) {
  if (!file) return null;
  const base = file.split("/").pop();
  const brackets = [...(text ?? "").matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
  return brackets.some(b => norm(b).includes(norm(base)));
}

/** @returns {CaseResult} */
export function gradeCase(testCase, answer) {
  const text = answer ?? "";
  const lower = norm(text);
  const failures = [];
  const answered = text.trim().length > 0;
  if (!answered) failures.push("empty response");

  let correct = null;
  let gapHandled = null;

  if (testCase.loreGap) {
    // Two independent requirements, and the second is the one that matters.
    // A model can emit the refusal phrase AND then helpfully speculate; that
    // is not a pass, because the speculation is what reaches the table.
    const said = saysLoreGap(text);
    const invented = (testCase.reject ?? []).filter(r => lower.includes(norm(r)));
    gapHandled = said && invented.length === 0;
    if (!said) failures.push("did not emit the lore-gap phrase");
    if (invented.length > 0) failures.push(`invented: ${invented.join(", ")}`);
  } else {
    const missing = (testCase.expect ?? []).filter(e => !lower.includes(norm(e)));
    const forbidden = (testCase.reject ?? []).filter(r => lower.includes(norm(r)));
    // `expect` is an ALL, except where a case lists interchangeable spellings
    // of one fact ("four hundred" / "400") — those are handled by listing them
    // and requiring any one, which is why the check below is per-case.
    const anyOf = testCase.expectAny === true;
    const expectOk = anyOf
      ? (testCase.expect ?? []).some(e => lower.includes(norm(e)))
      : missing.length === 0;
    correct = expectOk && forbidden.length === 0;
    if (!expectOk) failures.push(`missing: ${missing.join(", ")}`);
    if (forbidden.length > 0) failures.push(`said: ${forbidden.join(", ")}`);
  }

  // Citation is only meaningful for a case that HAS a source. Asking a
  // lore-gap answer to cite something would be asking it to cite the absence.
  const cited = testCase.loreGap ? null : CITATION_RE.test(text);
  const citedRight = testCase.loreGap ? null : citesFile(text, testCase.citeFile);
  if (cited === false) failures.push("no citation marker");
  else if (citedRight === false) failures.push(`cited the wrong file (wanted ${testCase.citeFile})`);

  return { id: testCase.id, answered, correct, cited, citedRight, gapHandled, failures };
}

/** Roll case results into one model's scorecard.
 *
 *  Reported as separate rates rather than one number, because they fail
 *  independently and for different reasons: a model can be accurate and
 *  uncitable, or scrupulous about citations and a fabulist about gaps. A
 *  single blended score hides exactly the trade-off worth seeing.
 */
export function summarise(results) {
  const rate = pick => {
    const applicable = results.filter(r => pick(r) !== null);
    if (applicable.length === 0) return null;
    return applicable.filter(r => pick(r) === true).length / applicable.length;
  };
  return {
    cases: results.length,
    answered: rate(r => (r.answered ? true : false)),
    accuracy: rate(r => r.correct),
    citation: rate(r => r.cited),
    citationPrecision: rate(r => r.citedRight),
    gapDiscipline: rate(r => r.gapHandled),
    failures: results.filter(r => r.failures.length > 0).length,
  };
}

export { CASES };
