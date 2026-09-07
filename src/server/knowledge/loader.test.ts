import { describe, expect, it } from "vitest";
import { isPlaceholderFile, isIngestible, FORGED_VAULT_MARKER } from "./loader";

describe("isPlaceholderFile — what is NOT campaign material", () => {
  it("skips scaffolding a user did not write", () => {
    expect(isPlaceholderFile("README.md")).toBe(true);
    expect(isPlaceholderFile("readme.txt")).toBe(true);
  });

  it("skips Vault's own state stored inside the lore folder", () => {
    // config/paths.ts keeps these beside the campaign so they survive a
    // reinstall. Unfiltered, the bot ingests its own list of unanswered
    // questions and its own stored clarifications as canon, and then cites
    // them back — a closed loop where its bookkeeping becomes lore.
    expect(isPlaceholderFile("lore_gaps.json")).toBe(true);
    expect(isPlaceholderFile("clarifications.json")).toBe(true);
    expect(isPlaceholderFile("clarifications.embeddings.json")).toBe(true);
    expect(isPlaceholderFile("tusks-vault.log")).toBe(true);
  });

  it("skips companion-tool metadata", () => {
    expect(isPlaceholderFile("tusks-lore.json")).toBe(true);
    expect(isPlaceholderFile("glossary.json")).toBe(true);
  });

  it("is case-insensitive, because filenames on disk are not consistent", () => {
    expect(isPlaceholderFile("Lore_Gaps.JSON")).toBe(true);
  });

  it("skips dot- and underscore-prefixed files by convention", () => {
    expect(isPlaceholderFile(".hidden.md")).toBe(true);
    expect(isPlaceholderFile("_draft.md")).toBe(true);
  });

  it("keeps real campaign documents", () => {
    // The filter must not creep: a campaign legitimately has a file with
    // "lore" or "notes" in its name.
    for (const name of ["Characters.md", "World Overview.md", "lore-primer.md", "Session Notes.docx"]) {
      expect(isPlaceholderFile(name)).toBe(false);
    }
  });
});

describe("isIngestible", () => {
  it("accepts the document formats a campaign actually uses", () => {
    for (const f of ["a.md", "a.docx", "a.pdf", "a.txt"]) expect(isIngestible(f)).toBe(true);
  });

  it("rejects a backup or an archive", () => {
    for (const f of ["a.md.bak", "a.zip", "a.png"]) expect(isIngestible(f)).toBe(false);
  });
});

describe("FORGED_VAULT_MARKER", () => {
  it("is a dotfile, so it never shows up as a note in Obsidian", () => {
    expect(FORGED_VAULT_MARKER.startsWith(".")).toBe(true);
  });
});
