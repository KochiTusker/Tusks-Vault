// These tests exist because the previous arrangement had none, and the defect
// they cover shipped in v1.0.0 and v1.0.1: every call site invoked pdf-parse
// with the v1 convention (`await pdf(buffer)`) against a v2 package that
// exports a class and is not callable. The module came in via `createRequire`,
// which is typed `any`, so `tsc` saw nothing — and the lore loader catches
// per-file ingest errors, so the only symptom was PDFs quietly adding nothing
// to the corpus.
//
// The lesson encoded here: a document parser must be tested against a real
// document, not a mock. A mock would have agreed with whatever convention the
// code used and stayed green through the break.

import { describe, expect, it } from "vitest";
import { extractPdfText, MAX_PDF_BYTES } from "./pdf-text";

/**
 * Build a minimal but genuinely valid single-page PDF containing `body`.
 *
 * Written by hand rather than committed as a binary fixture: a checked-in PDF
 * is an opaque blob nobody can review in a diff, and carries whatever metadata
 * the tool that produced it felt like embedding. This is ~20 lines of the
 * format's simplest legal form, and every byte of it is readable here.
 */
function makePdf(body: string): Buffer {
  const objects = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]" +
      "/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj",
    "4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
  ];
  const stream = `BT /F1 24 Tf 72 700 Td (${body}) Tj ET`;
  objects.push(`5 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += `${obj}\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;

  // latin1: the offsets above are byte offsets, and a multi-byte encoding
  // would shift every one of them and produce an invalid xref table.
  return Buffer.from(pdf, "latin1");
}

describe("extractPdfText", () => {
  it("extracts the text of a real PDF", async () => {
    // The regression test proper. Under the old `await pdf(buffer)` call this
    // threw `TypeError: pdf is not a function`.
    const text = await extractPdfText(makePdf("The harbour master keeps a ledger."));
    expect(text).toContain("The harbour master keeps a ledger.");
  });

  it("does not inject page markers into the extracted text", async () => {
    // pdf-parse v2 defaults pageJoiner to "\n-- <page> of <total> --". Those
    // lines would reach the model indistinguishable from something the author
    // wrote, and could be quoted back inside a cited answer.
    const text = await extractPdfText(makePdf("Ashvale keeps no standing army."));
    expect(text).not.toMatch(/--\s*\d+\s+of\s+\d+\s*--/);
  });

  it("rejects rather than resolving empty when the bytes are not a PDF", async () => {
    // Ingest decides whether to record a document by whether text came back.
    // Resolving "" for a corrupt file would file it as a successfully-read
    // empty document instead of reporting the failure.
    await expect(extractPdfText(Buffer.from("this is not a PDF"))).rejects.toThrow();
  });

  it("refuses an oversized buffer before handing it to the parser", async () => {
    // Until this release every call site threw immediately, so PDF.js never
    // ran on user input. Making the path live turns a dormant parsing surface
    // into a real one, and the upload route has no size limit of its own.
    const huge = Buffer.alloc(MAX_PDF_BYTES + 1);
    await expect(extractPdfText(huge)).rejects.toThrow(/over the .* limit/);
  });

  it("keeps local filesystem paths out of the unsupported-platform message", async () => {
    // The message is logged, and the troubleshooting docs tell users to paste
    // logs into public issues. A Node resolution failure embeds absolute paths
    // like C:\Users\<name>\... — those belong on `cause`, not in the text.
    const { PdfSupportUnavailableError } = await import("./pdf-text");
    // A drive-rooted path with no user-profile segment: enough to prove the
    // message strips absolute paths, without writing a home-directory shape
    // into a public-bound file just to test that we avoid them.
    const leaky = String.raw`Cannot find module 'C:\app\node_modules\canvas\index.js'`;
    const err = new PdfSupportUnavailableError(new Error(leaky));
    expect(err.message).not.toMatch(/[A-Za-z]:\\|\/home\/|\/Users\//);
    expect(err.message).toContain(".md, .txt or .docx");
    expect(err.cause).toBeInstanceOf(Error);
  });
});

describe("pdf-parse is loaded lazily", () => {
  it("is not pulled in by importing the server's boot path", async () => {
    // The load-bearing property, and the one a refactor is most likely to undo.
    // pdf-parse's canvas dependency throws at import on any platform with no
    // matching native binary (Windows on ARM before the package.json override),
    // so a top-level import anywhere on the boot path takes the whole server
    // down instead of just PDF ingest.
    const source = await import("node:fs").then(fs =>
      fs.readFileSync(new URL("./pdf-text.ts", import.meta.url), "utf-8")
    );

    // Strip comments first — this file explains the rule in prose, and prose
    // must not be able to fail the check that enforces it.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(code).toContain('import("pdf-parse")');
    expect(code).not.toMatch(/^\s*import\s[^\n]*from\s*["']pdf-parse["']/m);
  });

  it("is not imported at the top level of any module on the boot path", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    const serverDir = path.resolve(here, "..");

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          const src = fs.readFileSync(full, "utf-8");
          // A static import, or a top-level createRequire of pdf-parse: both
          // execute the moment the module is first loaded.
          if (/^\s*import\s[^\n]*from\s*["']pdf-parse["']/m.test(src)) offenders.push(full);
          if (/^\s*const\s+\w+\s*=\s*require\(\s*["']pdf-parse["']\s*\)/m.test(src)) offenders.push(full);
        }
      }
    };
    walk(serverDir);

    expect(offenders).toEqual([]);
  });
});
