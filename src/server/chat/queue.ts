// Concurrency and cooldown for questions, per surface.
//
// Until now every question started an LLM call the moment it arrived. On
// Discord that was survivable — four simultaneous mentions were four concurrent
// API calls and a bigger bill. On a Foundry table it is not: Claude Code spawns
// a CLI process per answer and draws on one shared subscription window, so four
// players typing at once is four processes on the GM's laptop, all fighting for
// the same window, and a fourth player watching nothing happen.
//
// Two independent limits, because they solve different problems:
//
//   concurrency   protects the PROVIDER. How many answers may be in flight for
//                 one surface at a time.
//   cooldown      protects the TABLE. How soon one person may ask again, so a
//                 single player cannot occupy the queue by holding down Enter.
//
// Both are per-surface. Discord and Foundry queue independently: a busy table
// should not stall a question asked in a Discord thread.

import type { SurfaceId } from "./types";

/**
 * How many answers may be generated at once for one surface.
 *
 * Claude Code gets 1. It is not a rate limit — it is that each answer is a
 * spawned CLI process taking 5–10 seconds, drawing on a subscription window
 * shared with every other caller. Two at once is measurably slower than two in
 * sequence, and the second process makes the first one worse.
 */
export function concurrencyFor(provider: string): number {
  return provider === "claudeCode" ? 1 : 2;
}

/** Minimum gap between two questions from the same person. Long enough to stop
 *  a held-down Enter key, short enough that a genuine follow-up never trips it. */
export const ASKER_COOLDOWN_MS = 3_000;

interface Waiter {
  resolve: () => void;
}

interface SurfaceQueue {
  active: number;
  limit: number;
  waiting: Waiter[];
}

const queues = new Map<SurfaceId, SurfaceQueue>();
const lastAsk = new Map<string, number>();

function queueFor(surface: SurfaceId, limit: number): SurfaceQueue {
  const existing = queues.get(surface);
  if (existing) {
    // The provider can change between questions — the user switches the surface
    // from Claude Code to OpenRouter mid-session. Track the current limit rather
    // than the one that happened to apply when the queue was created.
    existing.limit = limit;
    return existing;
  }
  const created: SurfaceQueue = { active: 0, limit, waiting: [] };
  queues.set(surface, created);
  return created;
}

/** How many are already waiting — 0 when a question arriving now starts
 *  immediately. Read before enqueueing so a surface can tell the asker where
 *  they stand instead of showing a placeholder that looks hung. */
export function queueDepth(surface: SurfaceId): number {
  return queues.get(surface)?.waiting.length ?? 0;
}

export interface CooldownCheck {
  /** Flat, not a union — `strictNullChecks` is off in this repo. */
  allowed: boolean;
  /** Milliseconds still to wait. Only meaningful when `allowed` is false. */
  retryInMs?: number;
}

/**
 * Has this person asked too recently?
 *
 * Separate from `runQueued` and checked BEFORE it, so a surface can decline
 * without occupying a queue slot. Keyed per surface as well as per asker: the
 * same human on Discord and in Foundry is two askers, and rate-limiting one
 * because of the other would be baffling.
 */
export function checkCooldown(surface: SurfaceId, askerId: string): CooldownCheck {
  const key = `${surface}:${askerId}`;
  const previous = lastAsk.get(key);
  const now = Date.now();
  if (previous !== undefined && now - previous < ASKER_COOLDOWN_MS) {
    return { allowed: false, retryInMs: ASKER_COOLDOWN_MS - (now - previous) };
  }
  lastAsk.set(key, now);
  return { allowed: true };
}

/**
 * Run `fn` when the surface has a free slot.
 *
 * The release is in a `finally`: a thrown call must give its slot back, or one
 * provider error permanently narrows the queue and the surface degrades until
 * restart.
 */
export async function runQueued<T>(
  surface: SurfaceId,
  limit: number,
  fn: () => Promise<T>
): Promise<T> {
  const q = queueFor(surface, limit);

  if (q.active >= q.limit) {
    // Waiting INHERITS the slot released to it; it does not take one. See the
    // hand-off below for why.
    await new Promise<void>(resolve => q.waiting.push({ resolve }));
  } else {
    q.active += 1;
  }

  try {
    return await fn();
  } finally {
    const next = q.waiting.shift();
    if (next) {
      // Hand the slot straight to the next waiter WITHOUT dropping the count.
      // Decrementing first and letting the waiter re-increment leaves a gap:
      // resolve() only schedules a microtask, so a question arriving in between
      // would see a free slot, take it, and push the surface past its limit —
      // which on Claude Code means two CLI processes where the whole point was
      // to allow one.
      next.resolve();
    } else {
      q.active -= 1;
    }
  }
}

export function _resetQueuesForTests(): void {
  queues.clear();
  lastAsk.clear();
}
