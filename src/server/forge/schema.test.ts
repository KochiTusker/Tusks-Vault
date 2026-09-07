import { describe, it, expect } from "vitest";
import { folderFor, noteFilename, safeNoteFilename, DEFAULT_FOLDER } from "./schema";

// Control characters below are written as ESCAPE SEQUENCES, never as raw
// bytes. A literal 0x00 in this file would make git and the tree audit
// read it as binary — which is the exact defect these cases exist to pin.

describe("noteFilename", () => {
  it("strips every C0 control character", () => {
    expect(noteFilename("Ka\x00ldor")).toBe("Ka ldor");
    expect(noteFilename("Ka\x1fldor")).toBe("Ka ldor");
    expect(noteFilename("Ka\x07ldor")).toBe("Ka ldor");
    // The boundaries of the \x00-\x1f range, and the character just past it.
    expect(noteFilename("a\x01b")).toBe("a b");
    expect(noteFilename("a\x1eb")).toBe("a b");
    expect(noteFilename("a\x20b")).toBe("a b"); // 0x20 is a plain space
  });

  it("strips the characters Windows reserves, without substituting dashes", () => {
    // Deliberate per the doc comment: `Who? What?` reads better as
    // `Who What` than `Who- What-`, and frontmatter keeps the original.
    expect(noteFilename("Who? What?")).toBe("Who What");
    expect(noteFilename('a<b>c:d"e/f\\g|h?i*j')).toBe("a b c d e f g h i j");
  });

  it("collapses runs of whitespace left behind by stripping", () => {
    expect(noteFilename("The  Dunmar   Accord")).toBe("The Dunmar Accord");
    expect(noteFilename("A<>B")).toBe("A B");
  });

  it("trims leading dots and whitespace, which hide files on POSIX", () => {
    expect(noteFilename("  .hidden note  ")).toBe("hidden note");
    expect(noteFilename("...Council")).toBe("Council");
    expect(noteFilename("Council...")).toBe("Council");
  });

  it("caps the length so no filesystem rejects the name", () => {
    expect(noteFilename("x".repeat(300))).toHaveLength(120);
  });

  it("never returns an empty name", () => {
    // A title made entirely of stripped characters would otherwise produce
    // "", and a note written to "" is a note written over its own directory.
    expect(noteFilename("")).toBe("Untitled");
    expect(noteFilename("   ")).toBe("Untitled");
    expect(noteFilename("<<>>")).toBe("Untitled");
    expect(noteFilename("\x00\x01\x1f")).toBe("Untitled");
  });

  it("leaves an ordinary title untouched", () => {
    expect(noteFilename("The Sunken Court")).toBe("The Sunken Court");
  });
});

describe("safeNoteFilename", () => {
  it("disambiguates names Windows refuses regardless of extension", () => {
    // These are device names on Windows: `CON.md` cannot be created at all.
    expect(safeNoteFilename("CON")).toBe("CON (note)");
    expect(safeNoteFilename("nul")).toBe("nul (note)");
    expect(safeNoteFilename("com1")).toBe("com1 (note)");
    expect(safeNoteFilename("LPT9")).toBe("LPT9 (note)");
  });

  it("leaves everything else as noteFilename produced it", () => {
    expect(safeNoteFilename("Control Room")).toBe("Control Room");
    expect(safeNoteFilename("com10")).toBe("com10"); // only com1-com9 are reserved
  });
});

describe("folderFor", () => {
  it("falls back to the default folder for an unknown or missing type", () => {
    expect(folderFor(undefined)).toBe(DEFAULT_FOLDER);
    expect(folderFor("")).toBe(DEFAULT_FOLDER);
    expect(folderFor("not-a-real-type")).toBe(DEFAULT_FOLDER);
  });

  it("matches a type case-insensitively", () => {
    expect(folderFor("person")).toBe(folderFor("PERSON"));
  });
});
