// Shared retry/backoff for every LLM adapter.
//
// Before this existed, a 429 or a transient 5xx surfaced to the user as a
// raw provider error — worst on OpenRouter, whose free variants carry a
// 20-requests/minute account-wide cap, and where a Vault request (the whole
// lore corpus) is not a cheap thing to lose. One implementation, all
// adapters: retry on rate limits and transient upstream failures, honour
// Retry-After precisely when the provider states one, and never retry
// non-transient errors (a 400 is wrong today and wrong in eight seconds).
//
// Scope gate: a 429 is a statement about the KEY, not the model — on
// OpenRouter especially, switching model must not escape the wait. Each
// scope (provider name) keeps a hold-until timestamp that every call
// through that scope awaits before running.

export const MAX_RETRIES = 3;
const TRANSIENT_RETRY_MS = 2_000;
const SECOND_RETRY_MS = 8_000;
const EXHAUSTION_RETRY_MS = 30_000;

const TRANSIENT_STATUSES = new Set([500, 502, 503, 520, 524]);

/** Extract an HTTP status from the error shapes the SDKs actually throw:
 *  a `.status` number (Anthropic/OpenAI SDKs), a nested response, or —
 *  narrowly — an "HTTP <code>" fragment in the message (our own adapters'
 *  fetch wrappers). */
export function statusOf(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as { status?: unknown; response?: { status?: unknown }; message?: unknown };
  if (typeof anyErr.status === "number") return anyErr.status;
  if (typeof anyErr.response?.status === "number") return anyErr.response.status;
  if (typeof anyErr.message === "string") {
    const m = /\bHTTP (\d{3})\b/.exec(anyErr.message);
    if (m) return Number(m[1]);
    // Gemini SDK errors carry the code in a JSON body string.
    const g = /"code":\s*(429|500|502|503)\b/.exec(anyErr.message);
    if (g) return Number(g[1]);
  }
  return null;
}

export function isRateLimit(err: unknown): boolean {
  if (statusOf(err) === 429) return true;
  const msg = err instanceof Error ? err.message : "";
  return /RESOURCE_EXHAUSTED|rate[_ ]limit/i.test(msg);
}

export function isTransient(err: unknown): boolean {
  const status = statusOf(err);
  return status !== null && TRANSIENT_STATUSES.has(status);
}

/** Retry-After from the error's headers, in milliseconds, or null. Both the
 *  Headers class and plain header objects appear in the wild. */
export function retryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const headers = (err as { headers?: unknown }).headers;
  let raw: string | undefined;
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    raw = headers.get("retry-after") ?? undefined;
  } else if (headers && typeof headers === "object") {
    const h = headers as Record<string, string | undefined>;
    raw = h["retry-after"] ?? h["Retry-After"];
  }
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n * 1000 : null;
}

// Per-scope hold: while set, calls in that scope wait before running.
const holds = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface RetryOptions {
  /** Provider name — the unit a 429 applies to. */
  scope: string;
  maxRetries?: number;
  /** Called before each wait, for logging/UI. */
  onRetry?: (attempt: number, waitMs: number, reason: string) => void;
}

/** Test seam. */
export function clearHolds(): void {
  holds.clear();
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  let attempt = 0;
  // Loop rather than recursion; the final failure rethrows the last error
  // untouched so adapter-specific error mapping still sees the real shape.
  for (;;) {
    const holdUntil = holds.get(opts.scope) ?? 0;
    const now = Date.now();
    if (holdUntil > now) await sleep(holdUntil - now);

    try {
      return await fn();
    } catch (err) {
      const rateLimited = isRateLimit(err);
      if (!rateLimited && !isTransient(err)) throw err;
      attempt += 1;
      if (attempt > maxRetries) throw err;

      const stated = retryAfterMs(err);
      const wait =
        stated !== null
          ? stated
          : attempt === 1
            ? TRANSIENT_RETRY_MS
            : attempt === 2
              ? SECOND_RETRY_MS
              : EXHAUSTION_RETRY_MS;

      if (rateLimited) {
        // The key is throttled, not the call — every request in this scope
        // waits, including ones that would switch model to dodge it.
        holds.set(opts.scope, Date.now() + wait);
      }

      const reason = rateLimited ? "rate limit" : `transient HTTP ${statusOf(err) ?? "error"}`;
      opts.onRetry?.(attempt, wait, reason);
      console.warn(`[${opts.scope}] ${reason} — retry ${attempt}/${maxRetries} in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
}
