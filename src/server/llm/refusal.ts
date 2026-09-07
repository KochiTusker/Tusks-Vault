// Did the model decline, or did it answer?
//
// Sampling on the Claude Code CLI cannot be pinned — it exposes no
// temperature, top-p or seed flag, so a question sitting near the model's own
// refusal boundary is answered on one run and declined on the next. That
// variance is not removable. What IS removable is the app treating the two
// outcomes identically: a decline currently reaches Discord looking exactly
// like chronicle content, in the archivist's voice, with no signal that the
// question was never actually answered.
//
// So the generation stays non-deterministic and the HANDLING becomes
// deterministic. Detect the decline, label it, and surface the rephrase the
// model already offered.
//
// Precision over recall, deliberately. A false positive tells a DM their
// perfectly good answer was refused, which is worse than missing one: the
// answer is still shown either way, so a miss costs a label while a false
// alarm costs trust in the label. Everything below is anchored to the opening
// of the response, because a model that declines says so first — in the
// middle of a paragraph, the same words are usually the chronicle's own
// characters refusing each other.

/** How much of the response can carry the decline. A model that is declining
 *  leads with it; text this far in is the chronicle talking. */
const OPENING_CHARS = 400;

export type RefusalKind =
  /** Objected to how the question was worded, not to the chronicle. */
  | "phrasing"
  /** Objected to the subject matter being asked for. */
  | "content"
  /** Declined without saying which. */
  | "unspecified";

export interface RefusalVerdict {
  refused: boolean;
  kind?: RefusalKind;
  /** The sentence that gave it away, for logs and for the dashboard. */
  matched?: string;
}

/**
 * First-person declines about THIS request.
 *
 * Each requires a first-person subject and a refusal verb adjacent to it, so
 * narration like "the guard won't open the gate" cannot match. `I can't find`
 * and `I don't know` are excluded on purpose — those are answers about the
 * archive's contents, which Rule 3's lore-gap phrase already covers.
 */
const REFUSAL_PATTERNS: Array<{ re: RegExp; kind: RefusalKind }> = [
  // Explicit, unambiguous declines.
  { re: /\bI\s+(?:will\s+not|won't|am\s+not\s+going\s+to|refuse\s+to)\s+(?:answer|rank|apply|use|repeat|write|produce|engage)\b/i, kind: "unspecified" },
  { re: /\bI\s+decline\s+to\b/i, kind: "unspecified" },
  { re: /\bI\s+(?:can't|cannot|won't)\s+help\s+with\s+(?:that|this)\b/i, kind: "unspecified" },
  { re: /\bI'?m\s+not\s+(?:going\s+to|willing\s+to)\s+\w+/i, kind: "unspecified" },

  // Objections aimed at the wording of the question.
  { re: /\b(?:that|this)\s+word\s+is\s+a\s+slur\b/i, kind: "phrasing" },
  { re: /\bit'?s\s+a\s+slur\b/i, kind: "phrasing" },
  { re: /\bwithout\s+the\s+slur\b/i, kind: "phrasing" },
  { re: /\brephrase\s+(?:the\s+)?(?:question|it)\b/i, kind: "phrasing" },
  { re: /\bif\s+you\s+(?:want|ask)\b[^.\n]{0,80}\bwithout\b/i, kind: "phrasing" },

  // Objections aimed at the subject matter.
  { re: /\bI\s+(?:won't|will\s+not|can't|cannot)\s+(?:describe|depict|narrate|detail)\b/i, kind: "content" },
  { re: /\bnot\s+something\s+I\s+(?:can|will)\s+(?:help\s+with|provide|write)\b/i, kind: "content" },
];

/**
 * Classify a model response.
 *
 * Returns `refused: false` for anything it is not confident about — see the
 * precision note at the top of the file.
 */
export function detectRefusal(text: string): RefusalVerdict {
  const opening = (text ?? "").slice(0, OPENING_CHARS);
  if (!opening.trim()) return { refused: false };

  // Match against a copy with quoted dialogue blanked out. The model declining
  // writes in its own voice; a character declining is in quotation marks, and
  // `"I decline to treat with you," said the seneschal` is chronicle content
  // that must not be reported as the archive refusing the DM.
  const searchable = maskQuoted(opening);

  let best: RefusalVerdict | null = null;
  for (const { re, kind } of REFUSAL_PATTERNS) {
    const hit = re.exec(searchable);
    if (!hit) continue;
    // A named kind beats "unspecified": both may match the same response, and
    // "declined the phrasing" is the more useful of the two to report.
    if (!best || (best.kind === "unspecified" && kind !== "unspecified")) {
      best = { refused: true, kind, matched: sentenceAround(opening, hit.index) };
    }
  }
  return best ?? { refused: false };
}

/**
 * Blank the inside of double-quoted spans, preserving length so match indices
 * still point into the original string.
 *
 * Double quotes only. Apostrophes are load-bearing in the very phrases being
 * matched — `won't`, `I'm`, `can't` — so treating a single quote as a dialogue
 * delimiter would blank the patterns themselves. Curly quotes are included
 * because a model narrating dialogue reaches for them as readily as straight
 * ones. An unclosed quote masks to the end of the opening, which errs toward
 * a miss rather than a false alarm — the trade this file is built around.
 */
function maskQuoted(text: string): string {
  const out = text.split("");
  let openAt = -1;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    const isOpen = ch === '"' || ch === "“";
    const isClose = ch === '"' || ch === "”";
    if (openAt === -1) {
      if (isOpen) openAt = i;
    } else if (isClose) {
      for (let j = openAt + 1; j < i; j++) out[j] = " ";
      openAt = -1;
    }
  }
  if (openAt !== -1) {
    for (let j = openAt + 1; j < out.length; j++) out[j] = " ";
  }
  return out.join("");
}

/** The sentence containing `index`, trimmed — enough context to see why the
 *  detector fired without dumping the whole response into a log line. */
function sentenceAround(text: string, index: number): string {
  const start = Math.max(
    text.lastIndexOf(".", index),
    text.lastIndexOf("\n", index),
    -1
  ) + 1;
  let end = text.length;
  for (const mark of [". ", ".\n", "\n"]) {
    const at = text.indexOf(mark, index);
    if (at !== -1 && at + 1 < end) end = at + 1;
  }
  return text.slice(start, end).trim();
}
