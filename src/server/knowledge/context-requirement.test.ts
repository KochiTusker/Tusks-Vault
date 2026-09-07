import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSettings, saveSettings } from "../config/settings";
import { buildVaultMap } from "./obsidian/map";
import { MAPPED_BODY_BUDGET } from "./obsidian/source";
import {
  describeRequirement,
  describeSelectivity,
  measureContextRequirement,
  RESERVED_TOKENS,
} from "./context-requirement";

// Every test here writes a vault of 100-300 notes and builds a map over it, so
// none of them fit the 5s default. Some already carried an explicit 30_000 and
// some did not, which showed up as tests that passed when the file was run
// alone and timed out inside the full suite — a flake that looks like a real
// regression every time it lands. One file-level setting instead of a per-test
// argument each author has to remember.
vi.setConfig({ testTimeout: 30_000 });

// paths.ts resolves the lore location ONCE, into a module-level const, at
// import time — so `process.chdir()` in beforeEach cannot redirect it. The
// folder-source tests below therefore measured whatever real `../Tusks-Lore/`
// or `<repo>/Lore/` happened to sit beside the checkout, and passed only on a
// machine that had one. On a fresh clone and in CI they failed.
//
// Mocking the module, rather than setting TUSKS_VAULT_LORE_PATH, is deliberate:
// the env override makes KNOWLEDGE_DIR external, which is exactly the condition
// that triggers loader.ts's repo-local-Lore migration — and that migration
// MOVES real files. Pointing it at a temp dir on a developer's machine tries to
// relocate their actual campaign out of `<repo>/Lore/`. Here REPO_LORE_DIR is
// redirected to a path that does not exist, so the migration's existsSync gate
// skips it entirely and no real file is ever a candidate.
const LORE = vi.hoisted(() => {
  const tmp = process.env.TEMP ?? process.env.TMPDIR ?? "/tmp";
  return {
    knowledge: `${tmp}/tusks-ctx-knowledge`,
    // Intentionally never created.
    repoLore: `${tmp}/tusks-ctx-no-repo-lore`,
  };
});

vi.mock("../config/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/paths")>();
  return {
    ...actual,
    KNOWLEDGE_DIR: LORE.knowledge,
    LORE_ROOT_DIR: LORE.knowledge,
    KNOWLEDGE_DIR_IS_EXTERNAL: true,
    REPO_LORE_DIR: LORE.repoLore,
  };
});

// Both the settings file (cwd-based) and the map cache (config-dir-based) are
// resolved lazily, so each test gets its own of each.
let home: string;
let vault: string;
let configDir: string;
let originalCwd: string;
let originalConfigDir: string | undefined;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-ctx-"));
  vault = path.join(home, "vault");
  fs.mkdirSync(vault);
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-ctx-config-"));
  originalCwd = process.cwd();
  originalConfigDir = process.env.TUSKS_VAULT_CONFIG_DIR;
  process.env.TUSKS_VAULT_CONFIG_DIR = configDir;
  process.chdir(home);
  fs.rmSync(LORE.knowledge, { recursive: true, force: true });
  fs.mkdirSync(LORE.knowledge, { recursive: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalConfigDir === undefined) delete process.env.TUSKS_VAULT_CONFIG_DIR;
  else process.env.TUSKS_VAULT_CONFIG_DIR = originalConfigDir;
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(configDir, { recursive: true, force: true });
  fs.rmSync(LORE.knowledge, { recursive: true, force: true });
});

const note = (rel: string, body: string): void => {
  const abs = path.join(vault, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
};

/** Enough notes to put the vault past the per-query budget, so mapped mode is
 *  the regime under test rather than the small-vault shortcut. */
function fillVault(count: number): void {
  const padding = "A paragraph of campaign detail, written out at length. ".repeat(30);
  for (let i = 0; i < count; i++) {
    note(`Notes/Note ${String(i).padStart(3, "0")}.md`, `---\ntype: npc\n---\n\n# Note ${i}\n\n${padding}`);
  }
}

const useVault = (useVaultMap: boolean): void => {
  saveSettings({ ...getSettings(), loreSource: "obsidian", obsidianVaultPath: vault, useVaultMap });
};

describe("the folder source", () => {
  it("asks for a window big enough to hold the whole corpus", () => {
    // Every readable document is concatenated into every prompt, so the
    // requirement scales with the campaign and small models are out.
    fs.mkdirSync(LORE.knowledge, { recursive: true });
    fs.writeFileSync(path.join(LORE.knowledge, "World.md"), "x".repeat(400_000), "utf-8");
    saveSettings({ ...getSettings(), loreSource: "folder" });
    const req = measureContextRequirement();
    expect(req.regime).toBe("folder");
    expect(req.tokens).toBeGreaterThan(100_000);
  }, 30_000);

  it("still reserves room for the question and the answer when there is no lore", () => {
    saveSettings({ ...getSettings(), loreSource: "folder" });
    const req = measureContextRequirement();
    expect(req.tokens).toBeGreaterThanOrEqual(RESERVED_TOKENS);
  });
});

describe("a vault small enough to send whole", () => {
  it("asks only for what the vault costs", () => {
    note("One.md", "A short note.");
    useVault(true);
    const req = measureContextRequirement();
    expect(req.regime).toBe("vault-full");
    expect(req.tokens).toBeLessThan(20_000);
    expect(req.degraded).toBeUndefined();
  }, 30_000);

  it("does not pretend a map would help", () => {
    // Below the budget, mapped mode produces a LARGER prompt carrying less.
    // Flagging this setup as degraded would push the user the wrong way.
    note("One.md", "A short note.");
    useVault(false);
    expect(measureContextRequirement().degraded).toBeUndefined();
  });
});

describe("a large vault WITH a map", () => {
  it("asks for the digest plus the per-question budget, not the campaign", async () => {
    // The point of the whole retrieval tier: the requirement stops tracking
    // the size of the campaign, which is what makes a small model viable.
    fillVault(120);
    useVault(true);
    await buildVaultMap(vault, { mechanicalOnly: true });
    const req = measureContextRequirement();
    expect(req.regime).toBe("vault-mapped");
    expect(req.loreChars).toBeLessThanOrEqual(MAPPED_BODY_BUDGET * 2);
    expect(req.degraded).toBeUndefined();
  }, 30_000);

  it("costs less than sending the same vault whole", async () => {
    fillVault(120);
    useVault(true);
    const unmapped = measureContextRequirement();
    await buildVaultMap(vault, { mechanicalOnly: true });
    const mapped = measureContextRequirement();
    expect(mapped.tokens).toBeLessThan(unmapped.tokens);
  }, 30_000);

  it("grows with the number of notes, because the map is in every prompt", async () => {
    // Not a rounding detail: a badly-split vault of thousands of fragments
    // pays for all of them on every question, and a user choosing a model
    // needs that to show up rather than be smoothed away.
    fillVault(120);
    useVault(true);
    await buildVaultMap(vault, { mechanicalOnly: true });
    const small = measureContextRequirement();
    fillVault(300);
    await buildVaultMap(vault, { mechanicalOnly: true });
    expect(measureContextRequirement().tokens).toBeGreaterThan(small.tokens);
  });
});

describe("a large vault WITHOUT a usable map", () => {
  it("reports the real cost rather than the cost it wishes it had", () => {
    // The failure this module exists to catch. Retrieval silently falls back
    // to whole-vault concatenation, so a user who atomised their lore is
    // still paying folder-mode prices — and would be told a 32k model works.
    fillVault(120);
    useVault(true);
    const req = measureContextRequirement();
    expect(req.regime).toBe("vault-full");
    expect(req.degraded).toBeDefined();
  }, 30_000);

  it("says what the fix is worth", () => {
    fillVault(120);
    useVault(true);
    const req = measureContextRequirement();
    expect(req.couldBeTokens).toBeDefined();
    expect(req.couldBeTokens!).toBeLessThan(req.tokens);
    expect(req.degraded!.fix).toMatch(/vault map/i);
  }, 30_000);

  it("distinguishes a missing map from selective retrieval being switched off", () => {
    // Different fixes: one is a button, the other is a setting.
    fillVault(120);
    useVault(true);
    expect(measureContextRequirement().degraded!.reason).toMatch(/no vault map/i);
    useVault(false);
    expect(measureContextRequirement().degraded!.reason).toMatch(/switched off/i);
  });
});

describe("what the user is told", () => {
  it("explains the mapped case in terms of notes rather than bytes", async () => {
    fillVault(120);
    useVault(true);
    await buildVaultMap(vault, { mechanicalOnly: true });
    const line = describeRequirement(measureContextRequirement());
    expect(line).toMatch(/map of 120 notes/);
    expect(line).toMatch(/context/);
  }, 30_000);

  it("never reports a requirement to false precision", () => {
    // "34,812 tokens" claims accuracy an estimate from file sizes does not
    // have. Round numbers are honest about being round.
    fillVault(120);
    useVault(true);
    expect(measureContextRequirement().tokens % 1000).toBe(0);
  });
});

describe("selectivity — what the vault's organisation is buying", () => {
  it("reports 1 when every question reads the whole corpus", () => {
    // Nothing is being selected, so nothing is being saved. This must not
    // read as a small number that could be mistaken for a good one.
    fs.mkdirSync(LORE.knowledge, { recursive: true });
    fs.writeFileSync(path.join(LORE.knowledge, "World.md"), "x".repeat(50_000), "utf-8");
    saveSettings({ ...getSettings(), loreSource: "folder" });
    expect(measureContextRequirement().selectivity).toBe(1);
  }, 30_000);

  it("never counts truncation as selection", () => {
    // Past the concat cap the corpus is CUT, not filtered. Dividing corpus by
    // cap would report the worst possible setup — silently losing lore — as
    // the best organised one in the app.
    fs.mkdirSync(LORE.knowledge, { recursive: true });
    fs.writeFileSync(path.join(LORE.knowledge, "Huge.md"), "x".repeat(3_000_000), "utf-8");
    saveSettings({ ...getSettings(), loreSource: "folder" });
    const req = measureContextRequirement();
    expect(req.selectivity).toBe(1);
    expect(req.corpusChars).toBeGreaterThan(req.loreChars);
  }, 30_000);

  it("rises with a mapped vault, because that is the regime that selects", async () => {
    fillVault(200);
    useVault(true);
    await buildVaultMap(vault, { mechanicalOnly: true });
    const req = measureContextRequirement();
    expect(req.regime).toBe("vault-mapped");
    expect(req.selectivity).toBeGreaterThan(1.5);
    expect(req.corpusChars).toBeGreaterThan(req.loreChars);
  }, 30_000);

  it("says so in a sentence the user can act on", async () => {
    fillVault(200);
    useVault(true);
    await buildVaultMap(vault, { mechanicalOnly: true });
    expect(describeSelectivity(measureContextRequirement())).toMatch(/reads about 1\//);
  }, 30_000);

  it("tells an unorganised setup what it is missing instead", () => {
    saveSettings({ ...getSettings(), loreSource: "folder" });
    expect(describeSelectivity(measureContextRequirement())).toMatch(/whole lore folder/i);
  });
});

describe("coarse notes — the thing the ratio alone would hide", () => {
  it("counts notes too big to be a retrieval unit", () => {
    // Retrieval pulls whole notes. A vault of five enormous ones has a fine
    // selectivity ratio and terrible focus, and the ratio cannot see it.
    fillVault(200);
    note("Notes/Enormous.md", "y".repeat(60_000));
    useVault(true);
    expect(measureContextRequirement().coarseNotes).toBe(1);
  }, 30_000);

  it("mentions them alongside the ratio rather than letting it stand alone", async () => {
    fillVault(200);
    note("Notes/Enormous.md", "y".repeat(60_000));
    useVault(true);
    await buildVaultMap(vault, { mechanicalOnly: true });
    expect(describeSelectivity(measureContextRequirement())).toMatch(/unrelated text/);
  }, 30_000);

  it("stays quiet when every note is a sensible size", async () => {
    fillVault(200);
    useVault(true);
    await buildVaultMap(vault, { mechanicalOnly: true });
    const req = measureContextRequirement();
    expect(req.coarseNotes).toBe(0);
    expect(describeSelectivity(req)).not.toMatch(/unrelated text/);
  });
});

describe("session records are not badly-filed reference notes", () => {
  it("does not count a long session log as coarse", async () => {
    // A session log is one evening. The temporal tier pins it whole, and
    // "what happened last session" is answered by having all of it — so
    // flagging it would push the user to split the one thing that must not be.
    fillVault(200);
    note("Sessions/Session-01.md", "z".repeat(90_000));
    useVault(true);
    await buildVaultMap(vault, { mechanicalOnly: true });
    const req = measureContextRequirement();
    expect(req.coarseNotes).toBe(0);
    expect(describeSelectivity(req)).not.toMatch(/unrelated text/);
  }, 30_000);

  it("still counts an oversized reference note beside it", () => {
    fillVault(200);
    note("Sessions/Session-01.md", "z".repeat(90_000));
    note("People/Someone.md", "y".repeat(60_000));
    useVault(true);
    expect(measureContextRequirement().coarseNotes).toBe(1);
  });
});
