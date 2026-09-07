import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listDirectory, listRoots } from "./browse";

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-browse-"));
  fs.mkdirSync(path.join(root, "Campaign Notes"));
  fs.mkdirSync(path.join(root, "archive"));
  // A vault is a folder with .obsidian/ in it — the badge the picker shows.
  fs.mkdirSync(path.join(root, "MyVault", ".obsidian"), { recursive: true });
  // Tooling directories and loose files must not appear in a folder picker.
  fs.mkdirSync(path.join(root, ".git"));
  fs.writeFileSync(path.join(root, "notes.md"), "# not a folder");
  fs.writeFileSync(path.join(root, "secrets.env"), "TOKEN=shouldneverbelisted");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("listDirectory", () => {
  it("returns only directories — never file names", () => {
    const out = listDirectory(root);
    expect(out.ok).toBe(true);
    const names = out.entries.map(e => e.name);
    expect(names).toContain("Campaign Notes");
    expect(names).toContain("MyVault");
    // The whole point of listing directories only: a folder picker has no use
    // for file names, and not returning them means this cannot be used to
    // inventory someone's documents.
    expect(names).not.toContain("notes.md");
    expect(names).not.toContain("secrets.env");
  });

  it("hides dot-directories, which are tooling rather than vaults", () => {
    expect(listDirectory(root).entries.map(e => e.name)).not.toContain(".git");
  });

  it("sorts case-insensitively so the list reads alphabetically", () => {
    const names = listDirectory(root).entries.map(e => e.name);
    expect(names).toEqual(["archive", "Campaign Notes", "MyVault"]);
  });

  it("flags the folder that holds a .obsidian directory", () => {
    const entries = listDirectory(root).entries;
    expect(entries.find(e => e.name === "MyVault")?.isObsidianVault).toBe(true);
    expect(entries.find(e => e.name === "archive")?.isObsidianVault).toBe(false);
  });

  it("reports the vault flag for the directory being listed, for 'use this folder'", () => {
    expect(listDirectory(path.join(root, "MyVault")).isObsidianVault).toBe(true);
    expect(listDirectory(root).isObsidianVault).toBe(false);
  });

  it("gives absolute entry paths, so the client never joins paths itself", () => {
    for (const entry of listDirectory(root).entries) {
      expect(path.isAbsolute(entry.path)).toBe(true);
      expect(entry.path).toBe(path.join(root, entry.name));
    }
  });

  it("normalises the requested path so it round-trips as one spelling", () => {
    const messy = path.join(root, "archive", "..", "archive");
    expect(listDirectory(messy).path).toBe(path.join(root, "archive"));
  });

  it("exposes a parent to navigate up, and null at a filesystem root", () => {
    expect(listDirectory(root).parent).toBe(path.dirname(root));
    const anchor = path.parse(root).root;
    expect(listDirectory(anchor).parent).toBeNull();
  });

  it("treats an empty path as the roots listing rather than an error", () => {
    const out = listDirectory("");
    expect(out.ok).toBe(true);
    expect(out.path).toBeNull();
    expect(out.parent).toBeNull();
    expect(out.entries.length).toBeGreaterThan(0);
  });

  it("refuses a relative path instead of resolving it against the server's cwd", () => {
    const out = listDirectory("some/relative/dir");
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/full path/i);
  });

  it("reports a missing path and a file-not-folder path distinctly", () => {
    const missing = listDirectory(path.join(root, "does-not-exist"));
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/nothing exists/i);

    const file = listDirectory(path.join(root, "notes.md"));
    expect(file.ok).toBe(false);
    expect(file.error).toMatch(/file, not a folder/i);
  });
});

describe("listRoots", () => {
  it("offers somewhere to start, including home", () => {
    const roots = listRoots();
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.some(r => r.path === os.homedir())).toBe(true);
    for (const r of roots) expect(path.isAbsolute(r.path)).toBe(true);
  });
});
