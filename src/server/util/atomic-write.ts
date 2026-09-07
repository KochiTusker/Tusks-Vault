// Write a file atomically — correctly, including when two processes do it at
// once.
//
// The pattern everywhere in this codebase was: write `<path>.tmp`, then rename
// it over the target. That is genuinely atomic against a CRASH — a reader
// never sees a half-written file, because rename is atomic — and it is what
// the comments in those modules claimed.
//
// It is not atomic against a second WRITER, because the temp filename was
// fixed. Two processes writing the same target both open `<path>.tmp`; the
// second truncate lands inside the first's write, and the rename publishes
// whatever mixture resulted. Observed in practice: settings.json ended up as
// a complete JSON object followed by the tail of a longer previous version,
// which then failed to parse on every read.
//
// Two processes is not exotic here. The dev server and a script both call
// getSettings(), which persists on read; the updater runs alongside the
// server; two dashboard tabs can save at once. And the same helper guards
// keys.enc, where a corrupted file means every stored API key is gone.
//
// The fix is one line of the pattern: give the temp file a unique name. The
// randomness only has to prevent a collision between concurrent writers, not
// resist an attacker — the file lives in a directory we already own, and is
// renamed away immediately.

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export interface AtomicWriteOptions {
  /** POSIX permissions, applied to the temp file BEFORE the rename so the
   *  live file is never briefly readable by anyone else. Ignored on Windows,
   *  where ACLs come from directory inheritance. */
  mode?: number;
}

/**
 * Replace `target` with `data`, atomically.
 *
 * Creates the parent directory if absent. On failure the temp file is removed
 * rather than left behind — a stale `.tmp` beside a config file reads as
 * something having gone wrong, and after a transient error nothing has.
 */
export function writeFileAtomic(
  target: string,
  data: string | Buffer,
  opts: AtomicWriteOptions = {}
): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    if (opts.mode !== undefined && process.platform !== "win32") {
      try {
        fs.chmodSync(tmp, opts.mode);
      } catch {
        /* best-effort: a filesystem without POSIX modes must not fail the write */
      }
    }
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* never mask the real error with a cleanup failure */
    }
    throw err;
  }
}

/** JSON convenience. `null, 2` because every file written through this is one
 *  a user may reasonably open in an editor. */
export function writeJsonAtomic(target: string, value: unknown): void {
  writeFileAtomic(target, JSON.stringify(value, null, 2));
}
