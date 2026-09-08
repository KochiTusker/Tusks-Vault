// Move a file or directory, including across volumes.
//
// `fs.renameSync` is the right primitive — it is atomic and it is cheap — but
// it only works within a single filesystem. Across one it fails with EXDEV,
// and on Windows "across one" means nothing more exotic than a different drive
// letter: an install on C: and a lore folder on D: is an ordinary setup, not an
// edge case. The same applies to a separate /home mount on Linux, or an
// external disk anywhere.
//
// This was found by the boot check, which sandboxes its state outside the repo
// — on a machine whose repo is not on the system drive, the first-boot lore
// migration hit EXDEV immediately. The migration caught the error and warned,
// so nothing crashed; the user's documents simply stayed in the old folder
// while the app read the new one, and their lore appeared to have vanished.

import fs from "node:fs";

/**
 * Move `from` to `to`, falling back to copy-then-delete across volumes.
 *
 * Refuses an existing destination. That refusal has to be explicit: the fast
 * path is `renameSync`, which SILENTLY REPLACES an existing file, so without
 * this guard the two branches would disagree about the single most dangerous
 * case — and the caller reading the doc comment would get whichever behaviour
 * the volume layout happened to select.
 *
 * The fallback is ordered so that no failure can lose or truncate data:
 *
 *   1. Copy into a staging name beside the destination. A crash here leaves an
 *      obviously-partial `*.incoming-*` directory and an intact source.
 *   2. Rename staging into place. Staging is a sibling, so this is within one
 *      volume and therefore atomic — the destination never exists in a
 *      half-populated state.
 *   3. Only then remove the source.
 *
 * Step 2 is not a nicety. The lore migration in knowledge/loader.ts skips any
 * entry whose destination already exists ("destination wins"), so a partially
 * copied directory left under the final name would be treated as a finished
 * migration on every subsequent boot: the app would read a truncated corpus
 * while the complete original sat unread in ./Lore, and nothing would say so.
 * Copying straight to `to` made that state reachable for the first time —
 * `renameSync` alone never could — and the window is seconds to minutes for a
 * campaign folder crossing drives, on exactly the machines this fallback
 * exists for.
 */
export function movePath(from: string, to: string): void {
  if (fs.existsSync(to)) {
    throw new Error(`movePath: destination already exists: ${to}`);
  }

  try {
    fs.renameSync(from, to);
    return;
  } catch (err) {
    // EXDEV is the only error worth a second strategy. EACCES, ENOENT and a
    // locked file are all real failures that a copy would hit too, and
    // retrying them differently only obscures the cause.
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
  }

  const staging = `${to}.incoming-${process.pid}`;
  try {
    // recursive: `from` may be a directory — a campaign folder of notes is the
    // normal case, not a single file.
    fs.cpSync(from, staging, { recursive: true, errorOnExist: true, force: false });
    fs.renameSync(staging, to);
  } catch (err) {
    // The guard above proved `to` did not exist, and staging is a name this
    // call invented, so both are ours to remove — this destroys nothing of the
    // user's, and leaving a partial copy behind is what the ordering above
    // exists to prevent.
    try {
      fs.rmSync(staging, { recursive: true, force: true });
    } catch {
      /* never mask the real error with a cleanup failure */
    }
    throw err;
  }

  try {
    fs.rmSync(from, { recursive: true, force: true });
  } catch (err) {
    // The copy succeeded, so the data is safe at the destination and the move
    // has effectively happened. A source we could not unlink — antivirus
    // holding a handle, a file open in the user's editor — is worth saying out
    // loud, because they will otherwise find two copies and not know which one
    // the application reads, but it is not a failure of the move.
    console.warn(
      `[move] copied ${from} -> ${to} but could not remove the original:`,
      err
    );
  }
}
