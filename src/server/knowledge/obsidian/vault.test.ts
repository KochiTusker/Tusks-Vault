import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { walkVaultNotes, safeVaultPath, noteTitle } from "./walk";
import { parseNote, resolveWikilinks, relationLine } from "./note";
import {
  alignSummaries,
  digestText,
  extractJsonArray,
  mechanicalSummary,
} from "./map";

// A small vault laid out the way Obsidian actually lays one out: notes in
// folders, YAML frontmatter, wikilinks, a Templates folder that must not be
// indexed, and a .obsidian config directory.
let vault: string;

function write(rel: string, body: string): void {
  const abs = path.join(vault, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-vault-obsidian-"));
  fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });

  write(
    "NPCs/Ser Alric.md",
    [
      "---",
      "type: npc",
      "aliases: [The Grey Knight, Alric Vane]",
      "affiliations:",
      "  - \"[[Factions/House Vane|House Vane]]\"",
      "  - \"[[Factions/The Ashen Court]]\"",
      "---",
      "",
      "Ser Alric rode from [[Locations/Dunmar|Dunmar]] the night the gate fell.",
      "",
      "> [!warning] He does not know his brother lives.",
    ].join("\n")
  );

  write(
    "Locations/Dunmar.md",
    ["---", "type: location", "alias: The Drowned City", "---", "", "# Dunmar", "", "Dunmar fell in the Third Age."].join("\n")
  );

  write("Templates/NPC.md", "---\ntype: npc\n---\n\n{{title}}");
  write("_system/entity-index.json", "[]");
  write("README.md", "not lore");
  write(".obsidian/community-plugins.json", '["dataview"]');
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

describe("walkVaultNotes", () => {
  it("finds notes in folders and returns vault-relative POSIX paths", () => {
    const rels = walkVaultNotes(vault).map(n => n.relPath);
    expect(rels).toContain("NPCs/Ser Alric.md");
    expect(rels).toContain("Locations/Dunmar.md");
  });

  it("excludes Templates, _system, .obsidian and README", () => {
    const rels = walkVaultNotes(vault).map(n => n.relPath);
    // A Templates note is a blank entity skeleton — indexing it invents an
    // entity called "NPC" that the campaign has never heard of.
    expect(rels).not.toContain("Templates/NPC.md");
    expect(rels.some(r => r.startsWith("_system/"))).toBe(false);
    expect(rels.some(r => r.startsWith(".obsidian/"))).toBe(false);
    expect(rels).not.toContain("README.md");
  });

  it("returns notes sorted by path", () => {
    const rels = walkVaultNotes(vault).map(n => n.relPath);
    expect([...rels].sort((a, b) => a.localeCompare(b))).toEqual(rels);
  });

  it("returns an empty list for a path that doesn't exist", () => {
    expect(walkVaultNotes(path.join(vault, "nope"))).toEqual([]);
  });

  it("carries size and mtime so the map can detect changes", () => {
    const note = walkVaultNotes(vault).find(n => n.relPath === "Locations/Dunmar.md")!;
    expect(note.sizeBytes).toBeGreaterThan(0);
    expect(note.modifiedMs).toBeGreaterThan(0);
  });
});

describe("safeVaultPath", () => {
  it("resolves a note inside the vault", () => {
    expect(safeVaultPath(vault, "NPCs/Ser Alric.md")).toBe(path.resolve(vault, "NPCs/Ser Alric.md"));
  });

  it("refuses traversal out of the vault", () => {
    expect(safeVaultPath(vault, "../../../etc/passwd")).toBeNull();
  });

  it("refuses a backslash path identically on every platform", () => {
    // This assertion used to sit in the test above and passed only on Windows,
    // where `\` is a path separator. On Linux the same string is one ordinary
    // filename, so it resolved to a harmless path inside the vault and the
    // expectation failed — green on windows-latest, red on ubuntu-latest.
    //
    // The fix was in the guard rather than here: a vault-relative path is
    // POSIX by contract, so a backslash is refused outright and the answer no
    // longer depends on which OS is asking.
    expect(safeVaultPath(vault, "..\\..\\keys.enc")).toBeNull();
    expect(safeVaultPath(vault, "NPCs\\Ser Alric.md")).toBeNull();
  });

  it("refuses an absolute path", () => {
    expect(safeVaultPath(vault, path.join(os.tmpdir(), "elsewhere.md"))).toBeNull();
  });

  it("refuses a NUL byte and the empty string", () => {
    expect(safeVaultPath(vault, "a\0b.md")).toBeNull();
    expect(safeVaultPath(vault, "")).toBeNull();
  });

  it("refuses the vault root itself", () => {
    expect(safeVaultPath(vault, ".")).toBeNull();
  });
});

describe("parseNote", () => {
  it("reads type and an inline alias list", () => {
    const raw = fs.readFileSync(path.join(vault, "NPCs/Ser Alric.md"), "utf-8");
    const note = parseNote(raw, "NPCs/Ser Alric.md");
    expect(note.title).toBe("Ser Alric");
    expect(note.type).toBe("npc");
    expect(note.aliases).toEqual(["The Grey Knight", "Alric Vane"]);
  });

  it("reads the singular `alias:` spelling too", () => {
    const raw = fs.readFileSync(path.join(vault, "Locations/Dunmar.md"), "utf-8");
    expect(parseNote(raw, "Locations/Dunmar.md").aliases).toEqual(["The Drowned City"]);
  });

  it("reads a block-list relation and resolves its wikilink targets", () => {
    const raw = fs.readFileSync(path.join(vault, "NPCs/Ser Alric.md"), "utf-8");
    const note = parseNote(raw, "NPCs/Ser Alric.md");
    const aff = note.relations.find(r => r.key === "affiliations");
    // Both the piped and the bare form reduce to the target's basename.
    expect(aff?.targets).toEqual(["House Vane", "The Ashen Court"]);
  });

  it("strips the frontmatter fence from the body", () => {
    const raw = fs.readFileSync(path.join(vault, "NPCs/Ser Alric.md"), "utf-8");
    expect(parseNote(raw, "NPCs/Ser Alric.md").body).not.toContain("type: npc");
  });

  it("survives a note with no frontmatter at all", () => {
    const note = parseNote("Just prose, no fence.", "Loose.md");
    expect(note.title).toBe("Loose");
    expect(note.aliases).toEqual([]);
    expect(note.body).toBe("Just prose, no fence.");
  });

  it("ignores indented keys — they belong to a nested mapping", () => {
    // A nested `aliases:` under some other key describes that sub-object,
    // not the note. Reading it as top-level invents aliases.
    const note = parseNote(
      ["---", "type: npc", "stats:", "  aliases: [not, real]", "---", "", "body"].join("\n"),
      "N.md"
    );
    expect(note.aliases).toEqual([]);
  });
});

describe("resolveWikilinks", () => {
  it("keeps the display text of a piped link", () => {
    expect(resolveWikilinks("rode from [[Locations/Dunmar|Dunmar]] at dusk")).toBe("rode from Dunmar at dusk");
  });

  it("uses the last path segment of a bare link", () => {
    expect(resolveWikilinks("see [[Factions/House Vane]]")).toBe("see House Vane");
  });

  it("reduces a callout marker to a plain quote", () => {
    expect(resolveWikilinks("> [!warning] He does not know.")).toBe("> He does not know.");
  });

  it("drops a media embed rather than leaving its filename in the prose", () => {
    // An image embed used to survive link resolution as a bare "!dunmar.png",
    // which reads to a model as a fact about the world.
    expect(resolveWikilinks("See the map: ![[Maps/dunmar.png]] below.")).toBe("See the map:  below.");
  });

  it("turns a note embed into a pointer, not pasted content", () => {
    expect(resolveWikilinks("![[Locations/Dunmar]]")).toBe("(see: Dunmar)");
    expect(resolveWikilinks("![[Locations/Dunmar.md|the city]]")).toBe("(see: Dunmar)");
  });

  it("leaves ordinary markdown links alone", () => {
    const md = "see [the map](map.png)";
    expect(resolveWikilinks(md)).toBe(md);
  });
});

describe("mechanicalSummary — the no-AI fallback", () => {
  it("skips a heading and returns the first real sentence", () => {
    const note = parseNote(
      ["---", "type: location", "---", "", "# Dunmar", "", "Dunmar fell in the Third Age. It was never rebuilt."].join("\n"),
      "Dunmar.md"
    );
    expect(mechanicalSummary(note)).toBe("Dunmar fell in the Third Age.");
  });

  it("skips list bullets, quotes and images", () => {
    const note = parseNote(
      ["- a bullet", "> a quote", "![[an image.png]]", "The real opening line."].join("\n"),
      "N.md"
    );
    expect(mechanicalSummary(note)).toBe("The real opening line.");
  });

  it("still produces a digest for a note with no prose", () => {
    // An empty note must not vanish from retrieval — its title and type are
    // real information about what the vault contains.
    const note = parseNote(["---", "type: faction", "---", "", "# Heading only"].join("\n"), "House Vane.md");
    expect(mechanicalSummary(note)).toContain("House Vane");
    expect(mechanicalSummary(note)).toContain("faction");
  });
});

describe("digestText", () => {
  it("includes aliases so a query naming one still matches", () => {
    // The summary may never use the nickname the player types. If the alias
    // isn't in the embedded text, that query can't find the note.
    const text = digestText({
      title: "Ser Alric",
      type: "npc",
      aliases: ["The Grey Knight"],
      relations: "affiliations: House Vane",
      summary: "A knight who fled Dunmar.",
    });
    expect(text).toContain("The Grey Knight");
    expect(text).toContain("House Vane");
    expect(text).toContain("Ser Alric");
  });

  it("omits empty fields rather than leaving gaps", () => {
    const text = digestText({ title: "X", aliases: [], relations: "", summary: "A thing." });
    expect(text).toBe("X A thing.");
  });
});

describe("extractJsonArray", () => {
  it("parses a bare array", () => {
    expect(extractJsonArray('[{"path":"a.md","summary":"s"}]')).toHaveLength(1);
  });

  it("parses a fenced array", () => {
    expect(extractJsonArray('```json\n[{"path":"a.md"}]\n```')).toHaveLength(1);
  });

  it("parses an array wrapped in prose", () => {
    // Models preface and trail JSON constantly. Losing a whole batch to a
    // "Here you go:" is a cost with no upside.
    expect(extractJsonArray('Sure! Here you go:\n[{"path":"a.md"}]\nLet me know.')).toHaveLength(1);
  });

  it("returns null for a non-array and for unparseable text", () => {
    expect(extractJsonArray('{"path":"a.md"}')).toBeNull();
    expect(extractJsonArray("no json here")).toBeNull();
    expect(extractJsonArray("")).toBeNull();
  });
});

describe("alignSummaries", () => {
  const items = [
    { relPath: "a.md", parsed: parseNote("A", "a.md") },
    { relPath: "b.md", parsed: parseNote("B", "b.md") },
    { relPath: "c.md", parsed: parseNote("C", "c.md") },
  ];

  it("matches by path when the model echoed one", () => {
    const out = alignSummaries(items, [
      { path: "c.md", summary: "about C" },
      { path: "a.md", summary: "about A" },
    ]);
    expect(out.get("a.md")?.summary).toBe("about A");
    expect(out.get("c.md")?.summary).toBe("about C");
    expect(out.has("b.md")).toBe(false);
  });

  it("falls back to position only when the row count matches exactly", () => {
    const out = alignSummaries(items, [{ summary: "1" }, { summary: "2" }, { summary: "3" }]);
    expect(out.get("a.md")?.summary).toBe("1");
    expect(out.get("c.md")?.summary).toBe("3");
  });

  it("drops pathless rows when the count does NOT match", () => {
    // The decisive case. A model that omits one note would otherwise shift
    // every later summary onto the wrong note, producing a map that looks
    // fine and retrieves the wrong pages — worse than no map.
    const out = alignSummaries(items, [{ summary: "1" }, { summary: "2" }]);
    expect(out.size).toBe(0);
  });

  it("keeps path-matched rows even when the count is wrong", () => {
    const out = alignSummaries(items, [{ path: "b.md", summary: "about B" }, { summary: "orphan" }]);
    expect(out.size).toBe(1);
    expect(out.get("b.md")?.summary).toBe("about B");
  });

  it("ignores rows with an empty summary and unknown paths", () => {
    const out = alignSummaries(items, [
      { path: "a.md", summary: "   " },
      { path: "zzz.md", summary: "not in this batch" },
    ]);
    expect(out.size).toBe(0);
  });

  it("truncates an over-long summary instead of accepting it", () => {
    const out = alignSummaries(items, [{ path: "a.md", summary: "x".repeat(1000) }]);
    expect(out.get("a.md")!.summary.length).toBeLessThanOrEqual(240);
  });

  it("keeps topics when present and tolerates a non-array", () => {
    const out = alignSummaries(items, [
      { path: "a.md", summary: "s", topics: ["Dunmar", "siege", 7] },
      { path: "b.md", summary: "s", topics: "not an array" },
    ]);
    expect(out.get("a.md")!.topics).toEqual(["Dunmar", "siege"]);
    expect(out.get("b.md")!.topics).toEqual([]);
  });
});

describe("relationLine", () => {
  it("renders aliases and relations as one line", () => {
    const raw = fs.readFileSync(path.join(vault, "NPCs/Ser Alric.md"), "utf-8");
    const line = relationLine(parseNote(raw, "NPCs/Ser Alric.md"));
    expect(line).toContain("also known as The Grey Knight");
    expect(line).toContain("affiliations: House Vane");
  });

  it("is empty for a note that declares nothing", () => {
    expect(relationLine(parseNote("body only", "n.md"))).toBe("");
  });
});

describe("noteTitle", () => {
  it("is the filename stem", () => {
    expect(noteTitle("NPCs/Ser Alric.md")).toBe("Ser Alric");
    expect(noteTitle("Dunmar.md")).toBe("Dunmar");
  });
});
