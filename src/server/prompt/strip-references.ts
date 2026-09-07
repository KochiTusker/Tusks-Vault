// Strips the citation/source markers the model emits per Rule 1 of the
// system prompt. Lets the dashboard offer a "hide references" toggle without
// removing the citation discipline from the prompt itself — the model still
// reasons "I must justify every claim with a source" (which is what keeps
// confabulation down), but the bracketed tags never reach the user.
//
// Why post-process instead of removing the rules from the prompt:
//   The citation requirement is load-bearing for grounding. Removing it
//   from the prompt lets the model relax the "every claim needs a source"
//   discipline, which empirically raises confabulation rates. Stripping at
//   the output boundary keeps the discipline intact while delivering clean
//   text to Discord.
//
// Patterns the model emits (per src/server/prompt/system.ts):
//   [filename.ext]                    — Rule 1, knowledge-base citation
//   [clarification: <id>]             — Rule 1, DM clarification citation
//   [D&D 5e] / [D&D5e]                — Rule 5, rules-fallback marker
//   [speculation]                     — Speculative-mode marker
//   [sanitised per active guardrails] — Guardrails-mode marker
//
// What we deliberately do NOT strip:
//   Generic stage directions like "[chuckles darkly]" or "[OOC]" that some
//   personas may emit. Our patterns are narrow on purpose: known-extension
//   filenames, exact lowercase keywords, etc. Anything outside that shape
//   passes through untouched.

const FILENAME_EXTENSIONS = [
  "md", "markdown", "txt", "json",
  "html", "htm", "pdf",
  "doc", "docx",
  "csv", "tsv",
  "yaml", "yml",
  "rtf", "odt",
].join("|");

// Each pattern eats any leading inline whitespace (space/tab) so a stripped
// citation doesn't leave a double space behind. \n is preserved so block
// structure isn't disturbed.
const REFERENCE_PATTERNS: RegExp[] = [
  // [clarification: anything-not-a-bracket]
  /[ \t]*\[clarification:\s*[^\]\n]+\]/gi,
  // [D&D 5e] with optional space inside the &-pair (model occasionally emits
  // [D&D5e] or [D & D 5e] — accept both).
  /[ \t]*\[D\s*&\s*D\s*5e\]/gi,
  // [speculation]
  /[ \t]*\[speculation\]/gi,
  // [sanitised per active guardrails] — British spelling per Rule 6
  /[ \t]*\[sanitised per active guardrails\]/gi,
  // [filename.ext] — narrow to a whitelist of extensions so we don't shred
  // legitimate bracketed prose that happens to contain a period.
  new RegExp(`[ \\t]*\\[[^\\[\\]\\n]+\\.(?:${FILENAME_EXTENSIONS})\\]`, "gi"),
];

/**
 * Every way a model plausibly writes a citation for one source document.
 *
 * The extension-whitelist pattern above assumes the model echoes the filename
 * exactly as the `[SOURCE DOCUMENT: ...]` header gave it. Models do not: asked
 * to cite `02 - NPCs/Background/Maera the Ashbound.md`, they routinely write
 * `[Maera the Ashbound]`. An Obsidian vault makes that the normal case rather than
 * the exception, because notes are named the way people talk about them — so
 * "hide references" appeared to do nothing at all for vault users, which is
 * the bug this exists to close.
 *
 * Matching against the corpus rather than broadening the syntax is what keeps
 * it safe: `[Dustmere]` is only removed when Dustmere is genuinely a loaded
 * document, so ordinary bracketed prose survives.
 */
function citationFormsFor(sourceName: string): string[] {
  const forms = new Set<string>();
  const rel = sourceName.trim();
  if (!rel) return [];

  const stripExt = (s: string) => s.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  const base = rel.split(/[\\/]/).pop() ?? rel;

  // All four combinations of {full path, basename} x {with, without extension}.
  // The path-without-extension is not a hypothetical: asked to cite
  // `03 - Factions/Vigiles Telarum.md`, a model wrote
  // `[03 - Factions/Vigiles Telarum]` — it keeps the folders, which disambiguate,
  // and drops the extension, which does not.
  for (const f of [rel, stripExt(rel), base, stripExt(base)]) {
    if (f) forms.add(f);
  }

  // Separator variants, so a vault authored on one platform and cited on
  // another still matches.
  for (const f of [...forms]) {
    if (f.includes("/")) forms.add(f.replace(/\//g, "\\"));
    if (f.includes("\\")) forms.add(f.replace(/\\/g, "/"));
  }

  // Obsidian's own link syntax, which a model reading a vault often mirrors.
  for (const f of [...forms]) forms.add(`[${f}]`);

  return [...forms].filter(Boolean);
}

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

/**
 * The documents this prompt actually carried, read back out of it.
 *
 * Read from the assembled parts rather than the corpus on disk so the strip is
 * scoped to what the model was SHOWN. In mapped mode most of the vault is a
 * one-line digest and only a few notes are included in full; taking the whole
 * vault's filenames instead would strip brackets for documents that were never
 * in front of the model.
 */
export function sourceNamesIn(parts: Array<{ type: string; text?: string }>): string[] {
  const names = new Set<string>();
  const marker = /\[SOURCE DOCUMENT:\s*([^\]\n]+)\]/g;
  // A VAULT MAP line: "- <relPath> [type] — summary (aka alias, alias)".
  // Notes listed here are NOT wrapped in a SOURCE DOCUMENT header — only the
  // handful reproduced in full are — but the model has read every one of them
  // and cites them freely. Missing these was why stripping still left brackets
  // behind for a mapped vault, which is the default for a vault of any size.
  const mapLine = /^-[ \t]+(.+?)[ \t]+(?:\[[^\]\n]*\][ \t]+)?—[ \t]/gm;
  const aka = /\(aka ([^)\n]+)\)/g;

  for (const part of parts) {
    if (part.type !== "text" || !part.text) continue;
    let m: RegExpExecArray | null;
    while ((m = marker.exec(part.text)) !== null) names.add(m[1].trim());
    while ((m = mapLine.exec(part.text)) !== null) names.add(m[1].trim());
    // Aliases are the vault's own other names for a note, so a citation using
    // one is a real citation. Harvested from the same text, so this cannot
    // invent a name the model was never shown.
    while ((m = aka.exec(part.text)) !== null) {
      for (const alias of m[1].split(",")) {
        const a = alias.trim();
        if (a) names.add(a);
      }
    }
  }
  return [...names];
}

/**
 * Strip citation markers from an answer.
 *
 * `sourceNames` is the list of documents actually assembled into this
 * question's prompt. Supplying it is what makes the strip reliable; without it
 * only the syntactic patterns above apply, which is the correct fallback for
 * callers that have no corpus to hand.
 */
export function stripReferenceMarkers(text: string, sourceNames: string[] = []): string {
  if (!text) return text;
  let out = text;
  for (const re of REFERENCE_PATTERNS) {
    out = out.replace(re, "");
  }

  if (sourceNames.length > 0) {
    const forms = new Set<string>();
    for (const name of sourceNames) for (const f of citationFormsFor(name)) forms.add(f);
    if (forms.size > 0) {
      // Longest first: `[Session 01.md]` must not be half-eaten by a shorter
      // form that happens to be a prefix of it.
      const alternation = [...forms]
        .sort((a, b) => b.length - a.length)
        .map(f => f.replace(ESCAPE_RE, "\\$&"))
        .join("|");
      out = out.replace(new RegExp(`[ \\t]*\\[(?:${alternation})\\]`, "gi"), "");
    }
  }
  // Cleanup pass — citations sit between content and punctuation, so
  // stripping can leave "claim ." or "  ," artifacts behind. Collapse
  // mid-line multi-space and tighten orphan punctuation. The lookbehind on
  // the multi-space rule preserves LEADING indentation (a run of spaces at
  // line start has no preceding \S, so it's not matched) — important for
  // code blocks and quoted blocks the model occasionally emits.
  out = out
    .replace(/(?<=\S)[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    // Per-line trailing-whitespace trim (preserve leading indentation).
    .replace(/[ \t]+$/gm, "");
  return out;
}
