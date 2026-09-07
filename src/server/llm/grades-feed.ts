// Model grades, refreshed from the published docs site.
//
// The problem this solves: grades are measured by running cases against real
// models, which happens on the maintainer's machine whenever a model is worth
// grading — not on a release schedule. Compiled into the bundle, a new grade
// reached users only when the next version shipped, so the picker showed
// nothing for models that had in fact been measured weeks earlier.
//
// So the same shape as the OpenRouter catalogue: fetch, cache on disk, fall
// back rather than fail. Three sources, in order of preference:
//
//   published  the feed on the docs site, refreshed at most daily
//   cache      the last good fetch, however old
//   bundled    the measurements compiled into this build
//
// The bundled copy is the floor, never removed: an install that has never had
// network access, or one whose owner has switched the refresh off, still shows
// every grade that existed when it was built. A fetch can only ADD models and
// move grades forward; it can never leave the picker emptier than a fresh
// clone would be.
//
// Nothing here is required for Vault to answer a question. If this whole file
// fails, the model browser shows the grades it shipped with.

import fs from "fs";
import { configFile, ensureConfigDir } from "../config/app-data";
import { writeFileAtomic } from "../util/atomic-write";
import {
  ACCURACY_MEASUREMENTS,
  ACCURACY_MEASURED_AT,
  ACCURACY_METHOD_NOTE,
  type AccuracyRun,
} from "./accuracy-measurements";
import { ALL_MEASUREMENTS, MEASURED_AT, METHOD_NOTE } from "./maturity-measurements";
import type { MaturityRun } from "./maturity-grade";

/** Where the maintainer publishes measured grades. Same origin as the docs
 *  site, so it is covered by the same publish review as every other byte
 *  there — there is no separate server to trust or keep up. */
export const GRADES_URL = "https://kochitusker.github.io/Tusks-Vault/grades.json";

const REFRESH_MS = 24 * 60 * 60 * 1000;

export interface GradesFeed {
  /** Bumped only for a breaking shape change. An unknown version is ignored
   *  in favour of the bundled copy rather than parsed hopefully. */
  version: 1;
  measuredAt: string;
  accuracyMethod: string;
  maturityMethod: string;
  accuracy: Record<string, AccuracyRun[]>;
  maturity: Record<string, MaturityRun[]>;
}

export type GradesSource = "published" | "cache" | "bundled";

export interface ResolvedGrades {
  feed: GradesFeed;
  source: GradesSource;
  /** When the fetch that produced this happened; null for the bundled copy. */
  fetchedAt: string | null;
}

/** The measurements compiled into this build. Always available. */
export function bundledGrades(): GradesFeed {
  return {
    version: 1,
    measuredAt: MEASURED_AT || ACCURACY_MEASURED_AT,
    accuracyMethod: ACCURACY_METHOD_NOTE,
    maturityMethod: METHOD_NOTE,
    accuracy: ACCURACY_MEASUREMENTS,
    maturity: ALL_MEASUREMENTS,
  };
}

// Through config/app-data, which is the documented resolver and honours
// TUSKS_VAULT_CONFIG_DIR. Reaching for env-paths directly here would work in
// production and quietly write to the real config directory under test.
function cacheFile(): string {
  return configFile("model-grades.json");
}

interface CachedGrades {
  fetchedAt: string;
  feed: GradesFeed;
}

/**
 * Is this JSON actually a grades feed?
 *
 * Deliberately strict. This is parsed from a network response, and the values
 * end up deciding what letter a user sees next to a model they are about to
 * spend money on. A malformed or half-written feed must fall back to the
 * bundled copy, not render as an empty grade sheet.
 */
export function isGradesFeed(v: unknown): v is GradesFeed {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  if (f.version !== 1) return false;
  if (typeof f.measuredAt !== "string" || !f.measuredAt) return false;
  if (typeof f.accuracyMethod !== "string" || typeof f.maturityMethod !== "string") return false;
  const runsRecord = (r: unknown): boolean =>
    !!r &&
    typeof r === "object" &&
    !Array.isArray(r) &&
    Object.values(r as Record<string, unknown>).every(v => Array.isArray(v));
  return runsRecord(f.accuracy) && runsRecord(f.maturity);
}

export function readCachedGrades(): CachedGrades | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), "utf-8")) as CachedGrades;
    if (!raw || typeof raw.fetchedAt !== "string" || !isGradesFeed(raw.feed)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeCachedGrades(entry: CachedGrades): void {
  ensureConfigDir();
  // Atomic against a second process — the dev server and a script can race.
  writeFileAtomic(cacheFile(), JSON.stringify(entry));
}

function isFresh(entry: CachedGrades | null): boolean {
  if (!entry) return false;
  const age = Date.now() - Date.parse(entry.fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < REFRESH_MS;
}

/**
 * Merge a fetched feed over the bundled one.
 *
 * Union, not replacement, and this is the load-bearing choice in the file: a
 * published feed that regressed — truncated, or emitted from a half-finished
 * grading run — must not delete grades the build already had. The published
 * entry wins per model, because it is the newer measurement of that model; a
 * model absent from it keeps whatever shipped.
 */
export function mergeOverBundled(published: GradesFeed): GradesFeed {
  const base = bundledGrades();
  return {
    version: 1,
    measuredAt: published.measuredAt || base.measuredAt,
    accuracyMethod: published.accuracyMethod || base.accuracyMethod,
    maturityMethod: published.maturityMethod || base.maturityMethod,
    accuracy: { ...base.accuracy, ...published.accuracy },
    maturity: { ...base.maturity, ...published.maturity },
  };
}

/**
 * Grades for the model picker.
 *
 * `refresh: false` never touches the network — the caller's opt-out, and what
 * every code path that is not the model browser should pass.
 */
export async function getGrades(
  opts: { force?: boolean; refresh?: boolean } = {}
): Promise<ResolvedGrades> {
  const allowNetwork = opts.refresh !== false;
  const cached = readCachedGrades();

  if (!allowNetwork) {
    return cached
      ? { feed: mergeOverBundled(cached.feed), source: "cache", fetchedAt: cached.fetchedAt }
      : { feed: bundledGrades(), source: "bundled", fetchedAt: null };
  }

  if (!opts.force && isFresh(cached)) {
    return {
      feed: mergeOverBundled((cached as CachedGrades).feed),
      source: "cache",
      fetchedAt: (cached as CachedGrades).fetchedAt,
    };
  }

  try {
    const res = await fetch(GRADES_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!isGradesFeed(body)) throw new Error("response is not a grades feed");
    const fetchedAt = new Date().toISOString();
    writeCachedGrades({ fetchedAt, feed: body });
    return { feed: mergeOverBundled(body), source: "published", fetchedAt };
  } catch (err) {
    // Never throws to the caller. A stale grade, or the one this build shipped
    // with, beats a model browser that will not render because a static file
    // was briefly unreachable.
    if (cached) {
      return { feed: mergeOverBundled(cached.feed), source: "cache", fetchedAt: cached.fetchedAt };
    }
    console.warn("[grades] refresh failed, using bundled grades:", (err as Error)?.message ?? err);
    return { feed: bundledGrades(), source: "bundled", fetchedAt: null };
  }
}
