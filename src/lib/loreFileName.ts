// Display name for a lore document.
//
// Uploads land on disk as `<epoch-ms>-<original name>` so two files with the
// same name don't collide. That prefix is an implementation detail and should
// not be shown.
//
// The obvious way to undo it — split on "-" and drop the first piece — is
// wrong, and was wrong in a way that only showed up once real filenames
// arrived: `Session-01-2024-03-12.docx` displayed as `01-2024-03-12.docx`,
// and an Obsidian note called `Session 12 - The Ninefold Rest.md` lost
// everything before the dash. Hyphens are ordinary characters in filenames.
//
// So: strip the prefix only when it actually looks like one, and only from
// the basename — a nested path's folders are meaningful and stay.

/** Epoch-millisecond prefix: 13 digits today, allowed 10–17 so the check
 *  neither expires nor starts matching things like `2024-report.md`. */
const UPLOAD_PREFIX_RE = /^\d{10,17}-(?=.)/;

export function displayFileName(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : relPath.slice(0, slash + 1);
  const base = slash === -1 ? relPath : relPath.slice(slash + 1);
  return dir + base.replace(UPLOAD_PREFIX_RE, "");
}
