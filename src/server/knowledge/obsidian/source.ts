// Obsidian vault as a lore source.
//
// Produces the same thing the folder loader produces — `[SOURCE DOCUMENT: x]`
// blocks the model cites by name — from a different shape of input, and with
// one extra mode.
//
// FULL mode concatenates every note, exactly like the folder source. Correct
// for a small vault, and the honest default when there is no map yet.
//
// MAPPED mode splits the knowledge base in two: the map of every note (small,
// identical between questions) and the full text of the notes this particular
// question needs (larger, different every time). That split is not cosmetic —
// it is what keeps prompt caching worth anything. The map goes in the
// cacheable part; the selected notes go outside it. Folding the selection
// into the cached block would invalidate the cache on every question and
// re-bill the entire vault each time, which is the exact cost the feature
// exists to avoid.
//
// READ-ONLY — see walk.ts for the contract.

import { readVaultMap, renderMapForPrompt, selectNotesForQuery, type VaultMap } from "./map";
import { describeTemporal, findSessions, resolveTemporalQuery, type TemporalQuery } from "../sessions";
import type { LoreUnit } from "../units";
import { readNote } from "./note";
import { safeVaultPath, walkVaultNotes } from "./walk";

/** Byte ceiling for note bodies included in full, per question. Well under
 *  the folder source's 500 KB: the point of mapped mode is that a handful of
 *  right notes beats a truncated everything. */
export const MAPPED_BODY_BUDGET = 120_000;

/** Extra notes added around a resolved session. Small on purpose: the
 *  question was about a specific evening, and the rest of the campaign is
 *  context, not answer. */
const TEMPORAL_CONTEXT_NOTES = 3;

/** Hard ceiling on notes included in full, regardless of how many clear the
 *  relevance floor. Forty notes is already more campaign material than any one
 *  question needs; past that the prompt is padding, not context. */
const MAX_RANKED = 40;

/** Whole-vault concat ceiling, matching the folder source. */
const FULL_CONCAT_LIMIT = 500_000;

export interface KnowledgeBundle {
  /** Stable between questions. The caller marks this part cacheable. */
  stable: string;
  /** Varies per question. Empty string in full mode. */
  perQuery: string;
  meta: {
    mode: "full" | "mapped";
    notesTotal: number;
    /** Notes included in full. Equals notesTotal in full mode. */
    notesIncluded: number;
    bytesIncluded: number;
    /** Set when mapped mode was asked for but could not run. */
    fellBackBecause?: string;
  };
}

function documentBlock(relPath: string, body: string): string {
  return `\n[SOURCE DOCUMENT: ${relPath}]\n${body}\n`;
}

/** Every note, concatenated. The folder source's behaviour, for vaults small
 *  enough that it is the right answer. */
export function buildFullVaultKnowledge(vaultPath: string): KnowledgeBundle {
  const notes = walkVaultNotes(vaultPath);
  const included: string[] = [];
  let text = "";
  for (const note of notes) {
    const parsed = readNote(note.absPath, note.relPath);
    if (!parsed || !parsed.body) continue;
    text += documentBlock(note.relPath, parsed.body);
    included.push(note.relPath);
    if (text.length > FULL_CONCAT_LIMIT) break;
  }
  const header =
    `### LORE SOURCE SUMMARY\nThe following ${included.length} note(s) from your Obsidian ` +
    `vault are loaded into your knowledge base: ${included.join(", ")}\n\n`;
  return {
    stable: header + text.slice(0, FULL_CONCAT_LIMIT),
    perQuery: "",
    meta: {
      mode: "full",
      notesTotal: notes.length,
      notesIncluded: included.length,
      bytesIncluded: text.length,
    },
  };
}

/**
 * Sessions the question asks about, pinned ahead of anything similarity picks.
 *
 * "What happened last session" names no subject, so cosine similarity ranks
 * every session note about equally — they are all session notes — and returns
 * an arbitrary handful. Order is what answers the question, and the notes
 * already carry it in their titles. So the temporal tier resolves the actual
 * sessions and pins them; similarity then fills whatever budget is left with
 * context around them.
 *
 * Returns null when the question is not temporal, which is the signal to
 * leave selection exactly as it was.
 */
function temporalSelection(map: VaultMap, query: string): { pinned: string[]; resolved: TemporalQuery } | null {
  // The session finder works on lore units; a map digest carries the three
  // fields it actually reads. Adapting here beats duplicating the parsing.
  const asUnits: LoreUnit[] = map.notes.map(d => ({
    id: d.relPath,
    title: d.title,
    file: d.relPath,
    start: 0,
    end: 0,
    type: d.type,
    aliases: d.aliases,
    relations: [],
    depth: 0,
    hash: d.hash,
    chars: d.sizeBytes,
  }));

  const markers = findSessions(asUnits);
  if (markers.length === 0) return null;
  const temporal = resolveTemporalQuery(query, markers);
  if (temporal.intent === "none") return null;

  // The resolved query travels with the pins so the prompt can describe what
  // actually SURVIVED the budget rather than what was asked for — a session
  // transcript runs to tens of thousands of characters, and "the last three
  // sessions" routinely ships one.
  return { pinned: temporal.sessions.flatMap(s => s.unitIds), resolved: temporal };
}

/**
 * The temporal line for the prompt, narrowed to sessions that actually fit.
 *
 * Exported for tests: the failure it prevents is silent — a header promising
 * three sessions while the body carries one reads as a complete answer right
 * up until somebody checks it.
 */
export function temporalNote(
  temporal: { resolved: TemporalQuery } | null,
  includedPaths: string[]
): string {
  if (!temporal) return "";
  const survived = temporal.resolved.sessions.filter(s =>
    s.unitIds.some(id => includedPaths.includes(id))
  );
  if (survived.length === 0) return "";

  const dropped = temporal.resolved.sessions.length - survived.length;
  const line = describeTemporal({ ...temporal.resolved, sessions: survived });
  if (!line) return "";
  const shortfall =
    dropped > 0
      ? ` ${dropped} further session(s) matched but were too long to include; say so if the ` +
        `answer needs them.`
      : "";
  return `\n${line}${shortfall}\n`;
}

/**
 * The map, plus the notes this question needs.
 *
 * Falls back to full mode — reporting why — when there is no map, or the map
 * carries no usable embeddings. Silently returning an empty knowledge base
 * would look to the user exactly like a model that had forgotten their
 * campaign.
 */
export async function buildMappedVaultKnowledge(
  vaultPath: string,
  query: string
): Promise<KnowledgeBundle> {
  // A vault that fits in the budget should simply be included. Mapped mode
  // costs a map header AND a selection, so below the budget it produces a
  // LARGER prompt carrying LESS content than plain concatenation — the exact
  // opposite of the point. Measured from the directory walk, so this costs a
  // stat per note and no reads.
  const totalBytes = walkVaultNotes(vaultPath).reduce((n, note) => n + note.sizeBytes, 0);
  if (totalBytes <= MAPPED_BODY_BUDGET) {
    const full = buildFullVaultKnowledge(vaultPath);
    full.meta.fellBackBecause = "the whole vault fits in the prompt, so all of it was included";
    return full;
  }

  const map = readVaultMap(vaultPath);
  if (!map || map.notes.length === 0) {
    const full = buildFullVaultKnowledge(vaultPath);
    full.meta.fellBackBecause = "no vault map has been built yet";
    return full;
  }

  const temporal = temporalSelection(map, query);
  const ranked = await selectNotesForQuery(map, query, MAX_RANKED);
  if (ranked.length === 0 && !temporal) {
    const full = buildFullVaultKnowledge(vaultPath);
    full.meta.fellBackBecause = "the vault map has no usable embeddings";
    return full;
  }

  const stable = [
    "### VAULT MAP",
    "",
    `This is every note in the campaign vault (${map.notes.length}), one line each: ` +
      "its path, its kind, and what it covers. Use it to know what exists. The most " +
      "relevant notes are reproduced in full below the map — if the answer needs a note " +
      "that is listed here but not reproduced, say which note you would need rather than " +
      "guessing at its contents.",
    "",
    renderMapForPrompt(map),
  ].join("\n");

  let perQuery = "";
  const included: string[] = [];

  // Pinned first, so a budget squeeze drops similarity matches rather than
  // the session the question actually asked about.
  const byPath = new Map(map.notes.map(d => [d.relPath, d]));
  const pinnedDigests = (temporal?.pinned ?? [])
    .map(p => byPath.get(p))
    .filter((d): d is NonNullable<typeof d> => !!d);
  // A temporal question is ALREADY answered by the sessions it resolved to.
  // Similarity then adds session notes that merely resemble them — which for
  // "what happened last session" means a dozen other evenings, tripling the
  // prompt to make the answer harder. A few for context, not forty.
  const fill = ranked
    .map(r => r.digest)
    .filter(d => !(temporal?.pinned ?? []).includes(d.relPath))
    .slice(0, temporal ? TEMPORAL_CONTEXT_NOTES : MAX_RANKED);
  const order = [...pinnedDigests, ...fill];

  for (const digest of order) {
    const abs = safeVaultPath(vaultPath, digest.relPath);
    if (!abs) continue;
    const parsed = readNote(abs, digest.relPath);
    if (!parsed || !parsed.body) continue;
    const block = documentBlock(digest.relPath, parsed.body);
    if (perQuery.length + block.length > MAPPED_BODY_BUDGET) {
      // Budget spent. Stopping is right — the notes are ranked, so what
      // remains is what mattered least.
      break;
    }
    perQuery += block;
    included.push(digest.relPath);
  }

  const perQueryHeader =
    `\n\n### NOTES RETRIEVED FOR THIS QUESTION\n\n` +
    `${included.length} of ${map.notes.length} notes, selected by relevance to the question ` +
    `and reproduced in full. Cite them by path exactly as written.\n` +
    // Which session, said out loud — and only the ones that actually fit.
    //
    // Describing the RESOLVED set would promise more than the prompt carries:
    // a session transcript runs to tens of thousands of characters, so "the
    // last three sessions" routinely ships one, and a header claiming three
    // invites the model to recap two it cannot see. Same rule as the corpus
    // header: never imply the model is holding lore it is not.
    temporalNote(temporal, included);

  return {
    stable,
    perQuery: included.length > 0 ? perQueryHeader + perQuery : "",
    meta: {
      mode: "mapped",
      notesTotal: map.notes.length,
      notesIncluded: included.length,
      bytesIncluded: perQuery.length,
    },
  };
}

/** Notes as dashboard rows, so the Lore tab lists a vault the same way it
 *  lists a folder. Every note the walk returns is Markdown, so all of them
 *  are readable — the flag exists for parity with the folder source, where
 *  it is not always true. */
export function listVaultNotes(
  vaultPath: string
): Array<{ name: string; size: number; createdAt: Date; indexed: boolean }> {
  return walkVaultNotes(vaultPath).map(n => ({
    name: n.relPath,
    size: n.sizeBytes,
    createdAt: new Date(n.modifiedMs),
    indexed: true,
  }));
}
