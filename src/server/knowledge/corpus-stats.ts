// Split a concatenated knowledge base back into the documents it was built
// from.
//
// This file used to carry a whole corpus-sizing feature — a token estimate, a
// per-document breakdown sorted by size, and a cache to make the dashboard's
// repeated calls cheap. Nothing called any of it: `corpusStats()` had no
// caller in the app, the routes, or a test, and the constants, interfaces and
// cache below it existed only to serve that one function. Removed rather than
// kept "in case", because unreachable code still has to be read, typechecked
// and reasoned about by everyone who opens the file.
//
// What survives is the one export that is genuinely used — `splitDocuments`,
// which mcp/tools.ts calls — and it is self-contained: it needs neither the
// token estimate nor the loader the rest of this file imported.

/** The header the knowledge loader writes before each document's text. */
const DOC_MARKER = /\n\[SOURCE DOCUMENT: ([^\]]+)\]\n/g;

/**
 * Split the concatenated knowledge base into `{ name, chars }` per document.
 *
 * Measured on the CONCATENATED text rather than by summing file sizes, because
 * the two differ: a .docx is a zip whose text is a fraction of its bytes, and
 * the concat adds a `[SOURCE DOCUMENT: …]` header per file. Sizing off
 * `fs.stat` would be wrong in both directions at once.
 */
export function splitDocuments(kb: string): Array<{ name: string; chars: number }> {
  const out: Array<{ name: string; chars: number }> = [];
  const re = new RegExp(DOC_MARKER.source, "g");
  let match: RegExpExecArray | null;
  let prev: { name: string; start: number } | null = null;
  while ((match = re.exec(kb)) !== null) {
    if (prev) out.push({ name: prev.name, chars: match.index - prev.start });
    prev = { name: match[1], start: re.lastIndex };
  }
  if (prev) out.push({ name: prev.name, chars: kb.length - prev.start });
  return out;
}
