// Frontmatter on a folder-source document: strip it, and mine it.
//
// Two things are wrong with feeding a lore document to a model verbatim.
//
// The first is that a YAML fence is not prose. The Obsidian source has always
// stripped frontmatter (`note.ts`); the folder source never did, so on this
// install roughly 15k characters of `schema:`/`docType:`/`entities:` reached
// the model as though it were campaign fact. It is machine bookkeeping, it
// reads as nonsense in a lore answer, and it is paid for on every question.
//
// The second is the more useful half: that bookkeeping is exactly the entity
// index retrieval wants. Documents written by the companion tooling declare
// their subjects — name, type, aliases, which section covers them — and Vault
// was throwing that away and then guessing. Parsing it gives the folder
// source typed, aliased subjects for free, with no model call and no
// restructuring asked of the user.
//
// The parser is deliberately narrow: one optional top-level `entities:` list
// of flat mappings. A real YAML dependency would accept far more shapes than
// this format ever produces, and would throw on a document a person edited by
// hand — which must cost that document its declarations, never its content.

import type { LoreUnit } from "./units";

const FENCE_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

export interface SplitDocument {
  /** Frontmatter body, without the fences. Empty when there was none. */
  frontmatter: string;
  /** The document minus its fence. Offsets used everywhere downstream are
   *  relative to THIS, not to the file. */
  body: string;
}

export function splitFrontmatter(text: string): SplitDocument {
  const m = text.match(FENCE_RE);
  if (!m) return { frontmatter: "", body: text };
  return { frontmatter: m[1], body: text.slice(m[0].length) };
}

export interface DeclaredEntity {
  name: string;
  type?: string;
  aliases: string[];
  affiliations: string[];
  /** Heading this entity is covered under, when the document says so. Lets a
   *  declaration attach to the right unit rather than to the whole file. */
  section?: string;
}

function unquote(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

/** `[a, "b, c"]` → `["a", "b, c"]`. Empty for `[]` or a non-list. */
function inlineList(raw: string): string[] {
  const t = raw.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return [];
  const inner = t.slice(1, -1).trim();
  if (!inner) return [];
  const out: string[] = [];
  let buf = "";
  let quoted = false;
  for (const c of inner) {
    if (c === '"' || c === "'") {
      quoted = !quoted;
      continue;
    }
    if (c === "," && !quoted) {
      const v = buf.trim();
      if (v) out.push(v);
      buf = "";
      continue;
    }
    buf += c;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * Entities declared in a document's frontmatter.
 *
 * Returns an empty list rather than throwing for anything it does not
 * recognise: a document whose frontmatter a person hand-edited into invalid
 * YAML must still contribute its prose.
 */
export function parseDeclaredEntities(frontmatter: string): DeclaredEntity[] {
  if (!frontmatter.includes("entities:")) return [];
  const lines = frontmatter.split(/\r?\n/);

  let listIndent = -1;
  const out: DeclaredEntity[] = [];
  let current: DeclaredEntity | null = null;
  /** Key whose value a following `- item` line belongs to. Scoped to this
   *  call: a module-level cursor would leak between documents. */
  let lastKey = "";

  const commit = (): void => {
    if (current && current.name) out.push(current);
    current = null;
  };

  const applyPair = (entity: DeclaredEntity, raw: string): void => {
    const m = raw.match(/^([A-Za-z_][\w-]*):[ \t]*(.*)$/);
    if (!m) return;
    lastKey = m[1].toLowerCase();
    const value = m[2].trim();
    if (!value) return;
    assign(entity, lastKey, value.startsWith("[") ? inlineList(value) : [unquote(value)], false);
  };

  let inList = false;
  for (const line of lines) {
    if (!inList) {
      if (/^entities:[ \t]*$/.test(line)) inList = true;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (trimmed === "") continue;

    // A new top-level key ends the list.
    if (indent === 0 && !trimmed.startsWith("-")) break;

    const item = trimmed.match(/^-[ \t]+(.*)$/);
    if (item) {
      if (listIndent === -1) listIndent = indent;
      // A dash shallower than the list's own indent belongs to something else.
      if (indent < listIndent) break;
      if (indent === listIndent) {
        commit();
        current = { name: "", aliases: [], affiliations: [] };
        lastKey = "";
        applyPair(current, item[1]);
        continue;
      }
      // Deeper dash: a block-list value under the current key.
      if (current && lastKey) {
        const v = unquote(item[1]);
        if (v) assign(current, lastKey, [v], true);
      }
      continue;
    }

    if (current) applyPair(current, trimmed);
  }
  commit();
  return out;
}

function assign(entity: DeclaredEntity, key: string, values: string[], append: boolean): void {
  const clean = values.map(unquote).filter(Boolean);
  if (clean.length === 0) return;
  switch (key) {
    case "name":
      entity.name = clean[0];
      break;
    case "type":
      entity.type = clean[0].toLowerCase();
      break;
    case "section":
      entity.section = clean[0];
      break;
    case "aliases":
    case "alias":
      entity.aliases = append ? [...entity.aliases, ...clean] : clean;
      break;
    case "affiliations":
      entity.affiliations = append ? [...entity.affiliations, ...clean] : clean;
      break;
  }
}

/**
 * Attach declared metadata to the units of the document that declared it.
 *
 * Matched on `section` first, falling back to `name`, both compared loosely
 * (case and surrounding punctuation vary between a heading and the frontmatter
 * that describes it). A declaration matching no unit is returned as unmatched
 * rather than dropped: it names a subject the document says it covers, and
 * that is worth telling the user about — it usually means a heading was
 * renamed and the metadata was not.
 *
 * Mutates in place, because the units were just built by the caller and
 * copying them buys nothing.
 */
export function applyDeclarations(
  units: LoreUnit[],
  declared: DeclaredEntity[]
): { matched: number; unmatched: DeclaredEntity[] } {
  const loose = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const byTitle = new Map<string, LoreUnit>();
  for (const u of units) {
    const key = loose(u.title);
    if (key && !byTitle.has(key)) byTitle.set(key, u);
  }

  let matched = 0;
  const unmatched: DeclaredEntity[] = [];
  for (const d of declared) {
    const unit =
      (d.section ? byTitle.get(loose(d.section)) : undefined) ?? byTitle.get(loose(d.name));
    if (!unit) {
      unmatched.push(d);
      continue;
    }
    matched++;
    if (d.type && !unit.type) unit.type = d.type;
    for (const alias of [d.name, ...d.aliases]) {
      // The declared name is an alias too when the heading is worded
      // differently — that is the whole reason the declaration is useful.
      if (loose(alias) !== loose(unit.title) && !unit.aliases.includes(alias)) {
        unit.aliases.push(alias);
      }
    }
    if (d.affiliations.length > 0 && !unit.relations.some(r => r.key === "affiliations")) {
      unit.relations.push({ key: "affiliations", targets: d.affiliations });
    }
  }
  return { matched, unmatched };
}
