import { execSync } from "node:child_process";

// In-memory store for a GitHub Personal Access Token used by the in-app
// updater when `settings.updaterRemote === "dev"`. The token NEVER touches
// disk — it lives only in this module's closure and is wiped when the
// process restarts. Every reboot, the maintainer pastes their PAT into
// the dashboard again.
//
// Security model:
//   - The toggle UX is local-only — flipping `updaterRemote: "dev"` doesn't
//     itself reveal anything.
//   - The actual gate is GitHub's auth on the private dev repo. Without a
//     valid PAT that has read access, every git fetch / API call to the
//     dev repo returns 404 from GitHub. No code, no metadata, nothing.
//   - The PAT is not persisted across restarts, so a stolen disk image
//     can't be used to access dev. The setting can stay flipped, but the
//     in-memory credential it requires is gone.

let inMemoryToken: string | null = null;
let setAtMs: number | null = null;

// Six prefixes that GitHub uses for the various PAT / OAuth flavours. The
// length suffix is conservative — we don't pin the exact char count because
// GitHub has tweaked it over the years.
const GITHUB_PAT_RE = /^(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}$/;

export interface DevCredentialStatus {
  present: boolean;
  /** When the token was last set, ISO string. Null when no token. */
  setAt: string | null;
}

export function hasDevCredential(): boolean {
  return inMemoryToken !== null;
}

export function getDevCredential(): string | null {
  return inMemoryToken;
}

export function devCredentialStatus(): DevCredentialStatus {
  return {
    present: inMemoryToken !== null,
    setAt: setAtMs !== null ? new Date(setAtMs).toISOString() : null,
  };
}

export function clearDevCredential(): void {
  inMemoryToken = null;
  setAtMs = null;
}

export interface VerifyResult {
  ok: boolean;
  /** Human-readable explanation. Safe to surface in the dashboard. */
  reason: string;
  /** When ok, the owner/repo we verified against. Lets the UI confirm
   *  "Authenticated against KochiTusker/Tusks-Vault-Dev". */
  ownerRepo?: string;
}

/**
 * Resolve the URL of the local `dev` git remote. The maintainer adds this
 * with `git remote add dev https://github.com/KochiTusker/Tusks-Vault-Dev.git`
 * before flipping the dashboard toggle. The function parses the URL to
 * extract the GitHub owner+repo so the verification step knows what to
 * ask GitHub about.
 */
function resolveDevRemote(): { url: string; owner: string; repo: string } | { error: string } {
  let url: string;
  try {
    // stdio pipes stderr instead of inheriting it. A missing `dev` remote is
    // the ORDINARY case — almost nobody configures one — and it is handled
    // right below, so letting git print "error: No such remote 'dev'" to the
    // console reports a non-problem as an error. It also put three of those
    // lines in every test run, which is noise the next real failure has to
    // compete with.
    url = execSync("git remote get-url dev", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return {
      error:
        "No `dev` remote configured. Run `git remote add dev https://github.com/KochiTusker/Tusks-Vault-Dev.git` (or your fork's equivalent) and retry.",
    };
  }
  // Accept both https://github.com/owner/repo(.git)? and git@github.com:owner/repo(.git)?
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (!m) {
    return { error: `Can't parse GitHub owner/repo from dev remote URL: ${url}` };
  }
  return { url, owner: m[1], repo: m[2] };
}

/**
 * Build the HTTP Basic Authorization header for the in-memory PAT, suitable
 * for `git -c http.extraheader=<header>` or, better, passed via env var with
 * `git --config-env=http.extraheader=ENVVAR` so the token never appears in
 * argv. Returns null when no token is set.
 *
 * GitHub's convention: username `oauth2`, password = PAT. They ignore the
 * username slot for token auth.
 */
export function getDevAuthHeader(): string | null {
  const token = inMemoryToken;
  if (!token) return null;
  const b64 = Buffer.from(`oauth2:${token}`, "utf-8").toString("base64");
  return `Authorization: Basic ${b64}`;
}

/**
 * Validate format + verify GitHub access in one round-trip. The token is
 * NOT stored unless verification succeeds. Stored only in memory; no disk.
 */
export async function setDevCredential(token: string): Promise<VerifyResult> {
  if (typeof token !== "string" || !token.trim()) {
    return { ok: false, reason: "Token is required." };
  }
  const trimmed = token.trim();
  if (!GITHUB_PAT_RE.test(trimmed)) {
    return {
      ok: false,
      reason:
        "Doesn't look like a GitHub Personal Access Token. Expected a string starting with ghp_, gho_, ghu_, ghs_, ghr_, or github_pat_.",
    };
  }

  const resolved = resolveDevRemote();
  if ("error" in resolved) {
    return { ok: false, reason: resolved.error };
  }

  // Ask GitHub whether this token has read access to the configured repo.
  // We don't accept the token unless the API returns 200 — invalid or
  // wrong-scope tokens never get stored.
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${resolved.owner}/${resolved.repo}`, {
      headers: {
        Authorization: `token ${trimmed}`,
        Accept: "application/vnd.github+json",
        // GitHub asks for a User-Agent. Use a generic one.
        "User-Agent": "tusks-vault-updater",
      },
    });
  } catch (err) {
    return {
      ok: false,
      reason: `Couldn't reach GitHub to verify the token: ${(err as Error).message}.`,
    };
  }

  if (res.status === 200) {
    inMemoryToken = trimmed;
    setAtMs = Date.now();
    return {
      ok: true,
      reason: `Authenticated against ${resolved.owner}/${resolved.repo} this session.`,
      ownerRepo: `${resolved.owner}/${resolved.repo}`,
    };
  }
  if (res.status === 401) {
    return { ok: false, reason: "Token is invalid or expired. GitHub returned 401." };
  }
  if (res.status === 404) {
    return {
      ok: false,
      reason: `Token doesn't have access to ${resolved.owner}/${resolved.repo}, or the repo doesn't exist. GitHub returned 404.`,
    };
  }
  return {
    ok: false,
    reason: `GitHub API returned HTTP ${res.status}. Try again, or double-check the dev remote URL.`,
  };
}
