import { describe, expect, it } from "vitest";
import { displayFileName } from "./loreFileName";

describe("displayFileName", () => {
  it("strips the upload timestamp prefix", () => {
    expect(displayFileName("1712345678901-campaign notes.md")).toBe("campaign notes.md");
  });

  it("keeps hyphens that are part of the real name", () => {
    // The regression this exists for. The old implementation split on "-"
    // and dropped the first piece, so a Tomes chronicle lost its "Session"
    // and an Obsidian note lost everything before the dash.
    expect(displayFileName("Session-01-2024-03-12.docx")).toBe("Session-01-2024-03-12.docx");
    expect(displayFileName("Session 12 - The Ninefold Rest.md")).toBe("Session 12 - The Ninefold Rest.md");
  });

  it("strips the prefix but keeps hyphens in what follows", () => {
    expect(displayFileName("1712345678901-Session-01-2024.docx")).toBe("Session-01-2024.docx");
  });

  it("keeps the folder part of a nested path", () => {
    // Folders are how a user tells two same-named notes apart, and how the
    // model's citation resolves back to a file.
    expect(displayFileName("Sessions/Curse of Strahd/Session-01.docx")).toBe(
      "Sessions/Curse of Strahd/Session-01.docx"
    );
  });

  it("strips a prefix on the basename only, never a folder", () => {
    expect(displayFileName("Sessions/1712345678901-notes.md")).toBe("Sessions/notes.md");
    expect(displayFileName("1712345678901-folder/notes.md")).toBe("1712345678901-folder/notes.md");
  });

  it("leaves a leading number that isn't a timestamp", () => {
    expect(displayFileName("2024-report.md")).toBe("2024-report.md");
    expect(displayFileName("01-intro.md")).toBe("01-intro.md");
  });

  it("does not reduce a name to nothing", () => {
    // A file literally named "<digits>-" must keep something to render.
    expect(displayFileName("1712345678901-")).toBe("1712345678901-");
  });

  it("passes through names with no hyphen at all", () => {
    expect(displayFileName("lore.md")).toBe("lore.md");
    expect(displayFileName("")).toBe("");
  });
});
