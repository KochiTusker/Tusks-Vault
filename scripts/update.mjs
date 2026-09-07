#!/usr/bin/env node
/**
 * Cross-platform updater for Tusk's Vault.
 *
 * Strategy:
 *   1. If the working directory is a git clone (has .git/), pull origin/main
 *      with --ff-only (refusing on conflicts rather than silently overwriting
 *      local work). Uncommitted changes to tracked files are NOT stashed:
 *      the update is refused up-front with a list of the dirty files and
 *      the three ways out. Predictable beats silent when the alternative
 *      is a stash the user never asked for.
 *   2. Only re-run npm install when package-lock.json actually changed in the
 *      pull. Skipping it when unchanged is critical: it eliminates the
 *      Windows-specific risk of npm rewriting node_modules while the live
 *      server still holds .node / .exe handles open.
 *   3. If not a git clone (user downloaded ZIP), bail with a clear message
 *      asking them to install Git or manually re-download.
 *
 * Safe to run while the server is live:
 *   - `git pull --ff-only` only updates the working tree; the running process
 *     keeps its in-memory module graph, so Node never executes half-written code.
 *   - When deps don't change (the common case), node_modules is never touched.
 *   - When deps DO change, the user is told to restart before the new deps
 *     are loaded.
 *
 * Designed to be invokable from three places without changes:
 *   - From the in-app "Apply update" button   → spawned by the Express server
 *   - From the terminal via npm script        → `npm run update`
 *   - Directly                                → `node scripts/update.mjs`
 *
 * Output is plain text, one event per line, prefixed with [update] so the UI
 * can SSE-stream it back to the user. Lines starting with [update] go to
 * stdout; failure messages start with [update] ERROR and go to stderr.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOCKFILE = path.join(ROOT, "package-lock.json");

function log(msg) { process.stdout.write(`[update] ${msg}\n`); }
function err(msg) { process.stderr.write(`[update] ERROR: ${msg}\n`); }

// shell:false everywhere. The only commands this script invokes are `git`
// (git.exe) and reads of node-resident state — never npm.cmd or other .cmd /
// .bat shims that need cmd.exe. Skipping the shell sidesteps Node 22's
// DEP0190 (spawn with shell:true + separate args array concatenates without
// escaping — a shell-injection risk for any unsanitised arg). It also matches
// the pattern already established in src/server/util/updater.ts for the
// in-process applyUpdate path.

/** Run a command, stream stdout/stderr through this process. Resolves to exit code. */
function run(cmd, args, opts = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: "inherit",
      ...opts,
    });
    child.on("exit", code => resolve(code ?? 0));
    child.on("error", e => {
      err(`failed to launch ${cmd}: ${e.message}`);
      resolve(1);
    });
  });
}

/** Run a command and capture stdout (for inspections like git rev-parse). */
function capture(cmd, args, opts = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    let out = "", code = 0;
    child.stdout.on("data", c => { out += c.toString(); });
    child.on("exit", c => { code = c ?? 0; resolve({ code, stdout: out.trim() }); });
    child.on("error", () => resolve({ code: 1, stdout: "" }));
  });
}

function hashFile(filePath) {
  if (!existsSync(filePath)) return null;
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

async function main() {
  log(`working dir: ${ROOT}`);

  const isGit = existsSync(path.join(ROOT, ".git"));
  if (!isGit) {
    err("This install isn't a git clone (no .git directory found).");
    err("");
    err("In-app updates require Git so we can pull the latest code cleanly.");
    err("");
    err("Two options:");
    err("  1. Install Git from https://git-scm.com/ — then re-clone the repo:");
    err("       git clone https://github.com/KochiTusker/Tusks-Vault.git");
    err("     Move your Lore/, api-keys.json, .env.local, etc. into the new clone.");
    err("  2. Or download the latest ZIP from GitHub and overwrite this folder,");
    err("     keeping the gitignored files in place.");
    process.exit(2);
  }

  // Verify git itself works.
  const gitCheck = await capture("git", ["--version"]);
  if (gitCheck.code !== 0) {
    err("Git is installed but `git --version` failed. Aborting.");
    process.exit(2);
  }
  log(`detected ${gitCheck.stdout}`);

  // Capture lockfile state before the pull so we can decide whether to npm-install
  // afterward. Hashing avoids relying on git diff output formatting.
  const lockHashBefore = hashFile(LOCKFILE);

  // Refuse on dirty tree — mirror Tusks-Tomes' "won't clobber uncommitted
  // edits" guarantee. Predictable beats silent: a user with debugging edits
  // gets a clear "stash or commit first" message instead of a stash they
  // didn't ask for. The HTTP route also pre-checks this via blockedReason,
  // so this is mostly belt-and-braces for the CLI path.
  const status = await capture("git", ["status", "--porcelain"]);
  const dirtyTrackedLines = status.stdout
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith("??"));
  if (dirtyTrackedLines.length > 0) {
    err(`Working tree has ${dirtyTrackedLines.length} uncommitted change(s) on tracked files.`);
    err("Refusing to update so your local edits aren't clobbered.");
    err("");
    err("Files with uncommitted changes:");
    for (const line of dirtyTrackedLines.slice(0, 10)) err(`  ${line}`);
    if (dirtyTrackedLines.length > 10) err(`  ... and ${dirtyTrackedLines.length - 10} more`);
    err("");
    err("Recover with one of:");
    err("  git stash push        # save edits, then re-run the updater");
    err("  git commit -am 'wip'  # commit edits, then re-run");
    err("  git checkout --       # discard edits (irreversible)");
    process.exit(1);
  }

  // Also check we're on main — Tomes refuses to update non-main branches
  // because the pull would target main and the user probably didn't intend
  // to drag their feature branch onto it.
  const branchRes = await capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branchRes.code === 0 && branchRes.stdout && branchRes.stdout !== "main") {
    err(`You're on branch "${branchRes.stdout}", not "main".`);
    err("The updater only updates the main branch. Switch first:");
    err("  git checkout main");
    process.exit(1);
  }

  // Capture HEAD before the pull so we can diff PRE..POST and detect deps
  // changes accurately. Mirrors Tomes' apply.sh PRE_HEAD / POST_HEAD pattern.
  const preHead = await capture("git", ["rev-parse", "HEAD"]);
  const headBefore = preHead.code === 0 ? preHead.stdout : "";

  // Remote override: the server passes TUSKS_VAULT_UPDATE_REMOTE=dev when
  // the maintainer has flipped `updaterRemote: "dev"` in the dashboard
  // (5-tap unlock on the version, then the developer-mode toggle). Default
  // is "origin", which on a normal user install is the public Tusks-Vault.
  // The security gate is GitHub auth on the private Tusks-Vault-Dev repo
  // — without a valid PAT (passed via TUSKS_VAULT_UPDATE_AUTH_HEADER), git
  // pull from "dev" just 404s.
  const remote = process.env.TUSKS_VAULT_UPDATE_REMOTE || "origin";

  // Dev-mode auth header: when set, every network-touching git invocation
  // gets `--config-env=http.extraheader=TUSKS_VAULT_UPDATE_AUTH_HEADER`
  // prepended. The header itself (with the PAT inside it) lives in the
  // env var, never in argv. The maintainer pastes the PAT in the dashboard
  // every run — it isn't persisted across server restarts.
  const authArgs = process.env.TUSKS_VAULT_UPDATE_AUTH_HEADER
    ? ["--config-env=http.extraheader=TUSKS_VAULT_UPDATE_AUTH_HEADER"]
    : [];

  // Tag mode: the server passes TUSKS_VAULT_UPDATE_TARGET=<tag> when the
  // user has opted into `updaterTrack: "tag"` in settings. We fetch tags
  // first (so a newly-published release is available locally), then
  // hard-reset main to the tag. Hard-reset is safe here because the
  // dirty-tree check above already refused to proceed with uncommitted
  // edits — the only thing we discard is whatever local main pointed at.
  const targetRef = process.env.TUSKS_VAULT_UPDATE_TARGET;
  if (targetRef) {
    log(`tag-mode update — advancing to ${targetRef} (from remote: ${remote})...`);
    const fetchTagsCode = await run("git", [...authArgs, "fetch", remote, "--tags"]);
    if (fetchTagsCode !== 0) {
      err(`git fetch ${remote} --tags failed.`);
      err(`Network may be down, or "${remote}" may not be reachable.`);
      err(`Verify with: git remote -v | grep ${remote}`);
      err("Retry, or switch updaterTrack back to \"main\" in settings.json.");
      process.exit(fetchTagsCode);
    }
    const resetCode = await run("git", ["reset", "--hard", targetRef]);
    if (resetCode !== 0) {
      err(`git reset --hard ${targetRef} failed.`);
      err(`The tag ${targetRef} may have been deleted upstream, or the local`);
      err("clone may be in a state that doesn't allow the reset. Recover with:");
      err(`  git fetch ${remote} --tags`);
      err(`  git reset --hard ${targetRef}`);
      process.exit(resetCode);
    }
  } else {
    log(`pulling ${remote}/main (fast-forward only)...`);
    // --ff-only refuses if the local branch has diverged. Safer than reset
    // --hard which discards local commits without warning. If the user's local
    // main has diverged (rare on a fresh install — usually only happens if they
    // manually committed), we tell them how to recover.
    const pullCode = await run("git", [...authArgs, "pull", "--ff-only", remote, "main"]);
    if (pullCode !== 0) {
      err("git pull --ff-only failed.");
      err("Most common causes:");
      err("  - Network unreachable (firewall, VPN, or GitHub down).");
      err(`  - The "${remote}" remote isn't configured. Run \`git remote -v\` to verify.`);
      err("  - You're authenticated as someone without access to the remote (e.g.");
      err("    flipped dev-mode without credentials for the configured `dev` upstream).");
      err("  - Your local main branch has commits the remote doesn't have.");
      err(`      git fetch ${remote} && git reset --hard ${remote}/main`);
      process.exit(pullCode);
    }
  }
  // Intentionally no stash-pop branch — refusing on dirty tree means we
  // never stashed in the first place, and the user's edits are still
  // exactly where they left them.

  // ────────────────────────────────────────────────────────────────────────
  // Policy: DO NOT run npm install in-process. Mirrors Tusks-Tomes commit
  // 2151b4b — the live dev server's Vite chokidar watcher holds file handles
  // inside node_modules, so a concurrent npm install collides on Windows
  // (EPERM / EBUSY) and risks corrupting the tree. Trying to be clever about
  // killing / restarting the server from inside itself is fragile.
  //
  // What we do instead: emit a DEPENDENCY_CHANGES_DETECTED marker when the
  // pull touches package.json / package-lock.json, and exit 0. The UI parses
  // this and shows a copy-to-clipboard banner with the exact npm install
  // command for the user to run in a clean terminal after stopping the
  // server. The server's boot-time warnIfNodeModulesStale() is the safety
  // net for users who ignore that banner.
  // ────────────────────────────────────────────────────────────────────────
  const lockHashAfter = hashFile(LOCKFILE);
  const lockChanged = lockHashBefore !== lockHashAfter;

  // Belt-and-braces: also look at the actual files git changed in the pull
  // (catches package.json edits that don't change package-lock.json on disk).
  let depsTouched = lockChanged;
  if (!depsTouched) {
    const diff = await capture("git", [
      "diff", "--name-only", `${headBefore}..HEAD`,
    ]);
    if (diff.code === 0) {
      depsTouched = /^package(-lock)?\.json$/m.test(diff.stdout);
    }
  }

  if (depsTouched) {
    err("DEPENDENCY_CHANGES_DETECTED");
    err("package.json or package-lock.json changed in this update.");
    err("The in-app updater does NOT run npm install for you when deps");
    err("change — the dev server holds file handles in node_modules and");
    err("an in-process install would collide on Windows. After this update:");
    err("");
    err("  1. Stop the server (Ctrl+C in the run.bat / run.sh window,");
    err("     or click 'Restart now' in the dashboard — the launcher loop");
    err("     handles the install automatically before relaunching).");
    err("  2. From a clean terminal in this folder:");
    err("       npm install --no-audit --no-fund");
    err("     (Windows PowerShell: cmd /c npm install --no-audit --no-fund)");
    err("  3. Restart Tusk's Vault.");
  } else {
    log("No dependency changes — npm install not required.");
  }

  // Print the new HEAD so the UI / user can confirm.
  const head = await capture("git", ["log", "-1", "--format=%h %s (%cr)"]);
  log(`now at: ${head.stdout || "(unknown HEAD)"}`);
  if (depsTouched) {
    log("done. Dependencies changed — see the manual-install instructions above.");
  } else {
    log("done. Use 'Restart now' in the dashboard to apply the changes,");
    log("or close this window and re-launch via run.bat / run.sh.");
  }
  process.exit(0);
}

main().catch(e => {
  err(e?.stack || e?.message || String(e));
  process.exit(1);
});
