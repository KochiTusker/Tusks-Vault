// Allowed shape for any user-supplied identifier that flows into a filesystem
// path or persisted record key. Permits alphanumerics, hyphens, underscores.
// No dots (would defeat extension-based filename derivation), no slashes
// (would escape the data dir), no traversal sequences. Length-capped to 100
// so a pathological body can't cause a giant filename.
//
// Used by:
//   - routes/personas.ts for :id / :presetId / body.id validation
//   - personas/store.ts before deriving any on-disk key (defense in depth — a
//     future route that forgets the input check still cannot escape the data dir)
const SAFE_SLUG_RE = /^[a-z0-9_-]+$/i;
const MAX_SLUG_LENGTH = 100;

export function isSafeSlug(s: unknown): s is string {
  return typeof s === "string"
    && s.length > 0
    && s.length <= MAX_SLUG_LENGTH
    && SAFE_SLUG_RE.test(s);
}

export function assertSafeSlug(s: unknown, label: string): asserts s is string {
  if (!isSafeSlug(s)) {
    throw new Error(`Invalid ${label}: must match /^[a-z0-9_-]+$/i (length 1–${MAX_SLUG_LENGTH}).`);
  }
}
