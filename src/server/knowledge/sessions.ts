// When did this happen, and which session was it?
//
// A large share of the questions a table actually asks are temporal rather
// than about a subject: "what happened last session", "remind me what we did
// in session twelve", "where did we leave off". None of them name an entity,
// so name resolution finds nothing and similarity ranks every session log
// about equally — they are all, after all, session logs.
//
// What answers them is ORDER. A session log carries its position in two
// places nobody has to be asked to provide: a number, and a date. Both are
// already written into the filenames and headings people use without being
// told to, so this reads them rather than requiring anyone to tag anything.
//
// The awkward part is that a lore folder can hold more than one campaign, and
// their numbering collides — a "session 14" exists in each. "Last session" is
// then genuinely ambiguous, and the honest response is to answer for the most
// recent one and say which that was, not to silently merge two campaigns'
// histories into one timeline.

import type { LoreUnit } from "./units";

export interface SessionMarker {
  /** Units carrying this session's text. A long log is split across several
   *  units, and all of them are one session — listing each part separately
   *  would report "the last 3 sessions" as three slices of the same evening. */
  unitIds: string[];
  file: string;
  title: string;
  /** Session number, when one is written down. */
  number?: number;
  /** ISO date (YYYY-MM-DD), when one is written down. */
  date?: string;
  /** Normalised grouping key for "which campaign". Compared, never shown. */
  campaign: string;
  /** The campaign as it is actually written on disk, for saying out loud.
   *  The key is lower-cased and stripped of "session logs"-style suffixes so
   *  two spellings of one campaign match; that form reads badly in a
   *  sentence, so the original is kept alongside it. */
  campaignLabel: string;
}

/** `Session-27`, `SESSION 23`, `Session 5`, `s12` at a word boundary. */
const NUMBER_RE = /\bsessions?[\s._-]*(\d{1,3})\b/i;
/** A bare `S12`-style marker, only where "session" is already established. */
const SHORT_NUMBER_RE = /\bs(\d{1,3})\b/i;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

/** Does this path or title look like a session record at all? */
export function looksLikeSession(text: string): boolean {
  return /\bsessions?\b/i.test(text);
}

function parseNumber(text: string): number | undefined {
  const m = text.match(NUMBER_RE) ?? (looksLikeSession(text) ? text.match(SHORT_NUMBER_RE) : null);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function parseDate(text: string): string | undefined {
  const m = text.match(ISO_DATE_RE);
  if (!m) return undefined;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${y}-${mo}-${d}`;
}

/**
 * The campaign a session belongs to, as a comparison key.
 *
 * Sessions filed in per-campaign folders take the folder; sessions living as
 * headings inside one document take that document. Both are the same idea —
 * the nearest container that separates this run of sessions from another —
 * and neither asks the user to declare anything.
 *
 * The key is normalised because one campaign is routinely stored two ways at
 * once: the early sessions archived into a single combined log, the recent
 * ones as separate dated files in a folder named after the same campaign.
 * Compared literally, "<Campaign> - Session Logs" and "<Campaign>" look like
 * two different runs, and the corpus appears to hold twice the campaigns it
 * does — which would make every "last session" answer ambiguous for no
 * reason.
 *
 * Returns "" when nothing distinguishes a run, meaning "the only campaign
 * here". An empty key is not a campaign nobody named; it is the absence of a
 * distinction, and the difference matters when deciding whether to warn.
 */
export function campaignKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[\s_-]*\b(session|sessions)?[\s_-]*\b(logs?|records?|transcripts?)\b/g, " ")
    .replace(/\bsessions?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function campaignOf(file: string): { key: string; label: string } {
  const of = (raw: string): { key: string; label: string } => {
    const key = campaignKey(raw);
    return { key, label: key ? raw.replace(/\.[A-Za-z0-9]+$/, "") : "" };
  };
  const parts = file.split("/").filter(Boolean);
  if (parts.length >= 2) {
    // The directory immediately holding the file, unless that directory is
    // itself the generic sessions bucket — in which case there is nothing
    // separating one run from another, so there is only one.
    const parent = parts[parts.length - 2];
    if (!/^sessions?$/i.test(parent)) return of(parent);
    return parts.length >= 3 ? of(parts[parts.length - 3]) : { key: "", label: "" };
  }
  return of(parts[0] ?? file);
}

/**
 * Session records among a corpus's units, with whatever ordering signal each
 * one carries.
 *
 * A unit qualifies when its declared type says session, or when its path or
 * title names one. Declared type wins: a source that says so is better
 * evidence than a filename convention.
 */
export function findSessions(units: LoreUnit[]): SessionMarker[] {
  const grouped = new Map<string, SessionMarker>();
  for (const unit of units) {
    const declared = unit.type === "session";
    const context = `${unit.file} ${unit.title}`;
    if (!declared && !looksLikeSession(context)) continue;

    // Prefer the title's number: inside a combined log, the heading names the
    // session and the filename names the whole run.
    const number = parseNumber(unit.title) ?? parseNumber(unit.file);
    const date = parseDate(unit.title) ?? parseDate(unit.file);
    if (number === undefined && date === undefined) continue;

    const campaign = campaignOf(unit.file);
    // One session, however many units its text was split across.
    const key = `${campaign.key}|${number ?? `d:${date}`}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.unitIds.push(unit.id);
      existing.date ??= date;
      continue;
    }
    grouped.set(key, {
      unitIds: [unit.id],
      file: unit.file,
      title: unit.title,
      number,
      date,
      campaign: campaign.key,
      campaignLabel: campaign.label,
    });
  }
  return assignCampaigns([...grouped.values()]);
}

/**
 * Decide which containers are actually separate campaigns.
 *
 * The obvious rule — one folder, one campaign — is wrong, and wrong in the
 * direction that hurts. Lore folders accumulate containers that describe how
 * a session was PROCESSED rather than which game it was: a transcript run, an
 * export batch, a tool's output directory. Taking those at face value invents
 * campaigns that were never played, and every "last session" answer then
 * hedges about games that do not exist.
 *
 * So containers are merged unless there is evidence against merging, and the
 * evidence is a NUMBERING COLLISION: two records both claiming session 14.
 * One campaign numbers its sessions once, so a collision is a real signal
 * that two runs are present, while differing folder names are not a signal
 * about anything.
 *
 * Bound, stated honestly: two genuinely separate campaigns whose numbering
 * happens not to overlap will be merged. That costs a slightly odd ordering.
 * The failure it replaces — inventing campaigns from directory names — costs
 * every temporal answer a caveat about games nobody ran, which is worse.
 */
function assignCampaigns(markers: SessionMarker[]): SessionMarker[] {
  const containers = new Map<string, { label: string; numbers: Set<number>; earliest?: string }>();
  for (const m of markers) {
    const c = containers.get(m.campaign) ?? { label: m.campaignLabel, numbers: new Set<number>() };
    if (m.number !== undefined) c.numbers.add(m.number);
    if (m.date && (!c.earliest || m.date < c.earliest)) c.earliest = m.date;
    if (m.campaignLabel && (!c.label || m.campaignLabel.length < c.label.length)) {
      c.label = m.campaignLabel;
    }
    containers.set(m.campaign, c);
  }

  // Stable order so the grouping does not depend on directory-walk order.
  const keys = [...containers.keys()].sort((a, b) => {
    const ea = containers.get(a)!.earliest ?? "";
    const eb = containers.get(b)!.earliest ?? "";
    return ea.localeCompare(eb) || a.localeCompare(b);
  });

  const groups: Array<{ keys: string[]; numbers: Set<number>; label: string }> = [];
  for (const key of keys) {
    const c = containers.get(key)!;
    const home = groups.find(g => ![...c.numbers].some(n => g.numbers.has(n)));
    if (home) {
      home.keys.push(key);
      for (const n of c.numbers) home.numbers.add(n);
      // Prefer the shortest name: the extra words in a container name are the
      // storage or processing description, not what the table calls the game.
      if (c.label && (!home.label || c.label.length < home.label.length)) home.label = c.label;
    } else {
      groups.push({ keys: [key], numbers: new Set(c.numbers), label: c.label });
    }
  }

  const single = groups.length <= 1;
  const idOf = new Map<string, { id: string; label: string }>();
  for (const g of groups) {
    // With one campaign there is nothing to disambiguate, so it carries no
    // name — an answer should not caveat a distinction that does not exist.
    const id = single ? "" : g.label || g.keys[0];
    for (const key of g.keys) idOf.set(key, { id, label: single ? "" : g.label });
  }

  for (const m of markers) {
    const assigned = idOf.get(m.campaign);
    if (!assigned) continue;
    m.campaign = assigned.id;
    m.campaignLabel = assigned.label;
  }
  return markers;
}

/**
 * Campaigns ranked by when they were last played, earliest first.
 *
 * Needed because ordering sessions across campaigns pairwise cannot work.
 * Within a campaign the number decides; across campaigns only the date can.
 * Mixing those two rules in one comparator is not merely imprecise, it is
 * *intransitive* — a dateless session sorts before a dated one from another
 * campaign, which sorts before a dated one from its own, which sorts before
 * it by number. That is a cycle, and `Array.sort` given a cyclic comparator
 * returns an arbitrary order. It did: on a real corpus it reported a session
 * from the middle of the archive as the most recent one played.
 *
 * So rank whole campaigns first, then order within each. Two nested total
 * orders compose into a total order; a comparator that switches rules based
 * on which pair it is looking at does not.
 */
function rankCampaigns(markers: SessionMarker[]): Map<string, number> {
  const latest = new Map<string, string | undefined>();
  for (const m of markers) {
    const seen = latest.get(m.campaign);
    if (m.date && (!seen || m.date > seen)) latest.set(m.campaign, m.date);
    else if (!latest.has(m.campaign)) latest.set(m.campaign, seen);
  }
  const keys = [...latest.keys()].sort((a, b) => {
    const da = latest.get(a);
    const db = latest.get(b);
    // A campaign nobody dated cannot be placed in time. Rank it after the
    // dated ones rather than guessing it is current.
    if (da && db) return da.localeCompare(db) || a.localeCompare(b);
    if (da) return -1;
    if (db) return 1;
    return a.localeCompare(b);
  });
  return new Map(keys.map((k, i) => [k, i]));
}

/**
 * Sessions in the order they were played, earliest first.
 *
 * Within a campaign the number is authoritative — it is what the table counts
 * by, and it survives a log being written up months late. A session with no
 * number falls back to its date, and one with neither sorts last rather than
 * being assigned a position it never had.
 */
export function orderSessions(markers: SessionMarker[]): SessionMarker[] {
  const rank = rankCampaigns(markers);
  return [...markers].sort((a, b) => {
    const ra = rank.get(a.campaign) ?? 0;
    const rb = rank.get(b.campaign) ?? 0;
    if (ra !== rb) return ra - rb;
    if (a.number !== undefined && b.number !== undefined) return a.number - b.number;
    if (a.number !== undefined) return -1;
    if (b.number !== undefined) return 1;
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.unitIds[0].localeCompare(b.unitIds[0]);
  });
}

/** Distinct campaigns represented, in first-played order. Records with no
 *  distinguishing container contribute nothing: they are not an unnamed
 *  campaign, they are the single campaign this folder holds. */
export function campaignsOf(markers: SessionMarker[]): string[] {
  const keys = new Set<string>();
  const labels: string[] = [];
  for (const m of orderSessions(markers)) {
    if (!m.campaign || keys.has(m.campaign)) continue;
    keys.add(m.campaign);
    labels.push(m.campaignLabel || m.campaign);
  }
  return labels;
}

export type TemporalIntent = "latest" | "earliest" | "numbered" | "recent" | "none";

export interface TemporalQuery {
  intent: TemporalIntent;
  /** Sessions the question is asking about, most relevant first. */
  sessions: SessionMarker[];
  /** Campaigns the corpus holds, when more than one. The answer must say
   *  which run it is describing; silently picking one is how a table gets
   *  told confidently about the wrong campaign. */
  ambiguousAcross?: string[];
  /** Explicit session number the question named. */
  number?: number;
}

/** How many sessions "recently" and "the last few" reach back over. */
export const RECENT_WINDOW = 3;

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20,
};

/**
 * What stretch of play a question is asking about.
 *
 * Regex over the question's shape rather than a model call: the vocabulary
 * for "last session" is small, closed, and stable, and a model call here
 * would add latency and a failure mode to a decision a pattern gets right.
 *
 * Returns intent "none" when the question is not temporal, which is the
 * signal for the planner to fall through to subject retrieval.
 */
export function resolveTemporalQuery(question: string, markers: SessionMarker[]): TemporalQuery {
  const q = question.toLowerCase();
  const ordered = orderSessions(markers);
  const campaigns = campaignsOf(markers);
  const ambiguous = campaigns.length > 1 ? campaigns : undefined;

  if (ordered.length === 0) return { intent: "none", sessions: [] };

  /**
   * Sessions of one campaign only — the most recently played, or the first.
   *
   * "The last three sessions" spanning two campaigns is not a recap, it is
   * two unrelated evenings filed together because they happen to be near each
   * other on a calendar. A table asking to be caught up means their game.
   */
  const within = (end: "latest" | "earliest"): SessionMarker[] => {
    const anchor = end === "latest" ? ordered[ordered.length - 1] : ordered[0];
    return ordered.filter(s => s.campaign === anchor.campaign);
  };

  // An explicitly numbered session, in digits or in words.
  const explicit =
    q.match(/\bsessions?\s+(?:number\s+)?(\d{1,3})\b/) ??
    q.match(new RegExp(`\\bsessions?\\s+(${Object.keys(WORD_NUMBERS).join("|")})\\b`));
  if (explicit) {
    const n = Number(explicit[1]) || WORD_NUMBERS[explicit[1]];
    const hits = ordered.filter(s => s.number === n);
    if (hits.length > 0) return { intent: "numbered", sessions: hits, number: n, ambiguousAcross: hits.length > 1 ? ambiguous : undefined };
    return { intent: "numbered", sessions: [], number: n, ambiguousAcross: ambiguous };
  }

  if (/\b(first|earliest|very first|opening)\s+session\b/.test(q) || /\bhow did (?:it|the campaign) (?:all )?(?:start|begin)\b/.test(q)) {
    return { intent: "earliest", sessions: within("earliest").slice(0, 1), ambiguousAcross: ambiguous };
  }

  // "the last few sessions", "the past 3 sessions", "recently"
  const span = q.match(/\b(?:last|past|previous|recent)\s+(\d{1,2}|few|couple(?:\s+of)?)\s+sessions?\b/);
  if (span) {
    const raw = span[1];
    const n = raw === "few" || raw.startsWith("couple") ? RECENT_WINDOW : Number(raw);
    return { intent: "recent", sessions: within("latest").slice(-Math.max(1, n)).reverse(), ambiguousAcross: ambiguous };
  }
  if (/\b(recently|lately|these days|of late)\b/.test(q)) {
    return { intent: "recent", sessions: within("latest").slice(-RECENT_WINDOW).reverse(), ambiguousAcross: ambiguous };
  }

  if (
    /\b(last|latest|most recent|previous)\s+(session|game|time)\b/.test(q) ||
    /\bwhere (?:did|do) we (?:leave off|left off|get to)\b/.test(q) ||
    /\bwhat (?:did we|have we) (?:do|done) last\b/.test(q) ||
    /\bcatch me up\b/.test(q) ||
    /\brecap\b/.test(q)
  ) {
    return { intent: "latest", sessions: within("latest").slice(-1), ambiguousAcross: ambiguous };
  }

  return { intent: "none", sessions: [] };
}

/** One line naming what the answer is about, for the prompt and the report.
 *  Always names the campaign when the corpus holds more than one — an answer
 *  about the wrong run is worse than an answer that asks which run. */
export function describeTemporal(query: TemporalQuery): string {
  if (query.intent === "none" || query.sessions.length === 0) {
    return query.intent === "numbered" && query.number !== undefined
      ? `No session ${query.number} was found in this campaign's records.`
      : "";
  }
  const names = query.sessions.map(s => (s.number !== undefined ? `session ${s.number}` : s.title));
  const multi = (query.ambiguousAcross?.length ?? 0) > 1;
  const where = multi ? ` from "${query.sessions[0].campaignLabel}"` : "";
  const also = multi
    ? ` This lore folder holds more than one campaign (${query.ambiguousAcross!.join(", ")}); say which if you meant another.`
    : "";
  switch (query.intent) {
    case "latest":
      return `The most recent session on record is ${names[0]}${where}.${also}`;
    case "earliest":
      return `The earliest session on record is ${names[0]}${where}.${also}`;
    case "recent":
      // A span that turned out to hold one session is not "the 1 most recent
      // sessions" — a campaign with a single record is a normal thing to ask
      // about, and reading like a template is how a good answer loses trust.
      return names.length === 1
        ? `The most recent session on record is ${names[0]}${where}.${also}`
        : `The ${names.length} most recent sessions${where} are ${names.join(", ")}.${also}`;
    case "numbered":
      return `Records for ${names.join(" and ")}${where}.${also}`;
    default:
      return "";
  }
}

/** Is this path session material?
 *
 *  Path-shaped rather than content-shaped on purpose: it is used to decide
 *  what to hold back and what to judge, both of which have to work before
 *  anything has been read. Lives here rather than in the forge because the
 *  forge depends on this layer and several other callers now need it.
 */
const SESSION_PATH_RE = /(^|\/)sessions?(\/|$)/i;
export const isSessionMaterial = (relPath: string): boolean =>
  SESSION_PATH_RE.test(relPath.replace(/\\/g, "/"));
