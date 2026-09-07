// What a forged note looks like.
//
// Pure functions, no I/O — the shape of the output, separated from the
// decisions about what to write and from the writing itself, so all three can
// be tested and changed independently.
//
// The taxonomy here is a DEFAULT, not a schema. Retrieval reads `type` as a
// free string and treats an unfamiliar one as a fact rather than an error, so
// a campaign with patrons or ships or eras can say so. What the folders buy
// is a vault that is pleasant to browse by hand; nothing downstream depends
// on them.

/** Folder each type is filed under. An unlisted type files under "Lore",
 *  which is the honest place for "this is campaign material and we did not
 *  have a better shelf for it". */
export const TYPE_FOLDERS: Record<string, string> = {
  npc: "People",
  pc: "People",
  character: "People",
  person: "People",
  faction: "Factions",
  organisation: "Factions",
  organization: "Factions",
  location: "Places",
  place: "Places",
  country: "Places",
  region: "Places",
  city: "Places",
  deity: "Lore",
  patron: "Lore",
  creature: "Lore",
  concept: "Lore",
  era: "Lore",
  item: "Items",
  artifact: "Items",
  session: "Sessions",
  index: "_Index",
};

export const DEFAULT_FOLDER = "Lore";

export function folderFor(type: string | undefined): string {
  if (!type) return DEFAULT_FOLDER;
  return TYPE_FOLDERS[type.toLowerCase()] ?? DEFAULT_FOLDER;
}

/**
 * A title → a filename that survives every filesystem and still reads as the
 * title.
 *
 * Obsidian links by filename, so this string is what a `[[link]]` has to
 * spell. Reserved characters are dropped rather than substituted: a note
 * called `Who? What?` becoming `Who- What-` is uglier than `Who What`, and
 * the frontmatter keeps the original either way.
 */
export function noteFilename(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120)
    .trim();
  return cleaned || "Untitled";
}

/** Windows refuses these as filenames regardless of extension. */
const RESERVED = new Set([
  "con", "prn", "aux", "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

export function safeNoteFilename(title: string): string {
  const name = noteFilename(title);
  return RESERVED.has(name.toLowerCase()) ? `${name} (note)` : name;
}

export interface NoteFrontmatter {
  type?: string;
  aliases: string[];
  relations: Array<{ key: string; targets: string[] }>;
  /** Where the content came from. Not decoration: it is how a reader checks
   *  a claim, how verification works, and how a re-run knows what to rebuild. */
  sources: string[];
  /** Extra scalar fields, rendered after the standard ones. */
  extra?: Record<string, string | number>;
}

function yamlScalar(value: string): string {
  // Quote anything that YAML would otherwise read as structure. Cheap and
  // conservative: over-quoting is invisible, under-quoting corrupts a note.
  return /^[A-Za-z0-9][\w .'()-]*$/.test(value) ? value : JSON.stringify(value);
}

function yamlList(key: string, values: string[]): string {
  if (values.length === 0) return `${key}: []`;
  return `${key}:\n${values.map(v => `  - ${yamlScalar(v)}`).join("\n")}`;
}

/**
 * Render the frontmatter block, fences included.
 *
 * Field order is fixed so a re-run produces a byte-identical note when
 * nothing changed — which is what makes the forge resumable and its output
 * diffable between trials.
 */
export function renderFrontmatter(fm: NoteFrontmatter): string {
  const lines: string[] = ["---"];
  lines.push(`type: ${fm.type ? yamlScalar(fm.type) : ""}`.trimEnd());
  lines.push(yamlList("aliases", fm.aliases));
  for (const rel of fm.relations) lines.push(yamlList(rel.key, rel.targets));
  for (const [k, v] of Object.entries(fm.extra ?? {})) {
    lines.push(`${k}: ${typeof v === "number" ? v : yamlScalar(v)}`);
  }
  lines.push(yamlList("sources", fm.sources));
  lines.push("---");
  return lines.join("\n");
}

export interface ForgedNote {
  /** Vault-relative path, e.g. `People/Someone.md`. */
  relPath: string;
  title: string;
  type?: string;
  frontmatter: NoteFrontmatter;
  body: string;
}

export function renderNote(note: ForgedNote): string {
  const body = note.body.trim();
  return `${renderFrontmatter(note.frontmatter)}\n\n# ${note.title}\n\n${body}\n`;
}

/**
 * Type implied by the document a section came from.
 *
 * A campaign folder names its reference documents after what they contain —
 * a characters document, a factions document, a deities document — so the
 * document is a strong hint about the type of every section inside it. This
 * reads that hint rather than asking a model, and it is a hint only: anything
 * the source actually declared wins, and what this produces is a PROPOSAL for
 * the review step to correct.
 */
export function typeFromDocumentName(file: string): string | undefined {
  const stem = (file.split("/").pop() ?? file).replace(/\.[A-Za-z0-9]+$/, "").toLowerCase();
  const table: Array<[RegExp, string]> = [
    [/\bcharacters?\b|\bcast\b|\bdramatis\b/, "npc"],
    [/\bnpcs?\b/, "npc"],
    [/\bfactions?\b|\bguilds?\b|\borganisations?\b|\borganizations?\b/, "faction"],
    [/\bdeit(y|ies)\b|\bgods?\b|\bpantheon\b/, "deity"],
    [/\bpatrons?\b/, "patron"],
    [/\bcountr(y|ies)\b|\bnations?\b|\bregions?\b|\bplaces?\b|\blocations?\b|\bcities\b/, "location"],
    [/\bcreatures?\b|\bbestiar(y|ies)\b|\bmonsters?\b/, "creature"],
    [/\bitems?\b|\bartifacts?\b|\bartefacts?\b|\btreasures?\b/, "item"],
    [/\btimelines?\b|\beras?\b|\bhistor(y|ies)\b/, "era"],
    [/\bsessions?\b|\bchronicles?\b/, "session"],
  ];
  for (const [re, type] of table) if (re.test(stem)) return type;
  return undefined;
}
