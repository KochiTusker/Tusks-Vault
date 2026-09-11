import { createRequire } from "module";
import type { ContentPart } from "../llm/types";
import { MAX_PDF_BYTES, PDF_TIMEOUT_MS } from "../util/pdf-text";

const require = createRequire(import.meta.url);
const mammoth = require("mammoth");

interface DiscordAttachmentLike {
  url: string;
  name?: string | null;
  contentType?: string | null;
}

/**
 * Ceilings for a file an ASKER uploaded.
 *
 * The lore-ingest path has had these since v1.0.2 (`pdf-text.ts`), but they
 * guard documents the GM chose to put in their own folder. This path is the
 * other way round: anyone who can mention the bot, or DM it, can attach up to
 * ten files, and every byte was fetched and buffered before anything looked at
 * the size. The guard was on the trusted side and absent from the untrusted
 * one.
 *
 * Same numbers as the ingest path deliberately — "how large a document may
 * Vault read" should not depend on which door it arrived through — plus an
 * aggregate, because the per-file limit alone still allowed ten of them.
 */
const MAX_ATTACHMENT_BYTES = MAX_PDF_BYTES;
const MAX_MESSAGE_BYTES = MAX_PDF_BYTES;

/** How much text of any one attachment reaches the prompt. Unchanged; this is
 *  a prompt-budget trim, and it never limited what was downloaded or parsed. */
const MAX_EXTRACTED_CHARS = 30_000;

class AttachmentTooLarge extends Error {
  /** Bytes that actually came off the wire before the cap tripped. A
   *  content-length rejection transfers nothing; a lying one transfers up to
   *  the limit. The caller spends the message budget by this, so ten oversized
   *  files cost one budget rather than ten. */
  readonly transferred: number;
  constructor(limit: number, transferred: number) {
    super(
      limit < 1024 * 1024
        ? `larger than the space left in this message`
        : `larger than the ${Math.round(limit / 1024 / 1024)} MB limit`
    );
    this.transferred = transferred;
  }
}

/**
 * Fetch at most `limit` bytes, and stop pulling as soon as that is exceeded.
 *
 * Content-length is checked first because it rejects an oversized file without
 * transferring it, but it is a claim by the sender, so the running total below
 * is the guard that actually holds.
 */
async function fetchCapped(url: string, limit: number): Promise<Buffer> {
  // The byte cap bounds volume, not time: a response that trickles forever
  // would hold this handler open indefinitely. NOTE for any future caller —
  // the URL must come from a trusted gateway payload (Discord's own CDN),
  // never from request input, or this becomes an SSRF primitive.
  const response = await fetch(url, { signal: AbortSignal.timeout(PDF_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching attachment`);

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new AttachmentTooLarge(limit, 0);

  if (!response.body) {
    // Under undici a null body means an EMPTY body, so this is not a bypass
    // today; the check stays in case that ever stops being true.
    const whole = Buffer.from(await response.arrayBuffer());
    if (whole.byteLength > limit) throw new AttachmentTooLarge(limit, whole.byteLength);
    return whole;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > limit) {
      // Throwing unwinds the for-await, which calls the iterator's return() and
      // hangs up the stream. (An explicit body.cancel() here would be a no-op:
      // the for-await holds the lock, so cancel on a locked stream rejects.)
      throw new AttachmentTooLarge(limit, total);
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Bound the ASYNC part of a parse.
 *
 * Honest about what this does and does not do: a Promise race cannot interrupt
 * synchronous CPU work, so a parser that blocks the event loop inside one tick
 * runs to completion regardless. The size cap above is the real defence for
 * that case; this catches a parse that stalls waiting on something.
 */
function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`${what} exceeded ${ms} ms`)), ms);
      timer.unref?.();
      void work.finally(() => clearTimeout(timer)).catch(() => {});
    }),
  ]);
}

export async function parseDiscordAttachments(
  attachments: Iterable<DiscordAttachmentLike>
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];
  let budget = MAX_MESSAGE_BYTES;

  for (const attachment of attachments) {
    const contentType = attachment.contentType ?? "";
    const name = attachment.name ?? "attachment";
    // Never let one file's allowance exceed what is left for the message.
    const limit = Math.min(MAX_ATTACHMENT_BYTES, budget);

    try {
      if (limit <= 0) throw new Error("the message's total attachment budget is used up");

      if (contentType.startsWith("image/")) {
        const buffer = await fetchCapped(attachment.url, limit);
        budget -= buffer.byteLength;
        parts.push({ type: "image", mime: contentType, base64: buffer.toString("base64") });
      } else if (contentType === "application/pdf") {
        // Pass raw PDF bytes through to the adapter. Gemini accepts native
        // PDFs; the others pre-extract text.
        const buffer = await fetchCapped(attachment.url, limit);
        budget -= buffer.byteLength;
        parts.push({
          type: "document",
          mime: "application/pdf",
          base64: buffer.toString("base64"),
          name,
        });
      } else if (
        contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        const buffer = await fetchCapped(attachment.url, limit);
        budget -= buffer.byteLength;
        const result = await withTimeout<{ value: string }>(
          mammoth.extractRawText({ buffer }),
          PDF_TIMEOUT_MS,
          `DOCX extraction of ${name}`
        );
        parts.push({
          type: "text",
          text: `Context from DOCX ${name}:\n${result.value.substring(0, MAX_EXTRACTED_CHARS)}`,
        });
      } else if (contentType.startsWith("text/")) {
        const buffer = await fetchCapped(attachment.url, limit);
        budget -= buffer.byteLength;
        parts.push({
          type: "text",
          text: `Context from file ${name}:\n${buffer.toString("utf8").substring(0, MAX_EXTRACTED_CHARS)}`,
        });
      }
    } catch (err) {
      // Say WHY in the prompt as well as the console. A silent skip made the
      // archivist answer as though the file had been read and contained
      // nothing relevant, which reads to the table as the bot ignoring them.
      // Bytes pulled off the wire spend the budget even when the file is
      // refused — otherwise ten oversized uploads cost ten times the stated
      // per-message ceiling, which is the case the aggregate exists for. A
      // content-length rejection transfers nothing and so still costs nothing,
      // which is what keeps one huge file from silencing the rest.
      if (err instanceof AttachmentTooLarge) budget -= err.transferred;
      const why = err instanceof AttachmentTooLarge ? ` — ${err.message}` : "";
      console.error(`Error parsing attachment ${name}:`, err);
      parts.push({ type: "text", text: `(Attachment ${name} could not be read${why})` });
    }
  }

  return parts;
}
