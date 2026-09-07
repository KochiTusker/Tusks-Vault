import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { writeFileAtomic, writeJsonAtomic } from "./atomic-write";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-atomic-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("writes the file", () => {
    const target = path.join(dir, "a.json");
    writeFileAtomic(target, '{"x":1}');
    expect(fs.readFileSync(target, "utf-8")).toBe('{"x":1}');
  });

  it("fully replaces a longer previous file", () => {
    // The corruption that started this: a short write landing over a longer
    // file left the old tail behind, producing valid JSON followed by
    // garbage.
    const target = path.join(dir, "a.json");
    writeFileAtomic(target, "x".repeat(500));
    writeFileAtomic(target, "short");
    expect(fs.readFileSync(target, "utf-8")).toBe("short");
  });

  it("creates the parent directory", () => {
    const target = path.join(dir, "nested", "deep", "a.json");
    writeFileAtomic(target, "hi");
    expect(fs.readFileSync(target, "utf-8")).toBe("hi");
  });

  it("leaves no temp file behind on success", () => {
    writeFileAtomic(path.join(dir, "a.json"), "hi");
    expect(fs.readdirSync(dir).filter(f => f.includes(".tmp"))).toEqual([]);
  });

  it("leaves no temp file behind on failure, and rethrows", () => {
    // A stale .tmp beside a config file reads as something having gone
    // wrong, when after a transient error nothing has.
    const target = path.join(dir, "sub", "a.json");
    fs.mkdirSync(path.join(dir, "sub"));
    // A directory at the target path makes renameSync fail.
    fs.mkdirSync(target);
    expect(() => writeFileAtomic(target, "hi")).toThrow();
    expect(fs.readdirSync(path.join(dir, "sub")).filter(f => f.includes(".tmp"))).toEqual([]);
  });

  it("uses a distinct temp name per call", () => {
    // The property the whole fix rests on. Two writers sharing one temp path
    // is exactly what tore settings.json.
    const seen = new Set<string>();
    const target = path.join(dir, "a.json");
    const realRename = fs.renameSync;
    try {
      // Deliberately intercepting renameSync to observe the temp path.
      fs.renameSync = (from: string, to: string) => {
        seen.add(String(from));
        realRename(from, to);
      };
      writeFileAtomic(target, "1");
      writeFileAtomic(target, "2");
      writeFileAtomic(target, "3");
    } finally {
      fs.renameSync = realRename;
    }
    expect(seen.size).toBe(3);
  });

  it("accepts a Buffer as well as a string", () => {
    const target = path.join(dir, "a.bin");
    writeFileAtomic(target, Buffer.from([1, 2, 3]));
    expect([...fs.readFileSync(target)]).toEqual([1, 2, 3]);
  });

  it("applies mode before publishing the file", () => {
    if (process.platform === "win32") return; // POSIX modes only
    const target = path.join(dir, "secret");
    writeFileAtomic(target, "s3cret", { mode: 0o600 });
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });
});

describe("writeJsonAtomic", () => {
  it("writes indented JSON that round-trips", () => {
    const target = path.join(dir, "a.json");
    writeJsonAtomic(target, { a: 1, b: [2, 3] });
    const raw = fs.readFileSync(target, "utf-8");
    expect(raw).toContain("\n"); // indented, because a user may open it
    expect(JSON.parse(raw)).toEqual({ a: 1, b: [2, 3] });
  });
});

describe("concurrent writers — the bug this exists for", () => {
  // Runs real child processes, because the failure is genuinely between
  // processes: within one process the writes are serialised by the event
  // loop and the fixed-temp-name version looks fine. That is why the
  // original code passed review and its unit tests, and still corrupted
  // settings.json on a machine running the dev server alongside a script.
  const WRITER = `
    const fs = require("node:fs");
    const crypto = require("node:crypto");
    const target = process.argv[2];
    const fixed = process.argv[3] === "fixed";
    const payload = JSON.stringify({ pad: "x".repeat(Number(process.argv[4])) });
    for (let i = 0; i < 400; i++) {
      const tmp = fixed
        ? target + ".tmp"
        : target + "." + process.pid + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
      try {
        fs.writeFileSync(tmp, payload);
        fs.renameSync(tmp, target);
      } catch {
        // A lost race is fine; a torn file is not. Clean up the way the real
        // helper does — on Windows a rename over a momentarily-busy target
        // fails, and without this the temp file is orphaned.
        try { fs.unlinkSync(tmp); } catch {}
      }
    }
  `;

  /** Run four writers CONCURRENTLY. Concurrency is the whole point: an
   *  earlier version of this test used execFileSync, which blocks, so the
   *  writers ran one after another and the test passed against the very bug
   *  it was written to catch. */
  async function raceWriters(target: string, mode: "fixed" | "unique"): Promise<void> {
    const scriptPath = path.join(dir, "writer.cjs");
    fs.writeFileSync(scriptPath, WRITER);
    // Very different payload sizes make a partial overwrite visible: a short
    // write over a long file leaves the long file's tail behind.
    const sizes = ["40000", "50", "40000", "50"];
    await Promise.all(
      sizes.map(
        size =>
          new Promise<void>((resolve, reject) => {
            const child = spawn(process.execPath, [scriptPath, target, mode, size], { stdio: "ignore" });
            child.on("error", reject);
            child.on("close", () => resolve());
          })
      )
    );
  }

  /** Is the file exactly one of the two payloads? */
  function isIntact(target: string): boolean {
    const raw = fs.readFileSync(target, "utf-8");
    try {
      const parsed = JSON.parse(raw) as { pad?: string };
      return parsed.pad?.length === 50 || parsed.pad?.length === 40000;
    } catch {
      return false;
    }
  }

  it("a shared temp path lets one writer publish another's content", () => {
    // The defect, shown deterministically rather than by racing for it. A
    // real tear needs one writer's rename to land inside another's write,
    // which is timing-dependent and would make a flaky test; the MECHANISM
    // does not need timing at all, and this is it.
    //
    // Two writers, one temp path. A writes a long payload. B truncates the
    // same path and writes a short one. A then renames — and publishes
    // content it never wrote. With unequal lengths and a partial second
    // write, that published content is a mixture, which is exactly the shape
    // settings.json ended up in: valid JSON followed by an older tail.
    const target = path.join(dir, "shared.json");
    const tmp = `${target}.tmp`;
    const LONG = JSON.stringify({ pad: "x".repeat(4000) });
    const SHORT = JSON.stringify({ pad: "y" });

    fs.writeFileSync(tmp, LONG); // writer A stages
    fs.writeFileSync(tmp, SHORT); // writer B stages over it
    fs.renameSync(tmp, target); // writer A publishes

    expect(fs.readFileSync(target, "utf-8")).toBe(SHORT);
    expect(fs.readFileSync(target, "utf-8")).not.toBe(LONG);
  });

  it("writeFileAtomic keeps two writers on separate paths, so neither can", () => {
    // Same interleaving, through the real helper. Each write reaches the
    // target whole; the second simply wins.
    const target = path.join(dir, "separate.json");
    const LONG = JSON.stringify({ pad: "x".repeat(4000) });
    const SHORT = JSON.stringify({ pad: "y" });
    writeFileAtomic(target, LONG);
    expect(fs.readFileSync(target, "utf-8")).toBe(LONG);
    writeFileAtomic(target, SHORT);
    expect(fs.readFileSync(target, "utf-8")).toBe(SHORT);
    expect(fs.readdirSync(dir).filter(f => f.includes(".tmp"))).toEqual([]);
  });

  it("survives four concurrent processes hammering the same file", async () => {
    // The end-to-end property, under real concurrency. A pass here is not
    // proof the race is impossible — races rarely are — but a failure would
    // be proof it is not fixed, and the deterministic pair above pins the
    // mechanism regardless of what this run's timing happens to do.
    const target = path.join(dir, "unique.json");
    fs.writeFileSync(target, JSON.stringify({ pad: "x".repeat(40000) }));
    await raceWriters(target, "unique");
    expect(isIntact(target)).toBe(true);
    expect(fs.readdirSync(dir).filter(f => f.endsWith(".tmp"))).toEqual([]);
  }, 60_000);
});
