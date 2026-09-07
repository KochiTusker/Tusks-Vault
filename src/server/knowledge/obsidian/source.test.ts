import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFullVaultKnowledge, buildMappedVaultKnowledge, listVaultNotes, MAPPED_BODY_BUDGET,
  temporalNote,
} from "./source";
import { buildVaultMap, deleteVaultMap, readVaultMap, RELATIVE_FLOOR, renderMapForPrompt } from "./map";

let vault: string;
let configDir: string;
let originalConfigDir: string | undefined;

function write(rel: string, body: string): void {
  const abs = path.join(vault, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-src-vault-"));
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-src-config-"));
  originalConfigDir = process.env.TUSKS_VAULT_CONFIG_DIR;
  process.env.TUSKS_VAULT_CONFIG_DIR = configDir;
});

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.TUSKS_VAULT_CONFIG_DIR;
  else process.env.TUSKS_VAULT_CONFIG_DIR = originalConfigDir;
  fs.rmSync(vault, { recursive: true, force: true });
  fs.rmSync(configDir, { recursive: true, force: true });
});

/** Note count that puts the fixture past MAPPED_BODY_BUDGET. Each note is
 *  ~1.45 KB, so 120 lands around 175 KB — comfortably over the 120 KB budget
 *  with room for the constant to be nudged without silently disarming every
 *  test below. */
const LARGE_VAULT_NOTES = 120;

/** Fill the vault past the per-query budget so mapped mode actually engages. */
function makeLargeVault(noteCount: number): void {
  const padding = "Details of the holding, at length. ".repeat(40);
  for (let i = 0; i < noteCount; i++) {
    write(
      `Records/Record ${String(i).padStart(3, "0")}.md`,
      `---\ntype: record\n---\n\nHolding number ${i} in the ledger. ${padding}`
    );
  }
  write(
    "Secrets/The Drowned Ledger.md",
    "---\ntype: secret\naliases: [The Drowned Ledger]\n---\n\n" +
      "The Drowned Ledger names who opened the Ashen Gate: Corwin Vane."
  );
}

describe("buildFullVaultKnowledge", () => {
  beforeEach(() => {
    write("A.md", "---\ntype: npc\n---\n\nAlric rode from Dunmar.");
    write("Sub/B.md", "---\ntype: location\n---\n\nDunmar is drowned.");
    write("Templates/T.md", "---\ntype: npc\n---\n\n{{title}}");
  });

  it("emits a [SOURCE DOCUMENT: path] block per note, so citations resolve", () => {
    // The citation contract is shared with the folder source: the model cites
    // the exact string in the header. A different format here would produce
    // citations the user cannot trace to a file.
    const b = buildFullVaultKnowledge(vault);
    expect(b.stable).toContain("[SOURCE DOCUMENT: A.md]");
    expect(b.stable).toContain("[SOURCE DOCUMENT: Sub/B.md]");
  });

  it("excludes scaffolding folders", () => {
    expect(buildFullVaultKnowledge(vault).stable).not.toContain("Templates/T.md");
  });

  it("puts everything in the stable half, nothing per-query", () => {
    // Full mode has no per-question component; the whole KB is cacheable.
    const b = buildFullVaultKnowledge(vault);
    expect(b.perQuery).toBe("");
    expect(b.meta.mode).toBe("full");
  });

  it("reports an empty vault as zero notes rather than throwing", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-empty-"));
    try {
      const b = buildFullVaultKnowledge(empty);
      expect(b.meta.notesIncluded).toBe(0);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("buildMappedVaultKnowledge — falling back", () => {
  it("includes the whole vault when it fits, rather than mapping it", async () => {
    // Mapped mode costs a map header AND a selection. Below the budget that
    // is a bigger prompt carrying less content than plain concatenation.
    write("A.md", "---\ntype: npc\n---\n\nAlric rode from Dunmar.");
    const b = await buildMappedVaultKnowledge(vault, "who is Alric?");
    expect(b.meta.mode).toBe("full");
    expect(b.meta.fellBackBecause).toMatch(/fits in the prompt/);
    expect(b.stable).toContain("Alric rode from Dunmar");
  });

  it("falls back to full — and says why — when no map has been built", async () => {
    makeLargeVault(LARGE_VAULT_NOTES);
    const b = await buildMappedVaultKnowledge(vault, "who opened the Ashen Gate?");
    expect(b.meta.mode).toBe("full");
    expect(b.meta.fellBackBecause).toMatch(/no vault map/);
    // The fallback must still carry lore. Returning an empty knowledge base
    // looks to the user exactly like a model that forgot their campaign.
    expect(b.stable).toContain("[SOURCE DOCUMENT:");
  });
});

describe("buildMappedVaultKnowledge — mapped mode", () => {
  beforeEach(async () => {
    makeLargeVault(LARGE_VAULT_NOTES);
    await buildVaultMap(vault, { mechanicalOnly: true });
  });

  it("engages once the vault exceeds the budget", async () => {
    const total = listVaultNotes(vault).reduce((n, f) => n + f.size, 0);
    expect(total).toBeGreaterThan(MAPPED_BODY_BUDGET);
    const b = await buildMappedVaultKnowledge(vault, "who opened the Ashen Gate?");
    expect(b.meta.mode).toBe("mapped");
  });

  it("puts the map in the stable half and the selected notes outside it", async () => {
    // This split is what keeps prompt caching worth anything: the map is
    // identical between questions, the selection is not. Folding the
    // selection into the cached block re-bills the whole vault every call.
    const b = await buildMappedVaultKnowledge(vault, "who opened the Ashen Gate?");
    expect(b.stable).toContain("### VAULT MAP");
    expect(b.stable).not.toContain("[SOURCE DOCUMENT:");
    expect(b.perQuery).toContain("[SOURCE DOCUMENT:");
  });

  it("lists EVERY note in the map, not just the selected ones", async () => {
    // The model has to know what exists in order to say "I'd need note X".
    const b = await buildMappedVaultKnowledge(vault, "who opened the Ashen Gate?");
    const map = readVaultMap(vault)!;
    expect(b.meta.notesTotal).toBe(map.notes.length);
    for (const note of map.notes) expect(b.stable).toContain(note.relPath);
  });

  it("includes far fewer notes in full than the vault holds", async () => {
    const b = await buildMappedVaultKnowledge(vault, "who opened the Ashen Gate?");
    expect(b.meta.notesIncluded).toBeGreaterThan(0);
    expect(b.meta.notesIncluded).toBeLessThan(b.meta.notesTotal);
  });

  it("finds the one note that answers the question", async () => {
    // The point of the whole feature: a needle in a vault where the padding
    // outnumbers the answer a hundred to one.
    const b = await buildMappedVaultKnowledge(vault, "Who opened the Ashen Gate, and what names them?");
    expect(b.perQuery).toContain("Corwin Vane");
  });

  it("stays inside the per-query byte budget", async () => {
    const b = await buildMappedVaultKnowledge(vault, "ledger holding record");
    expect(b.perQuery.length).toBeLessThanOrEqual(MAPPED_BODY_BUDGET + 500);
  });
});

describe("the vault map itself", () => {
  beforeEach(() => {
    write("A.md", "---\ntype: npc\naliases: [Grey]\n---\n\nAlric rode from Dunmar.");
    write("B.md", "---\ntype: location\n---\n\nDunmar is drowned.");
  });

  it("builds a digest per note and records how each was produced", async () => {
    const r = await buildVaultMap(vault, { mechanicalOnly: true });
    expect(r.notesTotal).toBe(2);
    expect(r.mechanicalOnly).toBe(true);
    expect(r.map.notes.every(n => n.summarySource === "mechanical")).toBe(true);
    expect(r.map.model).toBeNull();
  });

  it("reuses cached digests when nothing changed", async () => {
    await buildVaultMap(vault, { mechanicalOnly: true });
    const second = await buildVaultMap(vault, { mechanicalOnly: true });
    // The incremental key is the note's content hash. A rebuild that
    // re-summarises unchanged notes is the whole cost this avoids.
    expect(second.notesSummarised).toBe(0);
  });

  it("re-summarises only the note whose bytes changed", async () => {
    await buildVaultMap(vault, { mechanicalOnly: true });
    write("A.md", "---\ntype: npc\naliases: [Grey]\n---\n\nAlric rode from Kelmoor instead.");
    const second = await buildVaultMap(vault, { mechanicalOnly: true });
    expect(second.notesSummarised).toBe(1);
    expect(second.map.notes.find(n => n.relPath === "A.md")!.summary).toContain("Kelmoor");
  });

  it("re-summarises everything under force", async () => {
    await buildVaultMap(vault, { mechanicalOnly: true });
    expect((await buildVaultMap(vault, { mechanicalOnly: true, force: true })).notesSummarised).toBe(2);
  });

  it("drops a note that was deleted from the vault", async () => {
    await buildVaultMap(vault, { mechanicalOnly: true });
    fs.unlinkSync(path.join(vault, "B.md"));
    const second = await buildVaultMap(vault, { mechanicalOnly: true });
    expect(second.map.notes.map(n => n.relPath)).toEqual(["A.md"]);
  });

  it("persists outside the vault — the vault is never written to", async () => {
    const before = fs.readdirSync(vault).sort();
    await buildVaultMap(vault, { mechanicalOnly: true });
    expect(fs.readdirSync(vault).sort()).toEqual(before);
    // ...and the map is in the config dir instead.
    expect(fs.readdirSync(configDir).some(f => f.startsWith("vault-map."))).toBe(true);
  });

  it("keys the map by vault path, so two vaults don't clobber each other", async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-other-vault-"));
    try {
      fs.writeFileSync(path.join(other, "Z.md"), "---\ntype: npc\n---\n\nSomeone else.", "utf-8");
      await buildVaultMap(vault, { mechanicalOnly: true });
      await buildVaultMap(other, { mechanicalOnly: true });
      expect(readVaultMap(vault)!.notes.map(n => n.relPath)).toEqual(["A.md", "B.md"]);
      expect(readVaultMap(other)!.notes.map(n => n.relPath)).toEqual(["Z.md"]);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it("deleteVaultMap removes it and readVaultMap then returns null", async () => {
    await buildVaultMap(vault, { mechanicalOnly: true });
    deleteVaultMap(vault);
    expect(readVaultMap(vault)).toBeNull();
  });

  it("renders one line per note, carrying path, type, summary and aliases", async () => {
    const r = await buildVaultMap(vault, { mechanicalOnly: true });
    const rendered = renderMapForPrompt(r.map);
    expect(rendered.split("\n")).toHaveLength(2);
    expect(rendered).toContain("A.md");
    expect(rendered).toContain("[npc]");
    expect(rendered).toContain("aka Grey");
  });
});

describe("selection floor", () => {
  it("is relative and permissive enough for a two-note answer", () => {
    // Recorded as a constant so a future tightening is a deliberate edit
    // rather than a silent regression in recall. See the constant's comment
    // for the measurement behind the value.
    expect(RELATIVE_FLOOR).toBeGreaterThan(0);
    expect(RELATIVE_FLOOR).toBeLessThanOrEqual(0.5);
  });
});

describe("listVaultNotes", () => {
  it("returns dashboard rows shaped like the folder source's", async () => {
    write("A.md", "---\ntype: npc\n---\n\nbody");
    const rows = listVaultNotes(vault);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("A.md");
    expect(rows[0].size).toBeGreaterThan(0);
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });
});

describe("temporalNote — never promise a session the prompt does not carry", () => {
  const session = (n: number, path: string) => ({
    unitIds: [path],
    file: path,
    title: `Session ${n}`,
    number: n,
    campaign: "",
    campaignLabel: "",
  });

  const query = (sessions: ReturnType<typeof session>[], intent: "latest" | "recent") => ({
    resolved: { intent, sessions, ambiguousAcross: undefined } as never,
  });

  it("says nothing when the question was not temporal", () => {
    expect(temporalNote(null, ["a.md"])).toBe("");
  });

  it("names the session that was included", () => {
    const t = query([session(29, "Sessions/29.md")], "latest");
    expect(temporalNote(t, ["Sessions/29.md"])).toMatch(/session 29/);
  });

  it("describes only the sessions that survived the budget", () => {
    // A transcript runs to tens of thousands of characters, so "the last
    // three" routinely ships one. A header claiming three invites the model
    // to recap two it cannot see.
    const t = query(
      [session(29, "Sessions/29.md"), session(28, "Sessions/28.md"), session(27, "Sessions/27.md")],
      "recent"
    );
    const note = temporalNote(t, ["Sessions/29.md"]);
    expect(note).toMatch(/session 29/);
    expect(note).not.toMatch(/session 28/);
    expect(note).toMatch(/2 further session\(s\) matched but were too long/);
  });

  it("omits the shortfall line when everything fitted", () => {
    const t = query([session(29, "Sessions/29.md"), session(28, "Sessions/28.md")], "recent");
    const note = temporalNote(t, ["Sessions/29.md", "Sessions/28.md"]);
    expect(note).not.toMatch(/too long to include/);
  });

  it("says nothing at all when no resolved session made it in", () => {
    // Better silent than a header describing a session the body lacks.
    const t = query([session(29, "Sessions/29.md")], "latest");
    expect(temporalNote(t, ["People/Someone.md"])).toBe("");
  });
});
