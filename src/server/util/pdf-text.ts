// The one place that turns a PDF into text.
//
// Two separate defects live here, and both are the reason this file exists
// rather than five inline `require("pdf-parse")` calls.
//
// 1. THE CALLING CONVENTION CHANGED AND NOTHING CAUGHT IT.
//    pdf-parse v1 exported a callable: `const data = await pdf(buffer)`.
//    v2 exports `{ PDFParse }` — a class — and is not callable at all. Every
//    call site in this repo was still written against v1, so every one of them
//    threw `TypeError: pdf is not a function` the moment it touched a PDF.
//    `tsc` could not see it: the module came in through `createRequire`, which
//    is typed `any`, so the type checker had nothing to check. The lore loader
//    catches per-file ingest errors and logs them, so the visible symptom was
//    not a crash — it was PDFs silently contributing nothing to the corpus.
//
//    The fix therefore has to RESTORE the type checking, not relocate the hole:
//    the dynamic import below is typed straight off the package's own
//    declarations (`typeof import("pdf-parse")`), with no cast anywhere. A
//    future v3 that renames `getText` fails the build instead of failing
//    silently at runtime. Do not reintroduce a hand-written interface and an
//    `as unknown as` here — that is the original bug wearing a different hat.
//
// 2. LOADING pdf-parse CAN KILL THE PROCESS ON WINDOWS ON ARM.
//    pdf-parse depends on `@napi-rs/canvas` for the DOMMatrix/ImageData/Path2D
//    globals PDF.js expects. It wraps that require in a try/catch and only
//    warns — but then dereferences `DOMMatrix` in its own module body, so the
//    import throws `DOMMatrix is not defined` a few lines later anyway.
//    That import used to sit at the top of knowledge/loader.ts, which
//    server/index.ts imports at boot, so a machine with no matching canvas
//    binary could not start the server at all — no dashboard, no error the
//    launcher could explain.
//
//    The import is therefore LAZY and must stay lazy. A user with no PDFs
//    should never load the native stack, and a user whose platform has no
//    binary should lose PDF ingest, not the whole application. Moving this to
//    a top-level import would silently restore the boot crash.
//
// The `@napi-rs/canvas` version is pinned forward via `overrides` in
// package.json — pdf-parse pins 0.1.80 exactly, and 0.1.80 ships no
// win32-arm64 build. See that block for the full reasoning.

/**
 * Largest PDF we will hand to the parser.
 *
 * Worth stating plainly why this arrived with the fix rather than before it:
 * until now every call site threw immediately, so PDF.js never actually ran on
 * user input. This release makes that path live for the first time, which
 * turns a dormant parsing surface into a real one — and the upload route it is
 * reachable from carries no size limit of its own. A real campaign PDF is a
 * few MB; this leaves generous headroom while refusing the pathological case.
 */
export const MAX_PDF_BYTES = 64 * 1024 * 1024;

/**
 * Wall-clock ceiling on one extraction.
 *
 * A size cap alone does not bound the work: a small, deeply nested or
 * decompression-heavy document can occupy the parser indefinitely, and this is
 * a single-process server — one stuck parse is the whole application. The
 * `finally` in `extractPdfText` still runs on timeout, so the PDF.js worker is
 * released either way.
 */
export const PDF_TIMEOUT_MS = 60_000;

/** Raised when the platform has no usable pdf-parse native stack. Callers
 *  distinguish this from "this PDF is broken" so the person who attached the
 *  file learns their machine cannot read PDFs at all. */
export class PdfSupportUnavailableError extends Error {
  constructor(cause: unknown) {
    // The loader error goes on `cause`, not into the message: a Node module
    // resolution failure embeds absolute paths, and this string is logged —
    // and the troubleshooting docs invite users to paste logs into public
    // issues. The message stays human, actionable, and free of local paths.
    super(
      "PDF support is unavailable on this machine: the pdf-parse native " +
        "dependency (@napi-rs/canvas) has no binary for this platform. " +
        "Everything except PDF documents still works — convert the PDF to " +
        ".md, .txt or .docx to read it."
    );
    this.name = "PdfSupportUnavailableError";
    this.cause = cause;
  }
}

/**
 * What to put in the prompt in place of a PDF that could not be read.
 *
 * The distinction is the whole reason `PdfSupportUnavailableError` exists. A
 * flat "(Could not parse PDF x)" tells someone on a platform with no native
 * binary to go and check their file, which is the one thing that will not help
 * — the fix is to convert it, and nothing else they attach will work either.
 * The text goes to the model rather than the user directly, so it is phrased
 * as something the model can relay.
 */
export function describePdfFailure(err: unknown, name: string): string {
  if (err instanceof PdfSupportUnavailableError) {
    return `(Could not read PDF ${name}: this installation cannot read PDF files at all — ${err.message})`;
  }
  return `(Could not parse PDF ${name})`;
}

// Resolved once and reused. Held as the promise rather than the module so
// concurrent first calls (the loader walks files in a loop) share one load
// instead of racing several native inits.
type PdfParseModule = typeof import("pdf-parse");
let modulePromise: Promise<PdfParseModule> | null = null;

function loadPdfParse(): Promise<PdfParseModule> {
  if (!modulePromise) {
    modulePromise = import("pdf-parse").catch(err => {
      // Clearing the slot lets a later call retry. Note this only helps for a
      // resolution or read error: Node's ESM registry caches a module's
      // *evaluation* failure permanently, so the Windows-on-ARM case
      // (`DOMMatrix is not defined`) returns the same rejection forever no
      // matter what we do here. That is the correct outcome for a missing
      // native binary, which will not appear mid-process.
      modulePromise = null;
      throw new PdfSupportUnavailableError(err);
    });
  }
  return modulePromise;
}

/**
 * Extract the plain text of a PDF.
 *
 * @throws {PdfSupportUnavailableError} when the platform has no native stack.
 * @throws {Error} for a PDF that is too large, too slow, encrypted, corrupt,
 *   or otherwise unreadable.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new Error(
      `PDF is ${Math.round(buffer.byteLength / 1024 / 1024)} MB, over the ` +
        `${MAX_PDF_BYTES / 1024 / 1024} MB limit for text extraction.`
    );
  }

  const { PDFParse } = await loadPdfParse();
  const parser = new PDFParse({ data: buffer });
  let timer: NodeJS.Timeout | undefined;
  try {
    // pageJoiner defaults to "\n-- <page> of <total> --", which would put a
    // marker line inside every multi-page document in the corpus — and those
    // lines then reach the model as if the author wrote them, and can be
    // quoted back in a cited answer. A bare newline keeps the page boundary
    // without inventing text, matching what v1 produced.
    const result = await Promise.race([
      parser.getText({ pageJoiner: "\n" }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`PDF text extraction exceeded ${PDF_TIMEOUT_MS} ms.`)),
          PDF_TIMEOUT_MS
        );
      }),
    ]);
    return result.text;
  } finally {
    clearTimeout(timer);
    // getText holds a PDF.js worker open. Without this the process keeps a
    // live handle per parsed document and a large folder ingest leaks them.
    await parser.destroy().catch(() => {
      /* a failed teardown must not mask a successful extraction */
    });
  }
}
