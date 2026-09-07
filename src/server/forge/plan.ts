// The survey: what notes would this lore folder become?
//
// Runs before anything is written and before any agent is called, because
// that ordering is what makes a review step worth having — the user corrects
// 30-odd type decisions once, rather than reading 150 notes afterwards and
// finding the same mistake repeated. It is also completely mechanical, so it
// is free to re-run as often as the user likes while they adjust.
//
// Every proposal carries where it came from and how its type was decided.
// "Confidence" here is not a score; it is a statement about the SOURCE of the
// decision, which is the thing a reviewer actually needs in order to know
// what to look at.

import { documentStem, type LoreUnit } from "../knowledge/units";
import { folderFor, safeNoteFilename, typeFromDocumentName, type ForgedNote } from "./schema";

export type TypeSource = "declared" | "document" | "unknown";

export interface ProposedNote extends ForgedNote {
  unitId: string;
  /** Every unit whose text this note carries, in order. Usually one; more
   *  when an oversized section was split and is being reassembled, or when
   *  form-field sections were folded back into their subject. */
  unitIds: string[];
  /** The same units, each with the heading to re-emit above it. A split part
   *  carries none — it is a continuation of one section. A folded field
   *  carries its own, because "Background" inside a character's note is
   *  information and `Background.md` next to it is not. */
  segments: Array<{ unitId: string; heading?: string }>;
  /** How the type was arrived at. `unknown` is the review queue. */
  typeSource: TypeSource;
  chars: number;
}

export interface ForgePlan {
  notes: ProposedNote[];
  /** Units deliberately left out, with the reason, so nothing vanishes
   *  quietly between the folder and the vault. */
  skipped: Array<{ unitId: string; reason: string }>;
  byType: Record<string, number>;
  /** Notes whose type nobody declared and no document implied — the ones a
   *  human has to decide. */
  needsDecision: number;
}

export interface PlanOptions {
  /** Predicate for units to leave alone entirely. Used to hold back session
   *  material, which is a campaign's primary record and wants a different
   *  treatment from a reference document. */
  skip?: (unit: LoreUnit) => string | null;
}

/** Declared types that say nothing useful. Treated as undeclared so they
 *  reach the review queue instead of filing a note under a shelf labelled
 *  "other", which is where notes go to be never found again. */
const VACUOUS_TYPES = new Set(["other", "misc", "miscellaneous", "unknown", "none", "note"]);

/**
 * Headings that are a form field wherever they appear, even in a corpus of
 * one document.
 *
 * `unitFromNote` already refuses to cut an Obsidian note at its `##`
 * headings, on the grounds that they are internal structure rather than
 * separate subjects. A folder document deserves the same protection and did
 * not have it: sectioning cut at whatever depth repeated, so a character
 * written up under a `#` title with `##` fields beneath it came out as one
 * note per FIELD and none for the character.
 *
 * Deliberately short. Genuine topics live under headings like these too, and
 * the repeat rule below catches the rest without a list to maintain.
 */
const FIELD_HEADINGS = new Set([
  "abilities",
  "allies",
  "appearance",
  "background",
  "backstory",
  "description",
  "dm notes",
  "enemies",
  "equipment",
  "gm notes",
  "goals",
  "hooks",
  "inventory",
  "motivations",
  "notes",
  "personality",
  "questions",
  "quotes",
  "references",
  "relationships",
  "roleplay questions",
  "secrets",
  "see also",
  "stats",
  "traits",
]);

const normaliseHeading = (title: string): string =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const PART_SUFFIX = /\s*\(part \d+ of \d+\)\s*$/;

/**
 * Which section headings are structure rather than subject.
 *
 * The load-bearing signal is repetition ACROSS documents, not the wording: a
 * heading that appears in two different source documents is a field somebody
 * filled in twice, and a heading that appears once is a topic. That holds for
 * any campaign in any genre, which is the point — the alternative is a list
 * of headings that happens to match one person's vault.
 *
 * Two is a low bar and it is chosen knowingly. Two documents CAN discuss the
 * same genuine topic under the same heading, and folding those into their
 * respective parents is not perfect. It is still better than the alternative
 * this replaces, which named them `Topic` and `Topic (2)` — a suffix that
 * discards the only thing distinguishing them.
 */
export function fieldHeadings(units: LoreUnit[]): Set<string> {
  const docsPerTitle = new Map<string, Set<string>>();
  for (const unit of units) {
    // Depth 0 is a whole document or its preamble — a document is never a
    // field of itself, however often its stem repeats.
    if (unit.depth === 0) continue;
    const key = normaliseHeading(unit.partOf ? unit.title.replace(PART_SUFFIX, "") : unit.title);
    if (!key) continue;
    if (!docsPerTitle.has(key)) docsPerTitle.set(key, new Set());
    docsPerTitle.get(key)!.add(unit.file);
  }
  const out = new Set<string>();
  for (const [key, files] of docsPerTitle) {
    if (files.size > 1 || FIELD_HEADINGS.has(key)) out.add(key);
  }
  return out;
}

/**
 * Turn units into proposed notes.
 *
 * The type is decided in one order and the order matters: what the source
 * DECLARED beats what the document implies, and both beat guessing. A
 * declaration is somebody's stated intent; a document name is a decent
 * pattern; nothing at all is a question, and it is reported as one rather
 * than filled in with a plausible default.
 */
export function planForge(units: LoreUnit[], opts: PlanOptions = {}): ForgePlan {
  const notes: ProposedNote[] = [];
  const skipped: Array<{ unitId: string; reason: string }> = [];
  const used = new Set<string>();

  // Reassemble split sections first: seven slices of one long chapter are
  // one note, not seven notes all named after the chapter.
  const groups = new Map<string, LoreUnit[]>();
  const order: string[] = [];
  for (const unit of units) {
    const key = unit.partOf ?? unit.id;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(unit);
  }

  // Two sections can legitimately share a title. Suffix rather than
  // overwrite: losing a note to a name clash is silent, and silent loss is
  // the failure this whole pipeline exists to avoid.
  const claim = (title: string, folder: string): { filename: string; relPath: string } => {
    let filename = safeNoteFilename(title);
    let relPath = `${folder}/${filename}.md`;
    let n = 2;
    while (used.has(relPath.toLowerCase())) {
      filename = `${safeNoteFilename(title)} (${n++})`;
      relPath = `${folder}/${filename}.md`;
    }
    used.add(relPath.toLowerCase());
    return { filename, relPath };
  };

  const typeFor = (unit: LoreUnit): { type?: string; typeSource: TypeSource } => {
    const declared = unit.type && !VACUOUS_TYPES.has(unit.type.toLowerCase()) ? unit.type : undefined;
    if (declared) return { type: declared, typeSource: "declared" };
    const implied = typeFromDocumentName(unit.file);
    return implied ? { type: implied, typeSource: "document" } : { typeSource: "unknown" };
  };

  const fields = fieldHeadings(units);
  /** The subject a form field belongs to: the last real note this document
   *  produced. Per file, because documents do not nest. */
  const subjectOf = new Map<string, ProposedNote>();

  for (const key of order) {
    const members = groups
      .get(key)!
      .sort((a, b) => (a.partIndex ?? 0) - (b.partIndex ?? 0) || a.start - b.start);
    const unit = members[0];
    const skipReason = opts.skip?.(unit) ?? null;
    if (skipReason) {
      for (const m of members) skipped.push({ unitId: m.id, reason: skipReason });
      continue;
    }

    // A reassembled note is titled after the section, not after "part 1 of 7".
    const title = unit.partOf ? unit.title.replace(PART_SUFFIX, "") : unit.title;
    const chars = members.reduce((n, m) => n + m.chars, 0);

    if (unit.depth > 0 && fields.has(normaliseHeading(title))) {
      // A field belongs to its subject. Fold it in, keeping the heading, so
      // the note reads the way the document did.
      let subject = subjectOf.get(unit.file);
      if (!subject) {
        // The document opened straight into a field, with no subject above
        // it. The document itself is the subject.
        const { type, typeSource } = typeFor(unit);
        const { filename, relPath } = claim(documentStem(unit.file), folderFor(type));
        subject = {
          unitId: unit.id,
          unitIds: [],
          segments: [],
          relPath,
          title: filename,
          type,
          typeSource,
          chars: 0,
          frontmatter: { type, aliases: [], relations: [], sources: [unit.file] },
          body: "",
        };
        notes.push(subject);
        subjectOf.set(unit.file, subject);
      }
      for (const m of members) {
        subject.unitIds.push(m.id);
        // Only the first slice re-emits the heading; the rest continue it.
        subject.segments.push({ unitId: m.id, ...(m === members[0] ? { heading: title } : {}) });
      }
      subject.chars += chars;
      continue;
    }

    const { type, typeSource } = typeFor(unit);
    const { filename, relPath } = claim(title, folderFor(type));

    const note: ProposedNote = {
      unitId: unit.id,
      unitIds: members.map(m => m.id),
      segments: members.map(m => ({ unitId: m.id })),
      relPath,
      title: filename,
      type,
      typeSource,
      chars,
      frontmatter: {
        type,
        aliases: [...unit.aliases],
        relations: unit.relations.map(r => ({ ...r })),
        sources: [unit.file],
      },
      body: "", // filled by the writer, which owns reading the source text
    };
    notes.push(note);
    subjectOf.set(unit.file, note);
  }

  const byType: Record<string, number> = {};
  for (const note of notes) byType[note.type ?? "(undecided)"] = (byType[note.type ?? "(undecided)"] ?? 0) + 1;

  return {
    notes,
    skipped,
    byType,
    needsDecision: notes.filter(n => n.typeSource === "unknown").length,
  };
}

/**
 * Index notes, one per folder, listing what is in it.
 *
 * Not decoration. A vault of 150 notes with no way in is a pile, and the
 * index is also what makes the result legible in Obsidian before anyone
 * installs a query plugin.
 */
export function buildIndexNotes(plan: ForgePlan): ProposedNote[] {
  const byFolder = new Map<string, ProposedNote[]>();
  for (const note of plan.notes) {
    const folder = note.relPath.split("/")[0];
    (byFolder.get(folder) ?? byFolder.set(folder, []).get(folder)!).push(note);
  }

  const indexes: ProposedNote[] = [];
  for (const [folder, notes] of [...byFolder.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = [...notes].sort((a, b) => a.title.localeCompare(b.title));
    const body = sorted.map(n => `- [[${n.title}]]${n.type ? ` — ${n.type}` : ""}`).join("\n");
    indexes.push({
      unitId: `index:${folder}`,
      unitIds: [],
      segments: [],
      relPath: `_Index/${folder}.md`,
      title: folder,
      type: "index",
      typeSource: "declared",
      chars: body.length,
      frontmatter: { type: "index", aliases: [], relations: [], sources: [] },
      body: `${sorted.length} note(s) in ${folder}.\n\n${body}`,
    });
  }
  return indexes;
}
