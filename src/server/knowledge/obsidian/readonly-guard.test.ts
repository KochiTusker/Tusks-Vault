import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The contract this file enforces: nothing under knowledge/obsidian/ ever
// writes into the vault.
//
// This matters more than a normal invariant because the vault is a folder the
// user also edits by hand, in another application, containing work that may
// exist nowhere else. A bug that appends to a note, or "normalises"
// frontmatter, or writes an index file beside the notes, damages something we
// did not create and cannot restore. Reading is the whole job.
//
// So rather than trusting a convention, this scans the module's own source for
// filesystem mutators. A future edit that reaches for fs.writeFile in here
// fails the suite instead of quietly touching someone's campaign.
//
// map.ts is exempt for exactly one function — it persists the derived map to
// the app's CONFIG dir, never the vault — and that exemption is narrowed by
// the second test below, which checks the paths it writes to are config-dir
// paths.

const MODULE_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

/** Every fs call that changes something on disk. */
const MUTATORS = [
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "rename",
  "renameSync",
  "unlink",
  "unlinkSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "mkdir",
  "mkdirSync",
  "copyFile",
  "copyFileSync",
  "truncate",
  "truncateSync",
  "createWriteStream",
  "chmod",
  "chmodSync",
  "utimes",
  "utimesSync",
];

function sourceFiles(): Array<{ name: string; text: string }> {
  return fs
    .readdirSync(MODULE_DIR)
    .filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map(name => ({ name, text: fs.readFileSync(path.join(MODULE_DIR, name), "utf-8") }));
}

describe("obsidian module — read-only guard", () => {
  it("finds the module's source files (guard is actually running)", () => {
    // Without this, a broken path would make every assertion below vacuously
    // pass and the guard would silently stop guarding.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.map(f => f.name)).toContain("walk.ts");
  });

  it("never calls a filesystem mutator outside map.ts's persistence", () => {
    const offences: string[] = [];
    for (const { name, text } of sourceFiles()) {
      // map.ts writes the derived map to the config dir; that exemption is
      // checked separately below.
      if (name === "map.ts") continue;
      for (const fn of MUTATORS) {
        const re = new RegExp(`\\bfs\\.(promises\\.)?${fn}\\s*\\(`);
        if (re.test(text)) offences.push(`${name} calls fs.${fn}()`);
      }
    }
    expect(offences).toEqual([]);
  });

  it("map.ts writes only to config-dir paths, never a vault path", () => {
    const text = fs.readFileSync(path.join(MODULE_DIR, "map.ts"), "utf-8");
    // Every write in map.ts must be reached through mapFileFor(), which is
    // built from configFile(). If a write ever takes a vaultPath directly,
    // this is the line that catches it.
    expect(text).toContain("configFile(`vault-map.");
    // Every write target must resolve through mapFileFor(), which is the only
    // place this module constructs a path. A vault path may appear on a write
    // line ONLY as mapFileFor's argument — that call turns it into a
    // config-dir filename keyed by the vault, which is the point. A raw
    // vaultPath reaching a write is the failure this catches.
    const writeLines = text
      .split(/\r?\n/)
      .filter(l => /\b(writeFileAtomic|fs\.(writeFileSync|renameSync|unlinkSync))\s*\(/.test(l));
    expect(writeLines.length).toBeGreaterThan(0);
    for (const line of writeLines) {
      if (/vaultPath/.test(line)) {
        expect(line, `raw vault path reaches a write: ${line.trim()}`).toMatch(/mapFileFor\(/);
      }
    }
    // And the write itself goes through the shared atomic helper, whose temp
    // file is unique per call — a fixed temp name is not safe against a
    // second process, and this module is written from both the dashboard's
    // build route and any script that rebuilds a map.
    expect(text).toMatch(/writeFileAtomic\(mapFileFor\(/);
  });

  it("never spawns a child process", () => {
    // Grounding is a read. A vault path reaching a shell is the graph of
    // failures that starts with a folder legitimately named `D&D Vault`.
    for (const { name, text } of sourceFiles()) {
      expect(text, `${name} imports child_process`).not.toMatch(/from ["']node:child_process["']/);
      expect(text, `${name} imports child_process`).not.toMatch(/from ["']child_process["']/);
    }
  });
});
