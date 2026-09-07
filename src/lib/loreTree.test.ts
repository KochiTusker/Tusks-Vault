import { describe, expect, it } from "vitest";
import { ROOT_GROUP, filterLoreFiles, groupLoreFiles } from "./loreTree";

const f = (name: string, size = 1024, indexed?: boolean) => ({ name, size, indexed });

describe("groupLoreFiles", () => {
  it("groups on the top-level folder and keeps the rest of the path on the row", () => {
    const groups = groupLoreFiles([
      f("02 - NPCs/Background/Maera the Ashbound.md"),
      f("02 - NPCs/House Corrin/Lady Ismet.md"),
      f("03 - Factions/The Ashen Court.md"),
    ]);

    expect(groups.map(g => g.name)).toEqual(["02 - NPCs", "03 - Factions"]);
    expect(groups[0].files.map(x => x.subPath)).toEqual([
      "Background/Maera the Ashbound.md",
      "House Corrin/Lady Ismet.md",
    ]);
    expect(groups[1].files[0].subPath).toBe("The Ashen Court.md");
  });

  it("sorts numbered folders the way a human reads them, not by codepoint", () => {
    const groups = groupLoreFiles([f("10 - Appendices/a.md"), f("02 - NPCs/b.md"), f("1 - Intro/c.md")]);

    // A plain string sort would put "10" between "1" and "02".
    expect(groups.map(g => g.name)).toEqual(["1 - Intro", "02 - NPCs", "10 - Appendices"]);
  });

  it("orders sessions numerically inside a group", () => {
    const groups = groupLoreFiles([
      f("06 - Sessions/Session 10/notes.md"),
      f("06 - Sessions/Session 2/notes.md"),
      f("06 - Sessions/Session 1/notes.md"),
    ]);

    expect(groups[0].files.map(x => x.subPath)).toEqual([
      "Session 1/notes.md",
      "Session 2/notes.md",
      "Session 10/notes.md",
    ]);
  });

  it("puts loose root files in their own group, always last", () => {
    const groups = groupLoreFiles([f("README.md"), f("02 - NPCs/a.md")]);

    expect(groups.map(g => g.name)).toEqual(["02 - NPCs", ROOT_GROUP]);
    expect(groups[1].files[0].subPath).toBe("README.md");
  });

  it("totals bytes and counts unreadable files per group", () => {
    const groups = groupLoreFiles([
      f("Lore/a.md", 1000),
      f("Lore/b.png", 2000, false),
      f("Lore/c.md", 500, true),
    ]);

    expect(groups[0].bytes).toBe(3500);
    expect(groups[0].unreadable).toBe(1);
  });

  it("strips an upload timestamp prefix rather than grouping on it", () => {
    // The prefix is on the basename, so a loose upload must not become a folder.
    const groups = groupLoreFiles([f("1712345678901-campaign notes.md")]);

    expect(groups[0].name).toBe(ROOT_GROUP);
    expect(groups[0].files[0].subPath).toBe("campaign notes.md");
  });

  it("treats a Windows-authored path as folders, not as one long filename", () => {
    const groups = groupLoreFiles([f("02 - NPCs\\Background\\Maera the Ashbound.md")]);

    expect(groups[0].name).toBe("02 - NPCs");
    expect(groups[0].files[0].subPath).toBe("Background/Maera the Ashbound.md");
  });

  it("returns nothing for an empty corpus rather than an empty group", () => {
    expect(groupLoreFiles([])).toEqual([]);
  });
});

describe("filterLoreFiles", () => {
  const corpus = [
    f("02 - NPCs/House Corrin/Lady Ismet.md"),
    f("02 - NPCs/Background/Maera the Ashbound.md"),
    f("06 - Sessions/Session 04/notes.md"),
  ];

  it("matches on the folder, so a family or a session finds its whole set", () => {
    expect(filterLoreFiles(corpus, "corrin").map(x => x.name)).toEqual([
      "02 - NPCs/House Corrin/Lady Ismet.md",
    ]);
    expect(filterLoreFiles(corpus, "session 04")).toHaveLength(1);
  });

  it("matches on the filename too, and ignores case", () => {
    expect(filterLoreFiles(corpus, "MAERA")).toHaveLength(1);
  });

  it("returns everything for a blank or whitespace query", () => {
    expect(filterLoreFiles(corpus, "")).toHaveLength(3);
    expect(filterLoreFiles(corpus, "   ")).toHaveLength(3);
  });
});
