// Minimal safe localStorage wrappers. JSON round-trip with every failure
// mode swallowed: quota exceeded, privacy modes with storage disabled, and
// corrupt stored values all fall back to the provided default rather than
// throwing mid-render.

export function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function safeSet<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded / storage disabled — the UI state simply doesn't
    // persist this once; nothing user-facing breaks.
  }
}
