// Where else is this name written down?
//
// The step a person does by searching the whole corpus for a name and reading
// each hit. It is the tier that similarity cannot reach: a unit's digest
// summarises what that unit is ABOUT, so a note about one subject that
// mentions another once, in passing, carries no trace of the second name in
// its digest — and no embedding of that digest can rank it against a question
// about the second subject.
//
// Measured on a large structured corpus: 965 references are plaintext-only,
// naming a subject without linking to it. A link-graph walk misses all of
// them. This index does not, and it is exhaustive rather than probabilistic —
// any unit naming a subject by a known surface form is found, every time.
//
// What it deliberately does NOT do is find a passage that refers to a subject
// without naming it. Nothing deterministic can. That case belongs to the
// embedding tier, and the two should never be described to the user as though
// they offered the same guarantee.

import { scanForms, type SurfaceIndex } from "./surface-index";

export const MENTION_INDEX_VERSION = 1;

/**
 * A form occurring in more than this share of units is vocabulary, not a
 * name, and its postings are dropped.
 *
 * Set high on purpose. A central subject in a real campaign is genuinely
 * mentioned everywhere — one deity in the measured corpus appears in 27% of
 * units — and treating that as noise would gut retrieval for exactly the
 * subjects people ask about most. This is a backstop for a heading that
 * slipped past the structural-title list, not a relevance tuner.
 */
export const DF_CAP = 0.6;

/** A form must clear this many units before the cap can apply, so a tiny
 *  corpus doesn't suppress a name for appearing in two of three units. */
const DF_CAP_MIN_UNITS = 12;

export interface MentionPosting {
  unitId: string;
  /** Times the form occurs in that unit. Ranks units within a tier: a passing
   *  reference and a sustained discussion are not equally worth including. */
  count: number;
}

export interface MentionIndex {
  version: number;
  byForm: Map<string, MentionPosting[]>;
  /** Forms suppressed by DF_CAP. Reported rather than silently dropped: a
   *  name missing from retrieval is exactly the kind of thing a user should
   *  be able to see an explanation for. */
  suppressed: string[];
  unitsScanned: number;
}

export interface MentionBuildOptions {
  /** Units whose own text should not count as a mention of themselves. On by
   *  default — the subject's own unit is retrieved directly, and counting it
   *  here would rank it twice. */
  excludeSelf?: boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Scan every unit once for every indexed name.
 *
 * One pass per unit, not one pass per (unit, name): `scanForms` walks the
 * unit's tokens and looks each n-gram up, so the cost is the corpus size
 * times the longest name, independent of how many names there are. A corpus
 * that grows its cast does not get quadratically slower to index.
 */
export function buildMentionIndex(
  units: Array<{ id: string; hash: string }>,
  surface: SurfaceIndex,
  bodyOf: (unitId: string) => string | null,
  opts: MentionBuildOptions = {}
): MentionIndex {
  const excludeSelf = opts.excludeSelf !== false;
  const byForm = new Map<string, MentionPosting[]>();

  let done = 0;
  for (const unit of units) {
    opts.onProgress?.(done++, units.length);
    const body = bodyOf(unit.id);
    if (!body) continue;

    const counts = new Map<string, number>();
    for (const m of scanForms(surface, body)) {
      if (excludeSelf && m.entry.unitIds.length === 1 && m.entry.unitIds[0] === unit.id) continue;
      counts.set(m.form, (counts.get(m.form) ?? 0) + 1);
    }
    for (const [form, count] of counts) {
      const list = byForm.get(form);
      if (list) list.push({ unitId: unit.id, count });
      else byForm.set(form, [{ unitId: unit.id, count }]);
    }
  }

  // Drop forms that turned out to be vocabulary rather than names.
  const suppressed: string[] = [];
  if (units.length >= DF_CAP_MIN_UNITS) {
    const ceiling = units.length * DF_CAP;
    for (const [form, postings] of byForm) {
      if (postings.length > ceiling) {
        suppressed.push(form);
        byForm.delete(form);
      }
    }
  }

  // Most-mentioned first, so a caller taking the top N takes the strongest.
  for (const postings of byForm.values()) {
    postings.sort((a, b) => b.count - a.count || a.unitId.localeCompare(b.unitId));
  }

  return {
    version: MENTION_INDEX_VERSION,
    byForm,
    suppressed: suppressed.sort(),
    unitsScanned: units.length,
  };
}

/** A subject to look up, with every name it goes by.
 *
 *  Lookups are by SUBJECT rather than by form for the same reason passage
 *  extraction is: the corpus writes a subject several ways, and a caller that
 *  passed only the name the asker used would miss every mention that used an
 *  epithet instead — which is most of the ones worth finding. */
export interface MentionSubject {
  id: string;
  forms: string[];
}

export interface MentioningUnit {
  unitId: string;
  /** Total occurrences across every form of every requested subject. */
  count: number;
  /** How many distinct SUBJECTS this unit names. A unit naming both subjects
   *  of a two-subject question is where the answer usually is. */
  subjectsMatched: number;
}

/**
 * Units naming any of the given subjects, strongest first.
 *
 * Ranked on subjects matched before raw count: for "how does A know B", a
 * unit naming both once beats a unit naming A twenty times, because the
 * question is about the intersection and only the first unit can answer it.
 */
export function unitsMentioning(
  index: MentionIndex,
  subjects: MentionSubject[],
  exclude: Set<string> = new Set()
): MentioningUnit[] {
  const acc = new Map<string, { count: number; subjects: Set<string> }>();
  for (const subject of subjects) {
    for (const form of new Set(subject.forms)) {
      for (const posting of index.byForm.get(form) ?? []) {
        if (exclude.has(posting.unitId)) continue;
        const cur = acc.get(posting.unitId) ?? { count: 0, subjects: new Set<string>() };
        cur.count += posting.count;
        cur.subjects.add(subject.id);
        acc.set(posting.unitId, cur);
      }
    }
  }
  return [...acc.entries()]
    .map(([unitId, v]) => ({ unitId, count: v.count, subjectsMatched: v.subjects.size }))
    .sort(
      (a, b) =>
        b.subjectsMatched - a.subjectsMatched ||
        b.count - a.count ||
        a.unitId.localeCompare(b.unitId)
    );
}

/** Serialisable form, for persisting alongside the unit index. Maps do not
 *  survive JSON, and the postings are the expensive part to rebuild. */
export function serialiseMentionIndex(index: MentionIndex): unknown {
  return {
    version: index.version,
    byForm: [...index.byForm.entries()],
    suppressed: index.suppressed,
    unitsScanned: index.unitsScanned,
  };
}

export function deserialiseMentionIndex(raw: unknown): MentionIndex | null {
  const r = raw as {
    version?: number;
    byForm?: Array<[string, MentionPosting[]]>;
    suppressed?: string[];
    unitsScanned?: number;
  };
  if (!r || r.version !== MENTION_INDEX_VERSION || !Array.isArray(r.byForm)) return null;
  return {
    version: r.version,
    byForm: new Map(r.byForm),
    suppressed: r.suppressed ?? [],
    unitsScanned: r.unitsScanned ?? 0,
  };
}
