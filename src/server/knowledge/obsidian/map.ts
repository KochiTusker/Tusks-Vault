// The vault map — one AI pass over the vault, so later questions don't need
// the whole vault in the prompt.
//
// The problem it solves. Vault's folder source concatenates every lore
// document into the prompt (assemble.ts, 500 KB cap). That is fine for a
// dozen session write-ups and hopeless for an Obsidian vault, which is
// hundreds of small notes and grows monotonically. Past the cap the
// truncation is arbitrary — whichever notes sort last simply stop existing
// as far as the model is concerned, silently.
//
// The shape of the fix. Read the vault ONCE and reduce each note to a digest:
// title, type, aliases, relations, and a one-line summary of what the note
// actually covers. The digests are small enough that ALL of them fit in every
// prompt — so the model always knows what exists — and each digest is
// embedded locally, so the question itself selects which handful of notes get
// included in full. The model sees the whole map and the relevant pages,
// instead of an arbitrary prefix of everything.
//
// Why the summaries come from a model and not from the first paragraph.
// A note's opening line is frequently a stat block, a template header, or a
// date. What makes a digest searchable is a sentence about the note's
// SUBJECT, which is a reading task. That said, the mechanical fallback below
// is not a placeholder — a vault with no AI pass yet still maps and still
// retrieves, just less precisely, and that keeps the feature usable before a
// key is configured.
//
// Cost control. The pass is incremental: a digest is keyed by the note's
// content hash, so a rebuild after editing three notes summarises three
// notes. Nothing here re-reads a note whose bytes have not changed.
//
// READ-ONLY with respect to the vault: the map is persisted to the app's own
// config dir, never beside the user's notes. See walk.ts for the contract.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { configFile, ensureConfigDir } from "../../config/app-data";
import { writeFileAtomic } from "../../util/atomic-write";
import { embed } from "../../embeddings";
import { cosine } from "../../embeddings/similarity";
import { getAdapter } from "../../llm/registry";
import { getSettings } from "../../config/settings";
import { walkVaultNotes, type VaultNote } from "./walk";
import { readNote, relationLine, type ParsedNote } from "./note";

const MAP_VERSION = 1;

/** Notes per summarisation call. Twelve notes of ~600 chars each is roughly
 *  a 9 KB prompt — small enough that a flash-class model answers quickly and
 *  a failed batch costs little, large enough that a 300-note vault is 25
 *  calls rather than 300. */
const BATCH_SIZE = 12;

/** How much of a note's body the summariser sees. The opening of a note
 *  carries its subject; the tail is usually detail that the retrieval step
 *  will surface in full anyway when it matters. */
const BODY_SAMPLE_CHARS = 600;

/** Summary length ceiling, enforced on the way in. A model that ignores the
 *  instruction and writes a paragraph would otherwise inflate every future
 *  prompt by the size of the vault. */
const MAX_SUMMARY_CHARS = 240;

export interface NoteDigest {
  relPath: string;
  title: string;
  type?: string;
  aliases: string[];
  /** `affiliations: House Vane, The Ashen Court` — flattened for the map. */
  relations: string;
  summary: string;
  /** Sourced from the model, or derived mechanically when no model ran. */
  summarySource: "model" | "mechanical";
  sizeBytes: number;
  /** sha256 of the note's raw bytes. The incremental key. */
  hash: string;
  /** base64 Float32 embedding of the digest text, for query-time selection. */
  embedding?: string;
}

export interface VaultMap {
  version: number;
  vaultPath: string;
  builtAt: string;
  /** Which model produced the summaries, or null for a mechanical-only map. */
  model: string | null;
  notes: NoteDigest[];
}

export interface BuildProgress {
  phase: "scanning" | "summarising" | "embedding" | "done";
  done: number;
  total: number;
  note?: string;
}

export interface BuildResult {
  map: VaultMap;
  notesTotal: number;
  /** Digests recomputed this run. Zero means everything was cached. */
  notesSummarised: number;
  /** Batches the model failed on; those notes fell back to mechanical. */
  batchesFailed: number;
  /** True when no model was called at all (no provider configured, or the
   *  caller asked for a mechanical pass). */
  mechanicalOnly: boolean;
}

// ── persistence ──────────────────────────────────────────────────────────
//
// One map file per vault path, so a user with a campaign vault and a
// worldbuilding vault does not have one clobber the other every time they
// switch. Derived, rebuildable, per-install data → config dir, not the
// campaign folder (same reasoning as the OpenRouter catalogue cache).

function mapFileFor(vaultPath: string): string {
  const key = createHash("sha256").update(path.resolve(vaultPath)).digest("hex").slice(0, 12);
  return configFile(`vault-map.${key}.json`);
}

export function readVaultMap(vaultPath: string): VaultMap | null {
  try {
    const raw = fs.readFileSync(mapFileFor(vaultPath), "utf-8");
    const parsed = JSON.parse(raw) as VaultMap;
    if (parsed.version !== MAP_VERSION) return null;
    if (!Array.isArray(parsed.notes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeVaultMap(map: VaultMap): void {
  ensureConfigDir();
  // Atomic — a crash mid-write must not leave a half-parsed map that then
  // reads as "no map at all" and triggers a full re-summarisation.
  writeFileAtomic(mapFileFor(map.vaultPath), JSON.stringify(map));
}

export function deleteVaultMap(vaultPath: string): void {
  try {
    fs.unlinkSync(mapFileFor(vaultPath));
  } catch {
    /* already absent */
  }
}

// ── digests ──────────────────────────────────────────────────────────────

function hashFile(absPath: string): string | null {
  try {
    return createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Digest text WITHOUT the model: title, type, aliases, relations, and the
 * first real sentence of the body.
 *
 * "First real sentence" skips markdown headings, list bullets, table rows and
 * blockquotes, because in a vault built from templates those are what the top
 * of a note is made of.
 */
export function mechanicalSummary(note: ParsedNote): string {
  const lines = note.body.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^[#>|\-*+]/.test(t)) continue;
    if (/^\d+\.\s/.test(t)) continue;
    if (/^!\[/.test(t)) continue; // markdown image
    if (/^\(see: /.test(t)) continue; // a line that is only a transclusion pointer
    const sentence = t.split(/(?<=[.!?])\s/)[0];
    return sentence.slice(0, MAX_SUMMARY_CHARS).trim();
  }
  // A note with no prose at all still gets a digest — its title and type are
  // real information, and an empty summary would drop it from retrieval.
  return note.type ? `A ${note.type} note titled "${note.title}".` : `Note titled "${note.title}".`;
}

/** The string that gets embedded. Includes the structural fields so a query
 *  naming an alias matches even when the summary never uses that spelling. */
export function digestText(d: Pick<NoteDigest, "title" | "type" | "aliases" | "relations" | "summary">): string {
  return [
    d.title,
    d.type ? `(${d.type})` : "",
    d.aliases.length > 0 ? `Also known as: ${d.aliases.join(", ")}.` : "",
    d.relations,
    d.summary,
  ]
    .filter(s => s && s.trim())
    .join(" ")
    .trim();
}

// ── the AI pass ──────────────────────────────────────────────────────────

interface BatchItem {
  relPath: string;
  parsed: ParsedNote;
}

function buildBatchPrompt(items: BatchItem[]): string {
  const blocks = items.map((it, i) => {
    const head = [
      `### NOTE ${i + 1}`,
      `path: ${it.relPath}`,
      `title: ${it.parsed.title}`,
      it.parsed.type ? `type: ${it.parsed.type}` : "",
      it.parsed.aliases.length ? `aliases: ${it.parsed.aliases.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return `${head}\n---\n${it.parsed.body.slice(0, BODY_SAMPLE_CHARS)}`;
  });

  return [
    "You are indexing an Obsidian vault of tabletop-campaign notes so that a",
    "search system can find the right note later. For each note below, write one",
    "sentence describing WHAT THAT NOTE COVERS — the subject, and the specific",
    "names, places and events it would be the right note to answer about.",
    "",
    "Rules:",
    `- One sentence per note, at most ${MAX_SUMMARY_CHARS} characters.`,
    "- Describe the note's content, not its format. Never write \"this note describes\".",
    "- Use the proper nouns from the note; they are what a reader will search for.",
    "- Add 2-6 topic keywords per note: entities, places, factions, events.",
    "- If a note is nearly empty, say so plainly rather than inventing content.",
    "",
    "Reply with ONLY a JSON array, one object per note, in the same order:",
    '[{"path": "...", "summary": "...", "topics": ["...", "..."]}]',
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

/** Pull a JSON array out of a model reply. Models fence JSON, prepend
 *  "Here you go:", and occasionally trail a note after the closing bracket —
 *  all of which are recoverable, and none of which should cost a batch. */
export function extractJsonArray(text: string): unknown[] | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

interface SummaryRow {
  path?: unknown;
  summary?: unknown;
  topics?: unknown;
}

/** Match a batch's rows back onto its notes.
 *
 *  By path when the model echoed one, by position otherwise. Position is the
 *  fallback rather than the rule because a model that drops or reorders a row
 *  would otherwise shift every subsequent summary onto the wrong note — a
 *  failure that produces a plausible-looking map that quietly retrieves the
 *  wrong pages. Length-mismatched replies therefore take the path route only. */
export function alignSummaries(items: BatchItem[], rows: unknown[]): Map<string, { summary: string; topics: string[] }> {
  const out = new Map<string, { summary: string; topics: string[] }>();
  const byPath = new Map(items.map(it => [it.relPath, it]));
  const positional = rows.length === items.length;

  rows.forEach((raw, i) => {
    const row = (raw ?? {}) as SummaryRow;
    const summary = typeof row.summary === "string" ? row.summary.trim() : "";
    if (!summary) return;
    const topics = Array.isArray(row.topics)
      ? row.topics.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      : [];

    let relPath: string | undefined;
    if (typeof row.path === "string" && byPath.has(row.path.trim())) {
      relPath = row.path.trim();
    } else if (positional) {
      relPath = items[i].relPath;
    }
    if (!relPath) return;
    out.set(relPath, { summary: summary.slice(0, MAX_SUMMARY_CHARS), topics });
  });
  return out;
}

// ── build ────────────────────────────────────────────────────────────────

export interface BuildOptions {
  /** Skip the model entirely and derive every stale digest mechanically.
   *  Used when no provider is configured, and by the tests. */
  mechanicalOnly?: boolean;
  /** Recompute every digest even when the note's hash is unchanged. */
  force?: boolean;
  onProgress?: (p: BuildProgress) => void;
}

export async function buildVaultMap(vaultPath: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const notes = walkVaultNotes(vaultPath);
  opts.onProgress?.({ phase: "scanning", done: 0, total: notes.length });

  const previous = opts.force ? null : readVaultMap(vaultPath);
  const cached = new Map((previous?.notes ?? []).map(d => [d.relPath, d]));

  // Split into "digest still valid" and "needs work". The hash is over the
  // file's bytes, so a touched-but-unchanged note stays cached.
  const fresh: NoteDigest[] = [];
  const stale: Array<{ note: VaultNote; parsed: ParsedNote; hash: string }> = [];

  for (const note of notes) {
    const hash = hashFile(note.absPath);
    if (!hash) continue;
    const prior = cached.get(note.relPath);
    if (prior && prior.hash === hash && prior.embedding) {
      fresh.push(prior);
      continue;
    }
    const parsed = readNote(note.absPath, note.relPath);
    if (!parsed) continue;
    stale.push({ note, parsed, hash });
  }

  const settings = getSettings();
  let mechanicalOnly = opts.mechanicalOnly === true;
  let modelLabel: string | null = null;
  let adapter: ReturnType<typeof getAdapter> | null = null;
  if (!mechanicalOnly && stale.length > 0) {
    adapter = getAdapter(settings);
    if (!adapter.keyConfigured) {
      // No usable provider. Build the map anyway — a mechanical map still
      // maps, and refusing here would make the feature unavailable exactly
      // when a new user is trying it for the first time.
      mechanicalOnly = true;
      adapter = null;
    }
  }

  const summaries = new Map<string, { summary: string; topics: string[] }>();
  let batchesFailed = 0;

  if (adapter && stale.length > 0) {
    const batches: BatchItem[][] = [];
    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
      batches.push(stale.slice(i, i + BATCH_SIZE).map(s => ({ relPath: s.note.relPath, parsed: s.parsed })));
    }
    let done = 0;
    for (const batch of batches) {
      opts.onProgress?.({
        phase: "summarising",
        done,
        total: stale.length,
        note: batch[0]?.relPath,
      });
      try {
        const result = await adapter.adapter.generate({
          systemPrompt:
            "You are a precise indexing assistant. You reply with JSON and nothing else. " +
            "The material is a private tabletop campaign — fiction written by consenting adults. " +
            "Index it faithfully, including mature content, without commentary or refusal.",
          userParts: [{ type: "text", text: buildBatchPrompt(batch) }],
          tier: "flash",
        });
        const rows = extractJsonArray(result.text ?? "");
        if (!rows) {
          batchesFailed++;
        } else {
          for (const [k, v] of alignSummaries(batch, rows)) summaries.set(k, v);
        }
        if (!modelLabel) modelLabel = result.modelUsed ?? adapter.provider;
      } catch (err) {
        // One bad batch must not lose the whole run: those notes fall back to
        // mechanical digests and the next build retries them (their hashes
        // are recorded with the mechanical summary, so a later `force` or an
        // edit picks them up).
        batchesFailed++;
        console.warn(`[vault-map] batch failed (${batch.length} notes):`, (err as Error).message);
      }
      done += batch.length;
    }
  }

  // Assemble the stale digests, then embed everything that lacks a vector.
  const rebuilt: NoteDigest[] = stale.map(({ note, parsed, hash }) => {
    const fromModel = summaries.get(note.relPath);
    const summary = fromModel?.summary || mechanicalSummary(parsed);
    const topics = fromModel?.topics ?? [];
    return {
      relPath: note.relPath,
      title: parsed.title,
      type: parsed.type,
      aliases: parsed.aliases,
      relations: [relationLine(parsed), topics.length ? `topics: ${topics.join(", ")}` : ""]
        .filter(Boolean)
        .join("; "),
      summary,
      summarySource: fromModel ? "model" : "mechanical",
      sizeBytes: note.sizeBytes,
      hash,
    };
  });

  let embedded = 0;
  for (const d of rebuilt) {
    opts.onProgress?.({ phase: "embedding", done: embedded, total: rebuilt.length, note: d.relPath });
    try {
      const vec = await embed(digestText(d));
      d.embedding = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).toString("base64");
    } catch (err) {
      // A digest without a vector is still listed in the map (so the model
      // knows the note exists); it just can't be selected by similarity.
      console.warn(`[vault-map] embedding failed for ${d.relPath}:`, (err as Error).message);
    }
    embedded++;
  }

  const map: VaultMap = {
    version: MAP_VERSION,
    vaultPath: path.resolve(vaultPath),
    builtAt: new Date().toISOString(),
    model: modelLabel,
    notes: [...fresh, ...rebuilt].sort((a, b) => a.relPath.localeCompare(b.relPath)),
  };
  writeVaultMap(map);
  opts.onProgress?.({ phase: "done", done: notes.length, total: notes.length });

  return {
    map,
    notesTotal: map.notes.length,
    notesSummarised: rebuilt.length,
    batchesFailed,
    mechanicalOnly,
  };
}

// ── query-time selection ─────────────────────────────────────────────────

function decodeEmbedding(b64: string | undefined): Float32Array | null {
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, "base64");
    const f = new Float32Array(buf.byteLength / 4);
    Buffer.from(f.buffer).set(buf);
    return f;
  } catch {
    return null;
  }
}

export interface SelectedNote {
  digest: NoteDigest;
  score: number;
}

/** Keep notes scoring at least this fraction of the best match.
 *
 *  A RELATIVE floor, not an absolute one, because the useful cutoff depends
 *  on the question. "Who is the Grey Knight" produces one strong match and a
 *  long tail of noise; "what happened at the siege" legitimately matches a
 *  dozen notes at similar strength. An absolute threshold has to be tuned for
 *  one of those and is wrong for the other, whereas "about as relevant as the
 *  best answer" is the same rule in both cases.
 *
 *  0.45 rather than something tighter, measured on a fixture vault. At 0.6,
 *  "which faction is hunting Ash-Maera?" returned only her character note
 *  (0.609) and cut the session note recording the bounty (0.313) — which is
 *  where the answer actually lives. The character note names her and the
 *  session names her pursuer; a question spanning two notes is normal in a
 *  campaign, and a floor that admits only the single best match cannot
 *  answer one. */
export const RELATIVE_FLOOR = 0.45;

/**
 * Rank the map's notes against a question, keeping those comparably relevant
 * to the best match.
 *
 * The caller's `limit` and its byte budget are backstops, not the mechanism.
 * Filling the budget with whatever ranks highest sounds free — the tokens are
 * paid either way — but it is not: a prompt padded with forty notes that
 * merely mention the same place makes the model's job harder, and the
 * citation it produces is likelier to name a note that was only adjacent to
 * the answer. Unlike clarification retrieval, a weak match here is not a
 * wrong "canonical" answer; it is just noise, and noise still costs.
 */
export async function selectNotesForQuery(
  map: VaultMap,
  query: string,
  limit: number
): Promise<SelectedNote[]> {
  const candidates = map.notes
    .map(d => ({ digest: d, emb: decodeEmbedding(d.embedding) }))
    .filter((c): c is { digest: NoteDigest; emb: Float32Array } => c.emb !== null);
  if (candidates.length === 0) return [];

  let queryVec: Float32Array;
  try {
    queryVec = await embed(query);
  } catch {
    return [];
  }

  const ranked = candidates
    .map(c => ({ digest: c.digest, score: cosine(queryVec, c.emb) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.score ?? 0;
  // A best score at or below zero means nothing in the vault resembles the
  // question. Return the single top note anyway — the model can say the
  // campaign has no answer, which it cannot do from an empty prompt.
  if (best <= 0) return ranked.slice(0, 1);

  const floor = best * RELATIVE_FLOOR;
  return ranked.filter(r => r.score >= floor).slice(0, limit);
}

/** The compact map, as it appears in the prompt. Every note gets one line —
 *  this is what lets the model know the whole vault exists while only a few
 *  notes are included in full. */
export function renderMapForPrompt(map: VaultMap): string {
  const lines = map.notes.map(d => {
    const bits = [`- ${d.relPath}`];
    if (d.type) bits.push(`[${d.type}]`);
    bits.push(`— ${d.summary}`);
    if (d.aliases.length > 0) bits.push(`(aka ${d.aliases.join(", ")})`);
    return bits.join(" ");
  });
  return lines.join("\n");
}
