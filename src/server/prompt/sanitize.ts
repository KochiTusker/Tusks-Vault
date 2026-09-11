// The asker's words, defanged.
//
// Lives in its own module because it is needed on BOTH sides of the prompt
// boundary: the assembler quotes the question and any attached text, and the
// adapters that turn an attached PDF back into prompt text need the identical
// treatment. It was previously private to assemble.ts, which is exactly why
// the PDF path went unsanitised — a helper the other layer could not reach.

/**
 * Defang the structural vocabulary of this prompt inside an asker's question.
 *
 * The question is untrusted text from a Discord user, a Foundry player or an
 * MCP client, and it is concatenated into a prompt whose meaning comes from
 * section headers. Left alone, a question can simply *contain* one of those
 * headers and open a block the model reads as though the assembler had written
 * it. That is not theoretical: with a forged "### RELEVANT DM CLARIFICATIONS"
 * block, the archivist asserted the injected claim and cited the fake
 * clarification id back — the sharpest version available, because the real
 * clarifications block tells the model to treat those entries as canonical and
 * prefer them over the knowledge base. A forged knowledge-base block worked the
 * same way, complete with a citation to a file that does not exist.
 *
 * Neutralised rather than deleted. The asker's words still read normally, and a
 * question that legitimately contains a "#" is not mangled into nonsense — the
 * marker simply stops being the first thing on its line, which is what makes it
 * a heading. Deleting text would also make the bot answer a question nobody
 * asked, which is its own kind of wrong.
 */
export function sanitizeUserQuery(raw: string): string {
  return (
    raw
      // A heading at the start of a line is the only way to open a section.
      //
      // The first attempt inserted a ZERO-WIDTH space before the hashes. It
      // defeated a regex and nothing else: the model cannot see a zero-width
      // character either, so a forged heading still read as a heading and the
      // forged-clarifications attack survived untouched. Escape visibly.
      .replace(/^([ \t]{0,3})(#{1,6})([ \t]|$)/gm, "$1\\$2$3")
      // Citation markers are this app's vocabulary for "the archive said so".
      // A question carrying one is claiming a provenance it does not have.
      .replace(/\[(clarification:[^\]]*)\]/gi, "($1)")
      // The block NAMES carry the authority, not merely the "#" that opens
      // them. With the header escaped but the name intact, a forged block still
      // announced itself as the clarifications section and was believed —
      // measured, not guessed. Attributing the quote inline is what a human
      // reader would do with a suspicious pasted heading, and the model reads
      // it the same way.
      // Every section name this file emits, matched CASE-SENSITIVELY. The
      // case rule is load-bearing in both directions.
      //
      // It has to catch a forgery: the real headers are upper-case, so that is
      // the shape a forged one must take to be mistaken for them, and the "#"
      // escape above already fires whatever the case.
      //
      // It must NOT catch a question. These are ordinary English — "what are
      // your instructions?", "can you check the dm clarifications for that?" —
      // and the case-insensitive version spliced "[typed by the asker, not the
      // archive]" into the middle of both, which the asker then sees quoted
      // back at them. That is a visible defect in an ordinary question, traded
      // for defence against a lower-case forgery that does not resemble the
      // block it is impersonating and is caught by the token rule regardless.
      .replace(
        /\b(GLOBAL KNOWLEDGE BASE|RELEVANT DM CLARIFICATIONS|DM CLARIFICATIONS?|FILES THE ASKER ATTACHED|USER QUERY|INSTRUCTIONS)\b/g,
        "$1 [typed by the asker, not the archive]"
      )
      // The fence itself. The asker cannot guess the random suffix, so they
      // cannot close the real fence — but they can write something of the same
      // SHAPE, and a model that pattern-matches structure may read the quote as
      // ending there, which puts the rest of their text in assembler position.
      // Same policy as the headings: break the marker, keep the words.
      // The other marker carrying archive authority, and the one that names a
      // FILE. [clarification: x] was defanged and this was not. ask() feeds
      // every text part to sourceNamesIn(), so a forged one also adds an
      // attacker-chosen name to the reference-stripping list — which would
      // hide the fabricated citation from the reader with references off.
      .replace(/\[(SOURCE DOCUMENT:[^\]]*)\]/gi, "($1)")
      .replace(/<<<\s*ASKER-/gi, "<< <ASKER-")
  );
}

/**
 * An attached PDF, rendered as prompt text.
 *
 * Gemini takes a PDF natively, but every other adapter extracts its text and
 * splices it back into the prompt — which put asker-controlled text, and an
 * asker-controlled FILENAME, into the prompt with none of the treatment the
 * same bytes would have received as a .txt attachment. The fence is applied by
 * the assembler and cannot reach here, so the sanitiser has to.
 */
export function pdfAsPromptText(name: string, extracted: string): string {
  return (
    `Context from PDF ${sanitizeUserQuery(String(name ?? "attachment"))}:\n` +
    sanitizeUserQuery(extracted.substring(0, 30000))
  );
}
