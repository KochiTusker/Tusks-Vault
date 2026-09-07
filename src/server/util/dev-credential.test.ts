import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import {
  clearDevCredential,
  devCredentialStatus,
  getDevAuthHeader,
  getDevCredential,
  hasDevCredential,
  setDevCredential,
} from "./dev-credential";

// Synthetic token shapes — match the regex but DON'T correspond to any real
// GitHub account. The verify step calls GitHub's API which (for these fake
// values) returns 401. We mock global.fetch to control the response.

const FAKE_CLASSIC_PAT = "ghp_aaaaBBBBccccDDDDeeeeFFFFgggg11112222";
const FAKE_FINE_GRAINED = "github_pat_aaaaBBBBccccDDDDeeeeFFFFggggHHHHiiiiJJJJkkkkLLLL";

beforeEach(() => {
  clearDevCredential();
});

afterEach(() => {
  clearDevCredential();
  vi.restoreAllMocks();
});

describe("dev-credential state", () => {
  it("starts empty", () => {
    expect(hasDevCredential()).toBe(false);
    expect(getDevCredential()).toBeNull();
    expect(getDevAuthHeader()).toBeNull();
    expect(devCredentialStatus()).toEqual({ present: false, setAt: null });
  });
});

describe("setDevCredential — input validation (no network call needed)", () => {
  it("rejects empty input", async () => {
    const r = await setDevCredential("");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/required/i);
    expect(hasDevCredential()).toBe(false);
  });

  it("rejects whitespace-only input", async () => {
    const r = await setDevCredential("   \t  ");
    expect(r.ok).toBe(false);
    expect(hasDevCredential()).toBe(false);
  });

  it("rejects strings that don't look like a GitHub PAT", async () => {
    expect((await setDevCredential("not-a-token")).ok).toBe(false);
    expect((await setDevCredential("sk-ant-this-is-an-anthropic-key-12345")).ok).toBe(false);
    expect((await setDevCredential("AIzaSomethingThatLooksLikeAGoogleKey")).ok).toBe(false);
    expect(hasDevCredential()).toBe(false);
  });

  it("rejects a too-short token even with the right prefix", async () => {
    const r = await setDevCredential("ghp_short");
    expect(r.ok).toBe(false);
    expect(hasDevCredential()).toBe(false);
  });
});

describe("setDevCredential — GitHub verification (mocked fetch)", () => {
  // Note: these tests bypass the `git remote get-url dev` step because the
  // worktree doesn't have a `dev` remote configured. We can't easily mock
  // execSync from here, so we exercise the regex layer + fetch behavior
  // separately. The full GitHub-API integration is exercised end-to-end
  // when the maintainer pastes a real PAT into the dashboard.

  it("doesn't store the token when GitHub returns 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 401 }),
    );
    const r = await setDevCredential(FAKE_CLASSIC_PAT);
    // Either rejected at GitHub OR at the dev-remote-resolution step.
    // In both cases, the token must NOT be stored.
    expect(r.ok).toBe(false);
    expect(hasDevCredential()).toBe(false);
  });

  it("doesn't store the token when GitHub returns 404 (no access)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 404 }),
    );
    const r = await setDevCredential(FAKE_FINE_GRAINED);
    expect(r.ok).toBe(false);
    expect(hasDevCredential()).toBe(false);
  });

  it("doesn't store the token when fetch itself throws (network down)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ENOTFOUND github.com"));
    const r = await setDevCredential(FAKE_CLASSIC_PAT);
    expect(r.ok).toBe(false);
    expect(hasDevCredential()).toBe(false);
  });
});

describe("clearDevCredential", () => {
  it("wipes any in-memory state to the initial empty state", () => {
    // Manually set state via the test helper path is awkward, so just
    // verify clear() is idempotent and leaves state empty.
    clearDevCredential();
    expect(hasDevCredential()).toBe(false);
    expect(devCredentialStatus()).toEqual({ present: false, setAt: null });
  });
});

describe("getDevAuthHeader", () => {
  it("returns null when no token is stored", () => {
    clearDevCredential();
    expect(getDevAuthHeader()).toBeNull();
  });
});

// ─── Success-path suite ────────────────────────────────────────────────────
//
// These tests configure a REAL `dev` git remote (against a hypothetical URL)
// so `git remote get-url dev` succeeds inside setDevCredential. fetch is
// then mocked to return 200, so the GitHub-verification path also passes.
// After teardown the dev remote is removed, leaving the repo state unchanged.
describe("setDevCredential — success path", () => {
  const SUCCESS_PAT = "ghp_successPath00aaBBccDD11223344eeFF";

  beforeEach(() => {
    // Tolerate prior runs that left a `dev` remote behind.
    try { execSync("git remote remove dev", { stdio: "ignore" }); } catch { /* ignore */ }
    execSync("git remote add dev https://github.com/KochiTusker/Tusks-Vault-Dev.git", { stdio: "ignore" });
    clearDevCredential();
  });

  afterEach(() => {
    try { execSync("git remote remove dev", { stdio: "ignore" }); } catch { /* ignore */ }
    clearDevCredential();
  });

  it("stores the token in memory when GitHub returns 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 200 }),
    );
    expect(hasDevCredential()).toBe(false);

    const r = await setDevCredential(SUCCESS_PAT);

    expect(r.ok).toBe(true);
    expect(r.ownerRepo).toBe("KochiTusker/Tusks-Vault-Dev");
    expect(hasDevCredential()).toBe(true);
    expect(getDevCredential()).toBe(SUCCESS_PAT);
  });

  it("populates devCredentialStatus.setAt with a recent ISO timestamp", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 200 }),
    );
    const before = Date.now();

    await setDevCredential(SUCCESS_PAT);

    const status = devCredentialStatus();
    expect(status.present).toBe(true);
    expect(status.setAt).not.toBeNull();
    const setAtMs = new Date(status.setAt!).getTime();
    // Within a 2-second window of the test wall-clock — proves it's not
    // a stale value lingering from a previous test.
    expect(setAtMs).toBeGreaterThanOrEqual(before);
    expect(setAtMs).toBeLessThanOrEqual(Date.now());
  });

  it("constructs the correct HTTP Basic Authorization header (oauth2:<PAT>)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 200 }),
    );
    await setDevCredential(SUCCESS_PAT);

    const header = getDevAuthHeader();
    // Header must be exactly "Authorization: Basic <base64('oauth2:<PAT>')>".
    // Compute the expectation independently so a copy-paste error in the
    // implementation gets caught.
    const expected = `Authorization: Basic ${Buffer.from(`oauth2:${SUCCESS_PAT}`).toString("base64")}`;
    expect(header).toBe(expected);
  });

  it("calls GitHub's /repos/<owner>/<repo> endpoint with token auth", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 200 }),
    );

    await setDevCredential(SUCCESS_PAT);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/KochiTusker/Tusks-Vault-Dev");
    expect((options as RequestInit).headers).toMatchObject({
      Authorization: `token ${SUCCESS_PAT}`,
      Accept: "application/vnd.github+json",
    });
  });

  it("replaces a previously-stored token when called again with a new valid PAT", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 200 }),
    );
    const first = "ghp_firstToken000aaBBccDDeeFFgg11223344";
    const second = "ghp_secondToken00aaBBccDDeeFFgg11223344";

    await setDevCredential(first);
    expect(getDevCredential()).toBe(first);

    await setDevCredential(second);
    expect(getDevCredential()).toBe(second);
  });
});

describe("clearDevCredential — after a successful set", () => {
  const SUCCESS_PAT = "ghp_clearTest00aaBBccDDeeFFgg11223344";

  beforeEach(() => {
    try { execSync("git remote remove dev", { stdio: "ignore" }); } catch { /* ignore */ }
    execSync("git remote add dev https://github.com/KochiTusker/Tusks-Vault-Dev.git", { stdio: "ignore" });
    clearDevCredential();
  });

  afterEach(() => {
    try { execSync("git remote remove dev", { stdio: "ignore" }); } catch { /* ignore */ }
    clearDevCredential();
  });

  it("wipes the token and resets status when called after a successful set", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 200 }),
    );
    await setDevCredential(SUCCESS_PAT);
    expect(hasDevCredential()).toBe(true);

    clearDevCredential();

    expect(hasDevCredential()).toBe(false);
    expect(getDevCredential()).toBeNull();
    expect(getDevAuthHeader()).toBeNull();
    expect(devCredentialStatus()).toEqual({ present: false, setAt: null });
  });
});

describe("setDevCredential — dev remote with SSH-format URL is also parsed correctly", () => {
  // The dev-remote URL parser accepts both `https://github.com/owner/repo`
  // and `git@github.com:owner/repo`. This test exercises the SSH form.
  beforeEach(() => {
    try { execSync("git remote remove dev", { stdio: "ignore" }); } catch { /* ignore */ }
    execSync("git remote add dev git@github.com:KochiTusker/Tusks-Vault-Dev.git", { stdio: "ignore" });
    clearDevCredential();
  });

  afterEach(() => {
    try { execSync("git remote remove dev", { stdio: "ignore" }); } catch { /* ignore */ }
    clearDevCredential();
  });

  it("verifies against the correct owner/repo regardless of URL scheme", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 200 }),
    );

    await setDevCredential("ghp_sshFormatTest0aaBBccDDeeFFgg11223344");

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/KochiTusker/Tusks-Vault-Dev");
  });
});
