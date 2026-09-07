// "Which of them would…" — questions about a group rather than a subject.
//
// A table asks these constantly: who is the most reckless, who would lose a
// fight to a goose, which of them is most likely to lie to a guard. Vault
// already has a Speculative Mode that permits the answer; what it has never
// had is the RETRIEVAL for one. The prompt says "reason from established
// personalities" and then retrieval hands over the personalities of nobody,
// because the question names no subject to look up.
//
// These questions need the opposite shape from every other tier. A question
// about one subject wants depth: their note, their mentions, their history. A
// comparative question wants BREADTH — a little about each candidate, equally
// — because the answer is a ranking and a ranking over a partial field is
// simply wrong. Worse, it is invisibly wrong: asked who is the most violent,
// a model given four of seven characters will confidently name one of the
// four and cite real evidence for it.
//
// That is why the cohort is reported rather than assumed. If Vault has the
// roster wrong, the user must be able to see that in the answer.

import { scanForms, type SurfaceIndex } from "./surface-index";

/**
 * Names that attribute speech to the person running the game, not to a
 * character in it.
 *
 * Kept deliberately small and generic. Tables name their GM every which way,
 * and the cost of missing one is that the GM turns up as a party member,
 * which the reported cohort makes visible. The cost of over-matching is a
 * real character being silently excluded, which it does not.
 */
export const GM_SPEAKER_NAMES = new Set([
  "dm",
  "gm",
  "dungeon master",
  "game master",
  "games master",
  "narrator",
  "storyteller",
  "referee",
  "keeper",
  "the dm",
  "the gm",
]);

/** Line-start speech attribution: `Name:` or `Name (player):`. Up to four
 *  words, because a character name runs long and a sentence does not stop to
 *  put a colon after its fourth word. */
const SPEAKER_RE =
  /^[ \t]*([\p{Lu}][\p{L}'’-]*(?:[ \t]+[\p{Lu}][\p{L}'’-]*){0,3})[ \t]*(?:\([^)]{1,40}\))?[ \t]*:/gmu;

export interface SpeakerTally {
  name: string;
  /** Distinct sessions this name was attributed speech in. The unit of
   *  evidence is the session, not the line: one long monologue is not seven
   *  sessions of presence. */
  sessions: number;
}

/**
 * Who the session records attribute speech to.
 *
 * A transcript names its speakers, and the people speaking every week are the
 * players. This is the strongest available signal for "who is the party" that
 * asks nothing of the user and assumes nothing about how their notes are
 * organised — it reads a convention transcripts already follow rather than
 * one Vault imposes.
 *
 * It only works where transcripts exist. A campaign written up purely as
 * prose chronicles yields nothing here, which is why it is one layer of
 * several rather than the answer.
 */
export function attributedSpeakers(sessionTexts: Array<{ session: string; text: string }>): SpeakerTally[] {
  const seen = new Map<string, Set<string>>();
  for (const { session, text } of sessionTexts) {
    for (const m of text.matchAll(SPEAKER_RE)) {
      const name = m[1].trim().replace(/\s+/g, " ");
      if (GM_SPEAKER_NAMES.has(name.toLowerCase())) continue;
      const set = seen.get(name) ?? new Set<string>();
      set.add(session);
      seen.set(name, set);
    }
  }
  return [...seen.entries()]
    .map(([name, s]) => ({ name, sessions: s.size }))
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
}

/**
 * Fold a first name into the full name it abbreviates.
 *
 * Transcripts abbreviate once the table knows who is who, so the same player
 * appears under two names and would otherwise occupy two seats in the roster.
 * Folding is by prefix on whole words, and only into a name that is already
 * better attested — a shortening is evidence about a longer name, never the
 * other way round.
 */
export function foldShortNames(tallies: SpeakerTally[]): SpeakerTally[] {
  const out: SpeakerTally[] = [];
  for (const t of tallies) {
    const host = out.find(
      o =>
        o.sessions >= t.sessions &&
        (o.name.toLowerCase().startsWith(`${t.name.toLowerCase()} `) ||
          t.name.toLowerCase().startsWith(`${o.name.toLowerCase()} `))
    );
    if (host) {
      // Keep the longer spelling: it is the one a reader recognises.
      if (t.name.length > host.name.length) host.name = t.name;
      continue;
    }
    out.push({ ...t });
  }
  return out;
}

export type CohortBasis = "roster" | "speakers" | "none";

export interface CohortMember {
  name: string;
  /** Unit this name resolves to, when the corpus has one for them. Absent is
   *  normal and not a problem: a character can be in every session and still
   *  have no page of their own. */
  unitId?: string;
  /** Sessions they were heard in. Zero for a roster entry never attributed. */
  sessions: number;
}

export interface Cohort {
  members: CohortMember[];
  basis: CohortBasis;
  /** True only when the user told us the roster. Everything else is a guess
   *  that happens to be a good one. */
  certain: boolean;
  /** One line for the prompt AND the user, naming who was considered. */
  note: string;
}

/** Minimum sessions before an attributed name counts as a regular. One
 *  appearance is a guest, not a party member. */
export const REGULAR_MIN_SESSIONS = 2;

/** Largest inferred party. Beyond this the tail is guest stars, and a
 *  comparison over twenty candidates is not a comparison. */
export const MAX_INFERRED_PARTY = 8;

export interface ResolveCohortInput {
  /** Names the user has declared. Wins outright when present. */
  roster?: string[];
  sessionTexts?: Array<{ session: string; text: string }>;
  /** Used to attach names to units, so the planner can fetch their notes. */
  surface?: SurfaceIndex;
}

/**
 * Who the group is.
 *
 * Layered, most trustworthy first, and the layer used is reported:
 *
 *   1. A roster the user set. Exact, and the only one marked certain — the
 *      GM knows who is at their table and inference never beats being told.
 *   2. Speech attribution across sessions. Strong where transcripts exist.
 *
 * Raw mention frequency is deliberately NOT a layer. Measured on a real
 * corpus it ranks characters, countries and factions interleaved with no
 * usable cut — the most-named subjects were a player character, two NPCs, a
 * country and a faction, in that order, with no drop-off to separate them.
 * A roster built from it would be wrong in a way the answer could not show.
 */
export function resolveCohort(input: ResolveCohortInput): Cohort {
  const attach = (name: string): string | undefined => {
    if (!input.surface) return undefined;
    const hits = scanForms(input.surface, name);
    return hits.length === 1 ? hits[0].entry.unitIds[0] : undefined;
  };

  const roster = (input.roster ?? []).map(n => n.trim()).filter(Boolean);
  if (roster.length > 0) {
    return {
      members: roster.map(name => ({ name, unitId: attach(name), sessions: 0 })),
      basis: "roster",
      certain: true,
      note: `Considering the party as set in Vault: ${roster.join(", ")}.`,
    };
  }

  const heard = foldShortNames(attributedSpeakers(input.sessionTexts ?? []));
  const regulars = heard.filter(t => t.sessions >= REGULAR_MIN_SESSIONS).slice(0, MAX_INFERRED_PARTY);
  if (regulars.length > 0) {
    return {
      members: regulars.map(t => ({ name: t.name, unitId: attach(t.name), sessions: t.sessions })),
      basis: "speakers",
      certain: false,
      note:
        `Working from who speaks in the session records: ${regulars.map(t => t.name).join(", ")}. ` +
        `If that is not the party, set the roster in Vault and ask again.`,
    };
  }

  return {
    members: [],
    basis: "none",
    certain: false,
    note:
      "I could not work out who the party is from the lore — the session records do not attribute " +
      "speech, and no roster is set in Vault. Set one and ask again.",
  };
}

export interface CohortQuery {
  /** True when the question compares members of a group rather than asking
   *  about one subject. */
  isCohort: boolean;
  /** The comparison being drawn, for the prompt: "most violent", "most likely
   *  to lie". Empty when the shape matched but the trait did not parse. */
  trait: string;
}

const GROUP_WORDS = /\b(part(?:y|ies)|group|crew|team|company|band|others|them|adventurers)\b/i;

/**
 * Does this question rank a group?
 *
 * Pattern-matched rather than modelled. The shapes are few — a superlative, a
 * likelihood, a "which of them" — and the cost of a miss is a fallback to
 * ordinary retrieval rather than a wrong answer, so a cheap test that is
 * usually right beats a model call that is nearly always right and always
 * slow.
 */
export function detectCohortQuery(question: string): CohortQuery {
  const q = question.trim();
  const lower = q.toLowerCase();

  const superlative = lower.match(/\b(?:the\s+)?(most|least)\s+([a-z-]+(?:\s+[a-z-]+){0,2})/);
  const likely = /\b(most|least)\s+likely\s+to\b/.test(lower);
  const whichOf = /\b(which|who)\s+(?:one\s+)?(?:of\s+)?(?:the\s+)?\w*\s*(?:member|character|player|of them|of the)\b/.test(lower);
  const wouldWin = /\bwho\s+(?:would|could|might|will)\b/.test(lower);
  const hasGroup = GROUP_WORDS.test(lower);

  // A superlative alone is enough only when a group is named or implied; "who
  // is the most senior officer of the watch" is a lookup, not a ranking.
  const isCohort =
    likely || whichOf || (Boolean(superlative) && hasGroup) || (wouldWin && hasGroup);

  return { isCohort, trait: superlative ? cleanTrait(superlative[1], superlative[2]) : "" };
}

/** Words that carry the question's grammar rather than the quality being
 *  compared. "the most violent person in the party" is asking about violence,
 *  not about "violent person in". */
const TRAIT_TAIL_WORDS = new Set([
  "person", "people", "member", "members", "character", "characters", "player",
  "players", "one", "in", "of", "the", "a", "an", "among", "amongst", "from",
  "party", "group", "crew", "team", "them", "us", "to", "at", "would", "will",
  "is", "are", "was", "were", "and", "or", "who", "that",
]);

function cleanTrait(degree: string, tail: string): string {
  const words = tail.split(/\s+/).filter(Boolean);
  while (words.length > 1 && TRAIT_TAIL_WORDS.has(words[words.length - 1])) words.pop();
  // A trait that reduced to nothing but grammar carries no comparison.
  if (words.length === 1 && TRAIT_TAIL_WORDS.has(words[0])) return "";
  return `${degree} ${words.join(" ")}`.trim();
}
