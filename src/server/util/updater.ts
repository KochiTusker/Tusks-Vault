import { spawn } from "child_process";
import { existsSync, promises as fsp } from "fs";
import path from "path";
import { shellSafeSpawn } from "./win-spawn";

const ROOT = process.cwd();

interface CaptureResult {
  code: number;
  stdout: string;
  stderr: string;
}

// cmd.exe quoting and the DEP0190 workaround both live in util/win-spawn.ts
// now — llm/claude-code-cli.ts needs the identical rule for the same reason
// (a Windows .cmd shim), and two copies of a quoting rule is one copy that
// eventually goes stale.

// Node 22+ emits DEP0190 when spawn() is called with shell:true *and* a
// separate args array, because the runtime concatenates the array into the
// command line without any escaping — which is a shell-injection risk for
// any unsanitised arg. The fix: when we need a shell on Windows (to resolve
// .cmd/.bat shims like git on some setups), build a single pre-quoted
// command string ourselves and pass an empty args array.
function capture(cmd: string, args: string[], extraEnv?: Record<string, string>): Promise<CaptureResult> {
  return new Promise(resolve => {
    // AUDIT: shell:true only on Windows, and only to resolve git's .cmd/.bat
    // shim. shellSafeSpawn pre-quotes every argument into one string and hands
    // spawn an empty args array, so nothing is concatenated unescaped.
    const spawned = shellSafeSpawn(cmd, args);
    const child = spawn(spawned.command, spawned.args, {
      cwd: ROOT,
      shell: spawned.shell,
      env: extraEnv ? { ...process.env, ...extraEnv } : undefined,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", c => { stdout += c.toString(); });
    child.stderr?.on("data", c => { stderr += c.toString(); });
    child.on("exit", code => resolve({ code: code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on("error", () => resolve({ code: 1, stdout, stderr }));
  });
}

// When dev-mode auth is in play, every git invocation that touches the
// network is wrapped with `git --config-env=http.extraheader=ENVVAR`. The
// header travels via env var so the embedded PAT never appears in argv.
// Returns the leading args + env map to pass alongside the command.
const AUTH_HEADER_ENV_VAR = "TUSKS_VAULT_UPDATE_AUTH_HEADER";
function authPrefix(authHeader?: string): { args: string[]; env: Record<string, string> } {
  if (!authHeader) return { args: [], env: {} };
  return {
    args: [`--config-env=http.extraheader=${AUTH_HEADER_ENV_VAR}`],
    env: { [AUTH_HEADER_ENV_VAR]: authHeader },
  };
}

// Rich commit record — mirrors Tusks-Tomes' `UpdaterCommit` shape so the
// dashboard layout can list pending + ahead commits with author + date.
export interface UpdaterCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  /** "5m ago" style. Filled by --relative on the legacy local/remote fields. */
  relative?: string;
}

export interface UpdateStatus {
  /** Whether this install is a git clone (.git exists). */
  isGitInstall: boolean;
  /** Whether `git` itself is available on PATH. */
  gitAvailable: boolean;
  /** Mirror of Tomes' `installedViaGit` flag. Same as `isGitInstall && gitAvailable`. */
  installedViaGit: boolean;
  /** Current branch name, or null when on detached HEAD. */
  branch: string | null;
  /** Working tree clean? Only meaningful when installedViaGit. */
  clean: boolean;
  /** Up to 50 lines from `git status --porcelain`. Undefined when clean. */
  dirtyFiles?: string[];
  /** Resolved HEAD commit. null when not a git checkout. */
  head?: UpdaterCommit;
  /** Resolved origin/main commit. null when remote unknown / fetch failed. */
  remoteHead?: UpdaterCommit;
  /** Commits in origin/main but not in HEAD — what an apply would pull in. */
  pendingCommits: UpdaterCommit[];
  /** Commits in HEAD but not in origin/main — usually means hand-edited local commits. */
  aheadCommits: UpdaterCommit[];
  /** ISO timestamp of the last `git fetch origin main` we observed. */
  lastFetchAt?: string;
  /** Which upstream ref this status was computed against. "main" tracks
   *  origin/main; "tag" tracks the newest semver-shaped release tag. */
  track?: "main" | "tag";
  /** Name of the target tag when `track === "tag"`. Null when no matching
   *  tag exists in the repo. Undefined when track is "main". */
  targetTag?: string | null;
  /** Which git remote NAME this status was computed against. "origin" is
   *  the normal user path (public repo); "dev" is the maintainer's preview
   *  remote. The UI uses this to render an amber dev-mode banner. (Named
   *  `remoteName` to avoid colliding with the legacy `remote: CompactCommit`
   *  field, which is the remote HEAD's commit summary, not the remote
   *  identifier.) */
  remoteName?: string;
  /** Human-readable reason apply should be hidden / disabled. */
  blockedReason?: string;
  /** Short local HEAD info — kept for back-compat with older clients. */
  local: { sha: string; subject: string; relative: string } | null;
  /** Short remote main HEAD info — kept for back-compat. */
  remote: { sha: string; subject: string; relative: string } | null;
  /** Number of commits behind origin/main. Same as `pendingCommits.length`. */
  commitsBehind: number | null;
  /** True iff local is strictly behind remote. */
  isBehind: boolean;
  /** Human-readable error or hint if we couldn't fully check. */
  error: string | null;
  /**
   * True iff node_modules/.package-lock.json is older than package-lock.json.
   * Set by isNodeModulesStale() — means a previous update pulled new dep
   * versions but `npm install` hasn't run since. Mirrors Tusks-Tomes'
   * nodeModulesStale: the dashboard renders a persistent red banner until
   * the user runs the install themselves. Safety net for "user ignored the
   * post-apply prompt and walked away".
   */
  nodeModulesStale: boolean;
}

/**
 * Compare node_modules/.package-lock.json mtime to package-lock.json mtime.
 * npm rewrites the inner lock on every install, so when it's older than the
 * outer (committed) lock we know a pull brought in new dep versions but
 * `npm install` hasn't run since. Returns false when either file is missing
 * — that's the initial-setup case, handled by run.bat / run.sh on first boot.
 *
 * Same heuristic Tomes uses; kept identical so users on both projects see
 * matching staleness behaviour.
 */
export async function isNodeModulesStale(): Promise<boolean> {
  try {
    const lockStat = await fsp.stat(path.join(ROOT, "package-lock.json"));
    const nmStat = await fsp.stat(path.join(ROOT, "node_modules", ".package-lock.json"));
    return nmStat.mtimeMs < lockStat.mtimeMs;
  } catch {
    return false;
  }
}

/**
 * Loud console banner shown at server boot when node_modules is stale. The
 * in-app updater already surfaces the same fact via /api/updates/check, but
 * not every user has the dashboard open — a launcher-window banner is the
 * second line of defence. Non-fatal: the server boots regardless.
 */
export async function warnIfNodeModulesStale(): Promise<void> {
  if (!(await isNodeModulesStale())) return;
  console.warn(
    "\n" +
    "  ============================================================\n" +
    "   ! node_modules is OUT OF DATE with package-lock.json\n" +
    "  ============================================================\n" +
    "   A previous update pulled new dependency versions, but npm\n" +
    "   install has not been run since. Tusk's Vault may fail to\n" +
    "   import new packages until you refresh dependencies.\n" +
    "\n" +
    "   To fix: stop this server (Ctrl+C), then run:\n" +
    "       npm install --no-audit --no-fund\n" +
    "   (Windows PowerShell: cmd /c npm install --no-audit --no-fund)\n" +
    "   then re-launch via run.bat / run.sh.\n" +
    "  ============================================================\n"
  );
}

const PRETTY_FORMAT = "%H%x09%h%x09%s%x09%an%x09%aI%x09%cr";

function parseCommit(line: string): UpdaterCommit | null {
  if (!line) return null;
  const [sha, shortSha, subject, author, date, relative] = line.split("\t");
  if (!sha) return null;
  return {
    sha,
    shortSha: shortSha ?? sha.slice(0, 7),
    subject: subject ?? "",
    author: author ?? "",
    date: date ?? "",
    relative: relative ?? "",
  };
}

function parseCommitLines(stdout: string): UpdaterCommit[] {
  if (!stdout.trim()) return [];
  return stdout
    .split("\n")
    .map(parseCommit)
    .filter((c): c is UpdaterCommit => c !== null);
}

async function commitFor(rev: string): Promise<UpdaterCommit | undefined> {
  const r = await capture("git", ["log", "-1", `--pretty=format:${PRETTY_FORMAT}`, rev]);
  if (r.code !== 0) return undefined;
  return parseCommit(r.stdout) ?? undefined;
}

// FETCH_HEAD's mtime is the most reliable proxy for "when did the last
// `git fetch` against this remote run". Falling back to the refs/ tip
// catches setups where FETCH_HEAD was pruned manually. Same approach Tomes
// uses — kept identical so users get matching "last fetch" timestamps.
async function getFetchTime(remote: string = "origin"): Promise<string | undefined> {
  for (const p of [
    path.join(ROOT, ".git", "FETCH_HEAD"),
    path.join(ROOT, ".git", "refs", "remotes", remote, "main"),
  ]) {
    try {
      const stat = await fsp.stat(p);
      return stat.mtime.toISOString();
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export interface UpdateStatusOpts {
  /** When true, run `git fetch <remote> main` (and, in tag mode, also `--tags`)
   *  before computing status. */
  fetch?: boolean;
  /** Which upstream ref to compare against. "main" (default) tracks
   *  <remote>/main like before. "tag" finds the newest semver-shaped release
   *  tag and uses that as the target — forces the maintainer to bless each
   *  release with an explicit tag before it ships to users. */
  track?: "main" | "tag";
  /** Which git remote to fetch from. Defaults to "origin" — the public
   *  Tusks-Vault repo for a normal user install. Switch to "dev" after
   *  manually adding a `dev` remote pointing at Tusks-Vault-Dev to test
   *  unreleased commits. The security property here is GitHub auth, not
   *  the setting: an unauthorised caller flipping to "dev" sees a 404
   *  from git, never any dev-repo content. The PAT used for auth is
   *  passed via `authHeader` below — see dev-credential.ts. */
  remote?: string;
  /** HTTP Authorization header value, used by the dev-mode auth flow. When
   *  set, every network-touching git invocation runs with
   *  `git --config-env=http.extraheader=...` pointing at this header. The
   *  header travels via env var so the embedded PAT never appears in argv.
   *  Required when `remote === "dev"` for the Tusks-Vault-Dev fetch; null
   *  otherwise. */
  authHeader?: string;
}

/** Regex for "release" tags. Strict semver — `v1.2.3` only. Anything looser
 *  (e.g. release candidates) is intentionally excluded so a `v0.2.0-rc1` tag
 *  doesn't accidentally ship as a "release" before the final tag lands. */
const RELEASE_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

/** Sort release tags newest-first by semver components. Caller must filter
 *  for RELEASE_TAG_RE first — this function assumes its input matches.
 *  Exported for testing only. */
export function sortReleaseTagsDesc(tags: string[]): string[] {
  return tags
    .map(t => {
      const m = RELEASE_TAG_RE.exec(t);
      return m ? { tag: t, parts: [Number(m[1]), Number(m[2]), Number(m[3])] } : null;
    })
    .filter((x): x is { tag: string; parts: number[] } => x !== null)
    .sort((a, b) => {
      for (let i = 0; i < 3; i++) {
        if (a.parts[i] !== b.parts[i]) return b.parts[i] - a.parts[i];
      }
      return 0;
    })
    .map(x => x.tag);
}

/** Find the newest semver-shaped release tag locally known to git. Returns
 *  null if no matching tag exists. */
async function findNewestReleaseTag(): Promise<string | null> {
  const tagListRes = await capture("git", ["tag", "--list"]);
  if (tagListRes.code !== 0) return null;
  const all = tagListRes.stdout.split("\n").map(t => t.trim()).filter(Boolean);
  const sorted = sortReleaseTagsDesc(all.filter(t => RELEASE_TAG_RE.test(t)));
  return sorted[0] ?? null;
}

export async function getUpdateStatus(opts: UpdateStatusOpts = {}): Promise<UpdateStatus> {
  const isGitInstall = existsSync(path.join(ROOT, ".git"));
  const gitVer = await capture("git", ["--version"]);
  const gitAvailable = gitVer.code === 0;
  const installedViaGit = isGitInstall && gitAvailable;
  const track = opts.track ?? "main";
  const remote = opts.remote ?? "origin";
  const auth = authPrefix(opts.authHeader);

  // Default-empty shape so the API always returns the same field set even
  // when prerequisites fail. Clients can rely on these always being present.
  const nodeModulesStale = await isNodeModulesStale();
  const base: UpdateStatus = {
    isGitInstall,
    gitAvailable,
    installedViaGit,
    branch: null,
    clean: false,
    pendingCommits: [],
    aheadCommits: [],
    local: null,
    remote: null,
    commitsBehind: null,
    isBehind: false,
    error: null,
    nodeModulesStale,
    track,
    targetTag: track === "tag" ? null : undefined,
    remoteName: remote,
  };

  if (!gitAvailable) {
    base.error = "Git is not installed. Install Git from https://git-scm.com/ to enable in-app updates.";
    base.blockedReason = base.error;
    return base;
  }
  if (!isGitInstall) {
    base.error = "This install isn't a git clone (no .git directory). The in-app updater can't help — re-download the latest ZIP from GitHub or clone the repo with git.";
    base.blockedReason = base.error;
    return base;
  }

  // Branch
  const branchRes = await capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  base.branch = branchRes.code === 0 && branchRes.stdout ? branchRes.stdout : null;

  // Dirty-tree check. `git status --porcelain` lists every modified or
  // untracked file. We exclude untracked entries ("??") so .env.local and
  // friends don't flag the tree as dirty.
  const statusRes = await capture("git", ["status", "--porcelain"]);
  const dirtyLines = statusRes.stdout
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith("??"))
    .slice(0, 50);
  base.clean = dirtyLines.length === 0;
  if (!base.clean) base.dirtyFiles = dirtyLines;

  // HEAD commit (full pretty record)
  base.head = await commitFor("HEAD");
  if (base.head) {
    base.local = { sha: base.head.shortSha, subject: base.head.subject, relative: base.head.relative ?? "" };
  }

  // Optionally fetch first. Failures here surface as a blockedReason but
  // don't tank the rest of the status — the cached origin/main ref can
  // still answer "behind by N" using the last successful fetch. In tag
  // mode also pull down `--tags` so newly-published releases are visible.
  let fetchError: string | undefined;
  if (opts.fetch) {
    const fetchResult = await capture("git", [...auth.args, "fetch", remote, "main"], auth.env);
    if (fetchResult.code !== 0) {
      fetchError = fetchResult.stderr || "unknown error";
    }
    if (track === "tag") {
      // Tag fetch is best-effort: a tag-fetch failure shouldn't mask a
      // successful main-fetch error message. If both fail, the main error
      // wins (it's the more actionable one).
      await capture("git", [...auth.args, "fetch", remote, "--tags"], auth.env);
    }
  }

  // Resolve the upstream ref. In tag mode that's the newest semver release
  // tag (which doubles as remoteHead so the UI's "advancing HEAD to X"
  // wording still applies); in main mode it's origin/main.
  if (track === "tag") {
    const targetTag = await findNewestReleaseTag();
    base.targetTag = targetTag;
    if (!targetTag) {
      // Without this the UI would silently say "up to date" forever.
      base.blockedReason = "No release tags found. The maintainer hasn't tagged a release yet, or your local clone is missing the tag. Run `git fetch origin --tags` and try again, or switch `updaterTrack` back to \"main\" in settings.json.";
      base.error = base.blockedReason;
      base.lastFetchAt = await getFetchTime(remote);
      return base;
    }
    base.remoteHead = await commitFor(targetTag);
  } else {
    base.remoteHead = await commitFor(`${remote}/main`);
  }
  if (base.remoteHead) {
    base.remote = { sha: base.remoteHead.shortSha, subject: base.remoteHead.subject, relative: base.remoteHead.relative ?? "" };
  }

  // Pending = commits to pull. Ahead = commits the user has that the remote
  // doesn't (unpushed local commits — rare but possible).
  if (base.remoteHead) {
    const pending = await capture("git", ["log", `HEAD..${base.remoteHead.sha}`, `--pretty=format:${PRETTY_FORMAT}`]);
    base.pendingCommits = pending.code === 0 ? parseCommitLines(pending.stdout) : [];
    const ahead = await capture("git", ["log", `${base.remoteHead.sha}..HEAD`, `--pretty=format:${PRETTY_FORMAT}`]);
    base.aheadCommits = ahead.code === 0 ? parseCommitLines(ahead.stdout) : [];
  }

  base.commitsBehind = base.pendingCommits.length;
  base.isBehind = base.commitsBehind > 0;
  base.lastFetchAt = await getFetchTime(remote);

  // Compute blockedReason in the same order Tomes does so the messages match.
  // The first matching reason wins; the UI shows whichever fired.
  if (fetchError) {
    base.blockedReason = `git fetch failed: ${fetchError}. Network down? Run 'git fetch origin' manually to see the underlying error.`;
  } else if (base.branch && base.branch !== "main") {
    base.blockedReason = `You're on branch "${base.branch}", not "main". The updater only updates the main branch.`;
  } else if (!base.clean) {
    base.blockedReason = `Working tree has ${dirtyLines.length} uncommitted change(s). Commit or stash them before updating, otherwise the pull will refuse to overwrite local edits.`;
  } else if (!base.remoteHead) {
    base.blockedReason = "Couldn't resolve origin/main. Network down, or the remote is misconfigured. Run 'git fetch origin' and try again.";
  }
  if (base.blockedReason && !base.error) base.error = base.blockedReason;

  return base;
}

export interface UpdateRun {
  code: number;
  /** Combined stdout + stderr from the update script (with [update] prefixes). */
  output: string;
}

/**
 * Runs scripts/update.mjs as a child node process. Streams output line-by-line
 * via the optional `onLine` callback so the route handler can SSE-pipe it to
 * the dashboard live. Also returns the buffered output + exit code at the
 * end so the dashboard's "view full log" still has the complete record.
 *
 * Each line is tagged with its stream of origin ("stdout" / "stderr") so the
 * UI can colour failure lines distinctly. The updater script itself prefixes
 * its lines with "[update]" already; we don't add a second prefix.
 *
 * Safe to call while the live server is handling other requests: the child
 * process runs independently and Node's stdio plumbing is non-blocking.
 */
export type UpdateLine = { stream: "stdout" | "stderr"; line: string };

export interface ApplyUpdateOpts {
  /** Wall-clock budget. Default 5 min. After this, the child is SIGTERM'd
   *  (then SIGKILL'd 5s later if still alive) and the promise resolves with
   *  code 124 (conventional Unix timeout exit code). */
  timeoutMs?: number;
  /** Override the update-script path. Production always uses the default;
   *  tests pass a tmpfile to exercise the timeout path without git side-effects. */
  scriptPath?: string;
  /** Specific ref to advance HEAD to. When set, the update script does
   *  `git reset --hard <ref>` after fetching tags + main, instead of the
   *  default `git pull --ff-only <remote> main`. Used by tag-mode updates so
   *  the maintainer's blessed tag becomes the new HEAD. */
  targetRef?: string;
  /** Which git remote to pull from. Defaults to "origin". See
   *  UpdateStatusOpts.remote for the security model. */
  remote?: string;
  /** HTTP Authorization header value, used by the dev-mode auth flow. When
   *  set, every git invocation in the child script runs with
   *  `git --config-env=http.extraheader=...` pointing at this header. The
   *  header itself travels via env var (NOT argv) so the PAT never appears
   *  in `ps aux` output. Null/undefined means "no auth", which is the right
   *  default for the public `origin` remote. */
  authHeader?: string;
}

const DEFAULT_APPLY_TIMEOUT_MS = 5 * 60 * 1000;

export function applyUpdate(onLine?: (event: UpdateLine) => void, opts: ApplyUpdateOpts = {}): Promise<UpdateRun> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_APPLY_TIMEOUT_MS;
  const scriptPath = opts.scriptPath ?? "scripts/update.mjs";

  return new Promise(resolve => {
    // node.exe resolves cleanly without a shell on every platform, so we
    // skip shell:true here and dodge DEP0190 entirely. The args array is
    // then forwarded to the child verbatim — no concatenation, no quoting.
    // targetRef + remote are passed via env vars so the script's CLI surface
    // stays empty (no shell-quoting concerns even on Windows).
    const child = spawn("node", [scriptPath], {
      cwd: ROOT,
      env: {
        ...process.env,
        ...(opts.targetRef ? { TUSKS_VAULT_UPDATE_TARGET: opts.targetRef } : {}),
        ...(opts.remote ? { TUSKS_VAULT_UPDATE_REMOTE: opts.remote } : {}),
        // Dev-mode auth header. Travels via env var so the PAT inside it
        // never reaches argv. The child script picks it up and tells git
        // about it via `--config-env=http.extraheader=...`.
        ...(opts.authHeader ? { TUSKS_VAULT_UPDATE_AUTH_HEADER: opts.authHeader } : {}),
      },
    });
    let buf = "";
    let timedOut = false;
    let settled = false;
    // Wall-clock guard: if the update script hangs (credential prompt, network
    // stall, infinite loop in a future bug), the SSE stream would otherwise
    // wedge forever and applyInFlight would never clear. SIGTERM the child;
    // if it ignores SIGTERM for 5 s, follow with SIGKILL.
    let killTimeout: NodeJS.Timeout | null = null;
    const settle = (result: UpdateRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimeout) clearTimeout(killTimeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      const msg = `[update] Wall-clock timeout (${Math.round(timeoutMs / 1000)}s) — terminating update process.`;
      onLine?.({ stream: "stderr", line: msg });
      buf += "\n" + msg;
      try { child.kill("SIGTERM"); } catch { /* already dead */ }
      killTimeout = setTimeout(() => {
        try { if (!child.killed) child.kill("SIGKILL"); } catch { /* already dead */ }
      }, 5000);
    }, timeoutMs);
    // Splits incoming chunks on newlines so partial buffer reads don't break
    // a "line" event into pieces. Carries any unterminated tail across reads.
    const makeReader = (stream: "stdout" | "stderr") => {
      let pending = "";
      return (chunk: Buffer | string) => {
        const text = chunk.toString();
        buf += text;
        pending += text;
        const parts = pending.split(/\r?\n/);
        // Last element is whatever came after the final newline (possibly empty).
        pending = parts.pop() ?? "";
        for (const line of parts) {
          if (line.length > 0) onLine?.({ stream, line });
        }
      };
    };
    const onStdout = makeReader("stdout");
    const onStderr = makeReader("stderr");
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("exit", code => settle({ code: timedOut ? 124 : (code ?? 0), output: buf }));
    child.on("error", e => {
      const msg = `[update] spawn error: ${e.message}`;
      onLine?.({ stream: "stderr", line: msg });
      settle({ code: 1, output: buf + "\n" + msg });
    });
  });
}

/**
 * Exit code the server uses to signal "the launcher should relaunch me".
 * run.bat / run.sh loop on this code and rerun npm start; any other non-zero
 * exit falls through to their existing error-handling block.
 */
export const RESTART_EXIT_CODE = 42;

/**
 * Schedules a graceful shutdown that produces RESTART_EXIT_CODE. The delay
 * lets Express flush the SSE / JSON response to the dashboard before the
 * process dies, so the user sees the confirmation. The launcher catches the
 * exit code and re-runs the server.
 */
export function scheduleRestart(delayMs: number = 800): void {
  setTimeout(() => {
    console.log(`[update] graceful restart requested. exiting with code ${RESTART_EXIT_CODE}.`);
    process.exit(RESTART_EXIT_CODE);
  }, delayMs);
}
