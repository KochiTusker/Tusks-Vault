// EXDEV cannot be provoked honestly in a unit test — it needs two real
// filesystems, and a test that only runs on a machine with a second drive is a
// test that does not run. So the cross-volume case is driven by making
// renameSync fail the way the kernel would, and the assertions are about what
// ends up on disk afterwards, which is the part that matters.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { movePath } from "./move-path";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "move-path-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Simulate a cross-volume move.
 *
 * Only the source->destination rename fails. The staging->destination rename
 * inside the fallback must still succeed, because staging is a sibling of the
 * destination and therefore on the same filesystem — that is precisely why the
 * fallback stages there. A mock that failed every rename would model a machine
 * that cannot exist, and would hide whether the atomic publish step works.
 */
function failRenameWithExdev() {
  const real = fs.renameSync;
  return vi.spyOn(fs, "renameSync").mockImplementation((src, dest) => {
    if (String(src).includes(".incoming-")) return real(src, dest);
    const err = new Error("EXDEV: cross-device link not permitted") as NodeJS.ErrnoException;
    err.code = "EXDEV";
    throw err;
  });
}

describe("movePath", () => {
  it("moves a file with a plain rename when it can", () => {
    const from = path.join(dir, "notes.md");
    const to = path.join(dir, "moved.md");
    fs.writeFileSync(from, "the harbour master");

    movePath(from, to);

    expect(fs.readFileSync(to, "utf-8")).toBe("the harbour master");
    expect(fs.existsSync(from)).toBe(false);
  });

  it("moves a file across volumes when rename cannot", () => {
    // The regression. Before the fallback this threw, the lore migration
    // caught it, and the user's documents stayed where the app no longer read.
    const from = path.join(dir, "notes.md");
    const to = path.join(dir, "moved.md");
    fs.writeFileSync(from, "the harbour master");
    failRenameWithExdev();

    movePath(from, to);

    expect(fs.readFileSync(to, "utf-8")).toBe("the harbour master");
    expect(fs.existsSync(from)).toBe(false);
  });

  it("moves a whole directory tree across volumes", () => {
    // A campaign folder, not a single file, is the normal shape of the thing
    // being migrated.
    const from = path.join(dir, "campaign");
    const to = path.join(dir, "moved");
    fs.mkdirSync(path.join(from, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(from, "npcs.md"), "an npc entry");
    fs.writeFileSync(path.join(from, "sessions", "01.md"), "the ledger");
    failRenameWithExdev();

    movePath(from, to);

    expect(fs.readFileSync(path.join(to, "npcs.md"), "utf-8")).toBe("an npc entry");
    expect(fs.readFileSync(path.join(to, "sessions", "01.md"), "utf-8")).toBe("the ledger");
    expect(fs.existsSync(from)).toBe(false);
  });

  it("leaves the source intact when the copy fails", () => {
    // The ordering guarantee. This moves documents that may exist nowhere
    // else, so a failed move must be recoverable by the user doing nothing.
    const from = path.join(dir, "notes.md");
    fs.writeFileSync(from, "irreplaceable");
    failRenameWithExdev();
    vi.spyOn(fs, "cpSync").mockImplementation(() => {
      throw new Error("disk full");
    });

    expect(() => movePath(from, path.join(dir, "moved.md"))).toThrow(/disk full/);
    expect(fs.readFileSync(from, "utf-8")).toBe("irreplaceable");
  });

  it("refuses to overwrite an existing destination on the RENAME path", () => {
    // The branch that needed the guard. fs.renameSync silently replaces an
    // existing file, so without the explicit check this call would destroy
    // the destination — and the earlier version of this test hid that by
    // stubbing renameSync, exercising only the branch that already refused.
    const from = path.join(dir, "notes.md");
    const to = path.join(dir, "existing.md");
    fs.writeFileSync(from, "new");
    fs.writeFileSync(to, "already here");

    expect(() => movePath(from, to)).toThrow(/already exists/);
    expect(fs.readFileSync(to, "utf-8")).toBe("already here");
    expect(fs.readFileSync(from, "utf-8")).toBe("new");
  });

  it("refuses to overwrite an existing destination on the COPY path", () => {
    const from = path.join(dir, "notes.md");
    const to = path.join(dir, "existing.md");
    fs.writeFileSync(from, "new");
    fs.writeFileSync(to, "already here");
    failRenameWithExdev();

    expect(() => movePath(from, to)).toThrow(/already exists/);
    expect(fs.readFileSync(to, "utf-8")).toBe("already here");
  });

  it("leaves NO partial destination when a directory copy fails midway", () => {
    // The trap this ordering exists to close. The lore migration skips any
    // entry whose destination already exists, so a half-copied directory left
    // under the final name would be read as a finished migration on every
    // later boot — a truncated corpus, with the complete original sitting
    // unread and nothing reporting it.
    const from = path.join(dir, "campaign");
    const to = path.join(dir, "moved");
    fs.mkdirSync(from, { recursive: true });
    fs.writeFileSync(path.join(from, "notes.md"), "irreplaceable");
    failRenameWithExdev();
    vi.spyOn(fs, "cpSync").mockImplementation((_src, dest) => {
      // Create the staging directory, then die — exactly what an ENOSPC or a
      // locked file partway through a real tree copy leaves behind.
      fs.mkdirSync(String(dest), { recursive: true });
      fs.writeFileSync(path.join(String(dest), "partial.md"), "half a file");
      throw new Error("ENOSPC: no space left on device");
    });

    expect(() => movePath(from, to)).toThrow(/ENOSPC/);
    expect(fs.existsSync(to), "a partial destination must not be published").toBe(false);
    expect(fs.readFileSync(path.join(from, "notes.md"), "utf-8")).toBe("irreplaceable");
    // And no staging litter left beside it.
    expect(fs.readdirSync(dir).filter(n => n.includes("incoming"))).toEqual([]);
  });

  it("does not retry a failure a copy would hit too", () => {
    // ENOENT, EACCES, a locked file: copying would fail the same way, and a
    // second strategy only buries the real cause.
    const cp = vi.spyOn(fs, "cpSync");
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    });

    expect(() => movePath(path.join(dir, "a"), path.join(dir, "b"))).toThrow(/EACCES/);
    expect(cp).not.toHaveBeenCalled();
  });

  it("still counts as moved when the original cannot be deleted", () => {
    // Antivirus or an open editor holding the source. The data is at the
    // destination, so the move happened; warn, do not throw.
    const from = path.join(dir, "notes.md");
    const to = path.join(dir, "moved.md");
    fs.writeFileSync(from, "the harbour master");
    failRenameWithExdev();
    vi.spyOn(fs, "rmSync").mockImplementation(() => {
      throw new Error("EBUSY: resource busy or locked");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => movePath(from, to)).not.toThrow();
    expect(fs.readFileSync(to, "utf-8")).toBe("the harbour master");
    expect(warn).toHaveBeenCalled();
  });
});
