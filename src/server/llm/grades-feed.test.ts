// The two things worth pinning here are both failure behaviours, because the
// success path is the one that gets exercised by hand:
//
//   1. a bad or hostile feed must never make the picker emptier than the
//      bundle it shipped with, and
//   2. nothing in this module may throw at the caller — the model browser has
//      to render whether or not a static file was reachable.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let tmp: string;
let originalConfigDir: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "vault-grades-"));
  originalConfigDir = process.env.TUSKS_VAULT_CONFIG_DIR;
  process.env.TUSKS_VAULT_CONFIG_DIR = tmp;
  vi.resetModules();
});

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.TUSKS_VAULT_CONFIG_DIR;
  else process.env.TUSKS_VAULT_CONFIG_DIR = originalConfigDir;
  rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const feedWith = (id: string) => ({
  version: 1,
  measuredAt: "2099-01-01",
  accuracyMethod: "m",
  maturityMethod: "m",
  accuracy: { [id]: [{ outcomes: { lookup: "engaged" } }] },
  maturity: { [id]: [{ axes: {} }] },
});

describe("isGradesFeed", () => {
  it("rejects a version it does not know", async () => {
    const { isGradesFeed } = await import("./grades-feed");
    expect(isGradesFeed({ ...feedWith("a/b"), version: 2 })).toBe(false);
  });

  it("rejects a feed whose records are not records of arrays", async () => {
    const { isGradesFeed } = await import("./grades-feed");
    expect(isGradesFeed({ ...feedWith("a/b"), accuracy: { "a/b": "not-an-array" } })).toBe(false);
    expect(isGradesFeed({ ...feedWith("a/b"), maturity: [] })).toBe(false);
  });

  it("accepts a well-formed feed", async () => {
    const { isGradesFeed } = await import("./grades-feed");
    expect(isGradesFeed(feedWith("a/b"))).toBe(true);
  });
});

describe("mergeOverBundled", () => {
  it("adds published models without dropping bundled ones", async () => {
    const { mergeOverBundled, bundledGrades } = await import("./grades-feed");
    const bundled = bundledGrades();
    const someBundledModel = Object.keys(bundled.accuracy)[0];
    expect(someBundledModel).toBeTruthy();

    const merged = mergeOverBundled(feedWith("brand/new-model") as never);
    expect(merged.accuracy["brand/new-model"]).toBeTruthy();
    // The whole point of merging rather than replacing.
    expect(merged.accuracy[someBundledModel]).toEqual(bundled.accuracy[someBundledModel]);
  });

  it("cannot shrink the grade set, even from an empty feed", async () => {
    const { mergeOverBundled, bundledGrades } = await import("./grades-feed");
    const bundled = bundledGrades();
    const merged = mergeOverBundled({
      version: 1,
      measuredAt: "2099-01-01",
      accuracyMethod: "",
      maturityMethod: "",
      accuracy: {},
      maturity: {},
    } as never);
    // A truncated publish is the realistic bad day — a half-finished grading
    // run, or a botched emit. It must not delete what the build already had.
    expect(Object.keys(merged.accuracy).length).toBe(Object.keys(bundled.accuracy).length);
    expect(merged.accuracyMethod).toBe(bundled.accuracyMethod);
  });
});

describe("getGrades", () => {
  it("falls back to the bundled copy when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const { getGrades, bundledGrades } = await import("./grades-feed");
    const got = await getGrades();
    expect(got.source).toBe("bundled");
    expect(Object.keys(got.feed.accuracy).length).toBe(Object.keys(bundledGrades().accuracy).length);
  });

  it("falls back rather than trusting a feed that is not one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ hello: "world" }) })));
    const { getGrades } = await import("./grades-feed");
    const got = await getGrades();
    expect(got.source).toBe("bundled");
  });

  it("never touches the network when refresh is off", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const { getGrades } = await import("./grades-feed");
    const got = await getGrades({ refresh: false });
    expect(spy).not.toHaveBeenCalled();
    expect(got.source).toBe("bundled");
  });

  it("uses a published feed and caches it", async () => {
    const published = feedWith("brand/new-model");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => published })));
    const { getGrades, readCachedGrades } = await import("./grades-feed");
    const got = await getGrades();
    expect(got.source).toBe("published");
    expect(got.feed.accuracy["brand/new-model"]).toBeTruthy();
    expect(readCachedGrades()?.feed.accuracy["brand/new-model"]).toBeTruthy();
  });

  it("serves a stale cache when the network is gone", async () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      path.join(tmp, "model-grades.json"),
      JSON.stringify({ fetchedAt: "2000-01-01T00:00:00.000Z", feed: feedWith("cached/model") })
    );
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const { getGrades } = await import("./grades-feed");
    const got = await getGrades();
    expect(got.source).toBe("cache");
    expect(got.feed.accuracy["cached/model"]).toBeTruthy();
  });
});
