#!/usr/bin/env node
/**
 * Publish a release to the `public` remote (Tusks-Vault).
 *
 * Public history is ONE parentless root, then strictly linear: the first
 * release created the root, and every release since is an ordinary child of
 * the published public/main. The isolation from dev history is permanent
 * after the root — a release commit's parent is a public commit, so no dev
 * commit is ever reachable from public — and linearity is what keeps the
 * in-app updater working: scripts/update.mjs runs `git pull --ff-only`,
 * which a re-rooted branch breaks for every install at once.
 *
 * The dev repo (`origin`) is never touched by this script. Day-to-day
 * pushes to dev use plain `git push` and keep full history.
 *
 * Usage:
 *   node scripts/release-to-public.mjs <version> ["<summary>"]
 *   node scripts/release-to-public.mjs --dry-run <version> ["<summary>"]
 *   node scripts/release-to-public.mjs --no-tag <version> ["<summary>"]
 *
 * Behavior:
 *   1. Verifies working tree is clean and you're on `main`.
 *   2. Verifies the `public` remote is configured, then fetches public/main
 *      (aborts if unreachable — descent must be verifiable before a push).
 *   3. Builds the release TREE in a temporary index: the current HEAD tree
 *      minus every path in .public-exclude. The working tree is never
 *      touched — no orphan branch, no checkout, nothing to clean up.
 *   4. Creates the release commit with `git commit-tree`, parented on the
 *      fetched public/main (or parentless for the very first release).
 *   5. Tags it (unless --no-tag) and pushes commit + tag. The push is a
 *      plain fast-forward; the pre-push hook independently verifies that
 *      and runs the full scanner suite.
 *
 * A deliberate re-root (history rewrite) requires TUSKS_ALLOW_REROOT=1 and
 * force-pushes over the published branch. Every existing install's updater
 * breaks when that happens — it is a one-way door, spend it knowingly.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readPublicExcludes } from "./lib/public-exclude.mjs";

const SOURCE_BRANCH_REQUIRED = "main";
const PUBLIC_REMOTE = "public";

// Pin the public-commit identity in code so it can't drift if local
// `git config user.*` is ever changed (e.g. after a re-clone). Same value
// is set as committer too — GitHub's UI shows both. Dates are normalised to
// UTC so release commits are reproducible regardless of where they are built.
// scripts/lib/personal-info-scanner.mjs reads these constants as the trust
// root for the commit-identity layer — keep the assignments regex-readable.
const PUBLIC_AUTHOR_NAME = "KochiTusker";
const PUBLIC_AUTHOR_EMAIL = "68705528+KochiTusker@users.noreply.github.com";

function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf-8", ...opts });
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

// ─── Parse argv ────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const noTag = argv.includes("--no-tag");
const positional = argv.filter(a => !a.startsWith("--"));
const version = positional[0];
const summary = positional[1] ?? "";
const allowReroot = process.env.TUSKS_ALLOW_REROOT === "1";

if (!version) {
  fail([
    "Usage: node scripts/release-to-public.mjs <version> [\"<summary>\"]",
    "       node scripts/release-to-public.mjs --dry-run <version>",
    "       node scripts/release-to-public.mjs --no-tag <version>",
    "",
    "Example: node scripts/release-to-public.mjs v0.2.0 \"DNS-rebinding fix\"",
  ].join("\n"));
}

if (!/^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  fail(`Version "${version}" must match v<major>.<minor>.<patch>[-prerelease], e.g. v0.2.0 or v1.0.0-rc1.`);
}

// package.json's version is what the app and the site actually report: the
// About card reads it through /api/status, and the landing page's badge is
// {{VERSION}}. Nothing here writes it — this script builds the release in a
// scratch index and never touches the working tree, which is a property worth
// keeping — so a mismatch is refused rather than patched. It went unnoticed
// for three releases: package.json said 0.1.0 while v0.1.3 was the published
// tag, so every install reported a version that had not been current since
// the first one.
const pkgVersion = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf-8")).version;
if (`v${pkgVersion}` !== version) {
  fail([
    `package.json says ${pkgVersion}, but this release is ${version}.`,
    "",
    "That number is what the dashboard's About card and the site's version",
    "badge display, so shipping them apart means every install reports the",
    "wrong version.",
    "",
    `Fix with:  npm version ${version.slice(1)} --no-git-tag-version`,
    "then commit the bump and re-run this.",
  ].join("\n"));
}

// ─── Pre-flight checks ─────────────────────────────────────────────────────

const status = git(["status", "--porcelain"]).trim();
if (status) {
  console.error("Working tree has uncommitted changes. Commit or stash first:");
  console.error(status);
  process.exit(1);
}

const sourceBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
if (sourceBranch !== SOURCE_BRANCH_REQUIRED) {
  fail([
    `You're on "${sourceBranch}", not "${SOURCE_BRANCH_REQUIRED}".`,
    `Releases must come from ${SOURCE_BRANCH_REQUIRED}. Switch first:`,
    `  git checkout ${SOURCE_BRANCH_REQUIRED}`,
  ].join("\n"));
}

const remotes = git(["remote"]).split("\n").map(r => r.trim()).filter(Boolean);
if (!remotes.includes(PUBLIC_REMOTE)) {
  fail([
    `"${PUBLIC_REMOTE}" remote isn't configured. Add it:`,
    `  git remote add ${PUBLIC_REMOTE} https://github.com/KochiTusker/Tusks-Vault.git`,
  ].join("\n"));
}

const localTags = git(["tag", "--list"]).split("\n").map(t => t.trim()).filter(Boolean);
if (!noTag && localTags.includes(version)) {
  fail([
    `Tag ${version} already exists locally. Either:`,
    `  - Delete it first:  git tag -d ${version}`,
    `  - Pick a different version`,
    `  - Run with --no-tag to skip tagging`,
  ].join("\n"));
}

// ─── Resolve the published parent ──────────────────────────────────────────
// Fetch, don't trust a stale local ref: descent is verified against what the
// remote actually serves. A failed fetch aborts — building a release whose
// parent might be wrong is exactly the mistake this script exists to prevent.
// (--dry-run falls back to the last-fetched ref with a warning, so the
// commit can still be inspected offline.)

console.log(`→ Fetching ${PUBLIC_REMOTE}/main to establish the published parent...`);
let parentSha = null;
const fetch = spawnSync("git", ["fetch", PUBLIC_REMOTE, "main"], { encoding: "utf-8" });
if (fetch.status === 0) {
  try {
    parentSha = git(["rev-parse", `refs/remotes/${PUBLIC_REMOTE}/main`]).trim();
  } catch {
    parentSha = null; // remote reachable but branch absent — first release
  }
} else {
  const remoteBranchMissing = /couldn't find remote ref/i.test(fetch.stderr ?? "");
  if (remoteBranchMissing) {
    parentSha = null; // brand-new public repo — this release creates the root
  } else if (dryRun) {
    try {
      parentSha = git(["rev-parse", `refs/remotes/${PUBLIC_REMOTE}/main`]).trim();
      console.log(`  (fetch failed; --dry-run continuing against the last-fetched ${parentSha.slice(0, 7)})`);
    } catch {
      parentSha = null;
      console.log("  (fetch failed and no local ref exists; --dry-run will build a parentless preview)");
    }
  } else {
    fail([
      `Could not fetch ${PUBLIC_REMOTE}/main:`,
      (fetch.stderr ?? "").trim(),
      "",
      "A release must be built as a child of the commit the remote actually",
      "publishes. Restore connectivity and retry.",
    ].join("\n"));
  }
}

if (parentSha && allowReroot) {
  console.log("");
  console.log(`  ⚠  TUSKS_ALLOW_REROOT=1 — building a PARENTLESS commit over the published ${parentSha.slice(0, 7)}.`);
  console.log("     Every existing install's updater will fail after this push.");
  console.log("");
  parentSha = null;
}

console.log(
  parentSha
    ? `  Parent: ${parentSha.slice(0, 7)} (published ${PUBLIC_REMOTE}/main — this release fast-forwards it)`
    : `  Parent: none (this release creates the public root)`
);

// ─── Release-gate reminder ─────────────────────────────────────────────────
// Printed only for the non-dry path. The full gate (tree audit, code
// review, dry-run inspection) is documented in CLAUDE.md → "Release-gate
// rule" and is intended to be completed BEFORE this script runs in non-dry
// mode. This banner is the last-second visible reminder for the case where
// the script is invoked directly.
if (!dryRun) {
  console.log("");
  console.log("  ────────────────────────────────────────────────────────────────");
  console.log("   Release-gate reminder — see CLAUDE.md → Release-gate rule.");
  console.log("");
  console.log("   Confirm you have completed, for the exact HEAD SHA below:");
  console.log(`     HEAD: ${git(["rev-parse", "--short", "HEAD"]).trim()}`);
  console.log("     Pass 1 — node scripts/audit-current-tree.mjs (clean)");
  console.log("     Pass 2 — code-reviewer + security-auditor subagents");
  console.log("     Pass 3 — dry-run inspection (author, date, file list)");
  console.log("");
  console.log("   If any pass is BLOCK and you haven't explicitly overridden it,");
  console.log("   Ctrl+C now.");
  console.log("  ────────────────────────────────────────────────────────────────");
  console.log("");
}

// ─── Build the release tree in a temporary index ───────────────────────────
// The working tree and the real index are never touched: read the HEAD tree
// into a scratch index, strip the dev-only paths from it, write it back out
// as a tree object. (Pre-flight already proved worktree == HEAD, so reading
// HEAD is reading exactly what the maintainer sees on disk.)

const scratchDir = mkdtempSync(path.join(tmpdir(), "vault-release-"));
const scratchIndex = path.join(scratchDir, "index");
const indexEnv = { ...process.env, GIT_INDEX_FILE: scratchIndex };

let commitSha;
try {
  git(["read-tree", "HEAD"], { env: indexEnv });

  // Strip dev-only paths from the release index. readPublicExcludes always
  // includes .public-exclude itself, so even an empty exclusion list doesn't
  // reveal on the public remote that an exclusion list exists.
  const devOnlyPaths = readPublicExcludes(process.cwd());
  console.log(`\n→ Excluding ${devOnlyPaths.length} dev-only path(s) from the release commit...`);
  for (const p of devOnlyPaths) {
    // --cached         : index-only (belt and braces — the scratch index)
    // --ignore-unmatch : silently skip paths that aren't tracked
    // -r               : handle directory entries
    // --               : end-of-options guard for paths beginning with `-`
    spawnSync("git", ["rm", "--cached", "--ignore-unmatch", "-r", "-q", "--", p], {
      env: indexEnv,
      stdio: "inherit",
    });
  }

  // Drop npm scripts that invoke a path this release just stripped. Left in
  // place they are entries that ENOENT on every public clone, and the docs
  // that cite them (`npm run site:build`) become false the moment they ship.
  // Rewritten in the SCRATCH INDEX only — the working tree is never touched,
  // and the maintainer keeps every script on `origin`.
  const pkg = JSON.parse(git(["cat-file", "-p", "HEAD:package.json"]));
  const strippedPrefixes = devOnlyPaths.map(p => p.replace(/\/+$/, ""));
  const deadScripts = Object.keys(pkg.scripts ?? {}).filter(name =>
    strippedPrefixes.some(prefix => String(pkg.scripts[name]).includes(prefix)),
  );
  if (deadScripts.length > 0) {
    for (const name of deadScripts) delete pkg.scripts[name];
    const blobSha = git(["hash-object", "-w", "--stdin"], {
      input: JSON.stringify(pkg, null, 2) + "\n",
      env: indexEnv,
    }).trim();
    git(["update-index", "--cacheinfo", `100644,${blobSha},package.json`], {
      env: indexEnv,
    });
    // The match above is a substring test on the whole command string, so a
    // future .public-exclude entry that is short or common ("scripts/",
    // "src/") would silently delete the scripts CI runs — reintroducing a red
    // public build through a different door. Fail loudly instead.
    const REQUIRED_SCRIPTS = ["lint", "test", "verify", "build", "start", "dev"];
    const lost = REQUIRED_SCRIPTS.filter(n => !(n in (pkg.scripts ?? {})));
    if (lost.length > 0) {
      fail(
        `Refusing to release: dropping dev-only npm scripts also removed ${lost.join(", ")}, ` +
          `which the published package.json and CI need. Narrow the .public-exclude entry.`,
      );
    }
    console.log(
      `→ Dropping ${deadScripts.length} npm script(s) that call stripped paths: ${deadScripts.join(", ")}`,
    );
  }

  const treeSha = git(["write-tree"], { env: indexEnv }).trim();

  // Verify the stripping actually happened before any object becomes
  // reachable from a ref: the release tree must not contain a single
  // excluded path. Counting here is what turns "eyeball the dry-run"
  // into an assertion.
  const treeFiles = git(["ls-tree", "-r", "--name-only", treeSha])
    .split("\n")
    .filter(Boolean);
  const leaked = treeFiles.filter(f =>
    devOnlyPaths.some(e => f === e || f.startsWith(e + "/"))
  );
  if (leaked.length > 0) {
    fail(
      [`Release tree still contains ${leaked.length} dev-only path(s):`, ...leaked.map(f => `  ${f}`)].join("\n")
    );
  }

  // ISO-8601 in UTC for both author and committer dates. Format Git expects
  // is "YYYY-MM-DDTHH:MM:SS +0000" (with explicit space + offset).
  const releaseDate = new Date().toISOString().replace(/\.\d{3}Z$/, " +0000");
  const releaseEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: PUBLIC_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: PUBLIC_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: PUBLIC_AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: PUBLIC_AUTHOR_EMAIL,
    GIT_AUTHOR_DATE: releaseDate,
    GIT_COMMITTER_DATE: releaseDate,
  };

  // spawnSync + arg array so no shell ever interprets the message. Passing
  // it through a shell previously turned the subject/body separator into
  // literal `\n\n` characters, because neither bash nor cmd.exe expands
  // backslash escapes inside double quotes. Two -m flags is git's
  // documented "subject, blank line, body"; commit-tree takes the same.
  console.log(`\n→ Committing release ${version}${parentSha ? ` (child of ${parentSha.slice(0, 7)})` : " (root)"}...`);
  const subject = `Release ${version}`;
  const commitTreeArgv = ["commit-tree", treeSha];
  if (parentSha) commitTreeArgv.push("-p", parentSha);
  commitTreeArgv.push("-m", subject);
  if (summary) commitTreeArgv.push("-m", summary);
  const commitResult = spawnSync("git", commitTreeArgv, { encoding: "utf-8", env: releaseEnv });
  if (commitResult.status !== 0) {
    fail(`git commit-tree failed:\n${commitResult.stderr}`);
  }
  commitSha = commitResult.stdout.trim();
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
}

if (!noTag) {
  console.log(`\n→ Tagging ${commitSha.slice(0, 7)} as ${version}...`);
  const tagArgv = summary
    ? ["tag", "-a", version, commitSha, "-m", version, "-m", summary]
    : ["tag", "-a", version, commitSha, "-m", version];
  const releaseDateEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: PUBLIC_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: PUBLIC_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: PUBLIC_AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: PUBLIC_AUTHOR_EMAIL,
    GIT_AUTHOR_DATE: git(["show", "-s", "--format=%aD", commitSha]).trim(),
    GIT_COMMITTER_DATE: git(["show", "-s", "--format=%cD", commitSha]).trim(),
  };
  const tagResult = spawnSync("git", tagArgv, { stdio: "inherit", env: releaseDateEnv });
  if (tagResult.status !== 0) process.exit(tagResult.status ?? 1);
}

console.log(`\n→ Release commit: ${commitSha}`);
console.log(git(["log", "-1", "--stat", "--format=fuller", commitSha]));

if (dryRun) {
  console.log(`──────────────────────────────────────────────────────────────`);
  console.log(`--dry-run: stopping before the push. Nothing was checked out,`);
  console.log(`no branch was created, and the working tree was never touched.`);
  console.log(``);
  console.log(`Inspect further:  git show --stat ${commitSha.slice(0, 12)}`);
  console.log(`Push manually:    git push ${PUBLIC_REMOTE} ${commitSha}:refs/heads/main${noTag ? "" : ` && git push ${PUBLIC_REMOTE} ${version}`}`);
  if (!noTag) console.log(`Discard the tag:  git tag -d ${version}`);
  console.log(`(The commit object itself is unreferenced${noTag ? "" : " once the tag is deleted"} and will be garbage-collected.)`);
  process.exit(0);
}

console.log(`→ Pushing ${commitSha.slice(0, 7)} → ${PUBLIC_REMOTE}/main${parentSha ? "" : " (creating root)"}...`);
console.log(`  (the pre-push hook runs the full scanner suite + fast-forward guard)`);
const pushArgs = ["push", PUBLIC_REMOTE, `${commitSha}:refs/heads/main`];
if (allowReroot) pushArgs.push("--force");
const push = spawnSync("git", pushArgs, { stdio: "inherit" });
if (push.status !== 0) process.exit(push.status ?? 1);

if (!noTag) {
  console.log(`\n→ Pushing tag ${version} to ${PUBLIC_REMOTE}...`);
  const tagPush = spawnSync("git", ["push", PUBLIC_REMOTE, version], { stdio: "inherit" });
  if (tagPush.status !== 0) process.exit(tagPush.status ?? 1);
}

console.log(`\n──────────────────────────────────────────────────────────────`);
console.log(`✓ Release ${version} published to ${PUBLIC_REMOTE}.`);
console.log(
  parentSha
    ? `  Public main:    fast-forwarded to ${commitSha.slice(0, 7)}`
    : `  Public main:    rooted at ${commitSha.slice(0, 7)}`
);
if (!noTag) console.log(`  Public tag:     ${version}`);
console.log(`  Dev (${sourceBranch}):   untouched`);
