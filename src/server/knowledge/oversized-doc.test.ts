import { describe, expect, it, vi } from "vitest";

import { buildKnowledgeHeader, KB_CHAR_LIMIT } from "./loader";

// A single document larger than the concat cap used to produce an EMPTY
// corpus: the boundary walk cut at offset 0, the header announced "0
// document(s)", and the only trace was a console.warn. A ~200-page PDF is a
// plausible first upload, so the failure mode was "I installed it, uploaded my
// campaign, and the bot knows nothing".
describe("a document larger than the cap", () => {
  const oversized = (): { content: string; name: string } => {
    const name = "Campaign.md";
    return {
      name,
      content: `\n[SOURCE DOCUMENT: ${name}]\n` + "x".repeat(KB_CHAR_LIMIT + 10_000),
    };
  };

  it("still puts lore in the prompt", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { content, name } = oversized();
    const header = buildKnowledgeHeader(content, [name]);

    // The bug: everything after the header was "".
    expect(header.length).toBeGreaterThan(KB_CHAR_LIMIT / 2);
    expect(header).toContain("x".repeat(1000));
    vi.restoreAllMocks();
  });

  it("names the document rather than reporting zero", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { content, name } = oversized();
    const header = buildKnowledgeHeader(content, [name]);

    expect(header).not.toContain("0 document(s)");
    expect(header).toContain(name);
    vi.restoreAllMocks();
  });

  it("says it was cut IN THE HEADER, not only the server log", () => {
    // The model never reads console.warn. An earlier version of this test
    // asserted against warn.mock.calls and so did not test its own title: the
    // header still announced the document as loaded, which is precisely the
    // "hands the model a citation for free" failure buildKnowledgeHeader
    // exists to prevent.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { content, name } = oversized();
    const header = buildKnowledgeHeader(content, [name]);

    const preamble = header.slice(0, header.indexOf("xxx"));
    expect(preamble).toMatch(/TRUNCATED/);
    expect(preamble).toContain(name);
    vi.restoreAllMocks();
  });

  it("also records the truncation in the server log", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { content, name } = oversized();
    buildKnowledgeHeader(content, [name]);

    const said = warn.mock.calls.map(c => c.join(" ")).join("\n");
    expect(said).toContain(name);
    expect(said).toMatch(/larger than the limit/);
    vi.restoreAllMocks();
  });

  it("still keeps whole documents when they fit", () => {
    // The normal path must be untouched: two small documents, nothing cut.
    const content =
      "\n[SOURCE DOCUMENT: A.md]\n" + "a".repeat(100) +
      "\n[SOURCE DOCUMENT: B.md]\n" + "b".repeat(100);
    const header = buildKnowledgeHeader(content, ["A.md", "B.md"]);
    expect(header).toContain("2 document(s)");
    expect(header).toContain("a".repeat(100));
    expect(header).toContain("b".repeat(100));
  });
});
