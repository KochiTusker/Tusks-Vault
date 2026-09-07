// Self-updater card for the Settings tab. Mirrors Tusks-Tomes' UpdaterCard
// layout one-to-one so users on both projects find the same surface:
//
//   1. Identity grid    — Branch / Current / origin/main / Last fetch.
//   2. Blocked state    — when blockedReason is set (ZIP install, off-main,
//                          dirty tree, fetch failed). Apply button hidden,
//                          dirty files listed.
//   3. Up-to-date state — green "you're on the latest" indicator.
//   4. Update-ready     — pending commits listed (sha, subject, author);
//                          Apply button enabled.
//
// Vault-specific additions on top of Tomes:
//   - SSE streaming of the apply log line-by-line.
//   - "Restart now" button after a successful apply that triggers the
//     server's exit-42 → launcher-relaunch loop, so users complete the
//     update without ever opening a terminal.
//
// Error reporting follows Tomes' three-tier pattern:
//   - classifyOutput()  — matches common script-error patterns and shows
//                          a "Likely cause + Fix" panel above the raw log.
//   - outputTail()      — last 3 non-empty lines always visible on failure.
//   - Full output       — collapsible, auto-expanded when ok === false.

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  GitBranch,
  PackageOpen,
  Power,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { FlameLoader } from "./FlameLoader";

interface UpdaterCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  relative?: string;
}

interface CompactCommit {
  sha: string;
  subject: string;
  relative: string;
}

interface UpdateStatus {
  isGitInstall: boolean;
  gitAvailable: boolean;
  installedViaGit: boolean;
  branch: string | null;
  clean: boolean;
  dirtyFiles?: string[];
  head?: UpdaterCommit;
  remoteHead?: UpdaterCommit;
  pendingCommits: UpdaterCommit[];
  aheadCommits: UpdaterCommit[];
  lastFetchAt?: string;
  blockedReason?: string;
  local: CompactCommit | null;
  remote: CompactCommit | null;
  commitsBehind: number | null;
  isBehind: boolean;
  error: string | null;
  // True iff node_modules/.package-lock.json is older than package-lock.json.
  // Rendered as a persistent red banner — survives across UI reloads until
  // the user actually runs `npm install`, which updates the inner lock's mtime
  // and silently clears the banner on the next /check.
  nodeModulesStale?: boolean;
  // Which upstream the updater is pointed at right now. "origin" is the
  // normal public-repo path; "dev" is the maintainer's preview remote.
  // Surfaced by the server from settings.updaterRemote. Named `remoteName`
  // to avoid colliding with the legacy `remote: CompactCommit` field above
  // (which is the remote HEAD's commit summary, not the remote identifier).
  remoteName?: string;
}

interface ApplyResult {
  ok: boolean;
  applied: boolean;
  alreadyUpToDate: boolean;
  // True when the pull touched package.json / package-lock.json. Server
  // computes this from `git diff --name-only PRE..POST`; the UI uses it to
  // fire the in-the-moment "manual install required" banner.
  depsChanged?: boolean;
  exitCode: number;
  message: string;
  before: UpdateStatus;
  after: UpdateStatus;
  restartRequired: boolean;
}

type LogLine = { stream: "stdout" | "stderr"; line: string };

function formatRelative(iso: string | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Recognise common update-script failures and surface a copy-pasteable fix
// above the raw log. Mirrors Tomes' classifyOutput so users on both projects
// see the same advice for the same error. Patterns are deliberately loose —
// we match on lowercased substrings, not exact strings, to catch wording
// variations across git / npm / shell versions.
function classifyOutput(output: string): { hint: string; fix: string } | null {
  const t = output.toLowerCase();
  if (t.includes("running scripts is disabled") || t.includes("executionpolicy")) {
    return {
      hint: "PowerShell ExecutionPolicy is blocking npm.ps1.",
      fix:
        "Run once in PowerShell:  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned\n" +
        "(or manually:  cmd /c \"git pull --ff-only origin main && npm install --no-audit --no-fund\")",
    };
  }
  if (t.includes("uncommitted change") || t.includes("refusing to update")) {
    return {
      hint: "Working tree has uncommitted edits the updater refuses to clobber.",
      fix:
        "Stash or commit them, then retry:\n" +
        "  git stash push        # save edits\n" +
        "  git commit -am 'wip'  # or commit them\n" +
        "  git checkout --       # or discard (irreversible)",
    };
  }
  if (t.includes("eacces") || t.includes("permission denied")) {
    return {
      hint: "A file in node_modules is owned by the wrong user.",
      fix:
        "POSIX:    sudo chown -R $USER:$(id -gn) node_modules\n" +
        "Windows:  close VS Code, pause OneDrive sync, then retry.",
    };
  }
  if (t.includes("eperm") || t.includes("ebusy")) {
    return {
      hint: "A file in node_modules is locked by another process.",
      fix:
        "Close VS Code and any other editors, pause OneDrive sync,\n" +
        "temporarily disable real-time antivirus scanning, then retry.",
    };
  }
  if (t.includes("non-fast-forward") || t.includes("would be overwritten")) {
    return {
      hint: "Your local main has diverged from origin/main.",
      fix:
        "Manually:\n" +
        "  git status\n" +
        "  git stash         # if there are local edits\n" +
        "  git pull --ff-only origin main\n" +
        "  git stash pop     # if you stashed",
    };
  }
  return null;
}

// Last N non-empty lines of output. Used as an always-visible preview so
// the actual failure cause is on-screen without the user expanding the log.
function outputTail(lines: LogLine[], n = 3): string {
  return lines
    .map(l => l.line.trimEnd())
    .filter(l => l.length > 0)
    .slice(-n)
    .join("\n");
}

// Platform-aware command strings for the npm-install banners. Mirrors Tomes'
// NPM_INSTALL_POSIX / NPM_INSTALL_WIN — Windows users get `cmd /c` because
// PowerShell's ExecutionPolicy can block npm.ps1 in some setups, and `cmd /c`
// dodges that by routing through cmd.exe's shim which respects PATHEXT.
const NPM_INSTALL_POSIX = "npm install --no-audit --no-fund";
const NPM_INSTALL_WIN = "cmd /c npm install --no-audit --no-fund";

function isWindowsUA(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Windows|Win32|Win64/i.test(navigator.userAgent);
}

function npmInstallCmd(): string {
  return isWindowsUA() ? NPM_INSTALL_WIN : NPM_INSTALL_POSIX;
}

interface UpdatesCardProps {
  /** True when the user has unlocked developer mode (5 taps on the
   *  PublisherMark in the header). Reveals the "Switch updater source"
   *  toggle between the default `origin` remote and a `dev` remote the
   *  user has separately configured. */
  devModeUnlocked?: boolean;
}

export function UpdatesCard({ devModeUnlocked = false }: UpdatesCardProps = {}) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [showOutput, setShowOutput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  // Set when the most recent apply pulled commits that touched package.json /
  // package-lock.json. Drives the in-the-moment amber banner that lives only
  // until the next /check refresh — at which point status.nodeModulesStale
  // takes over as the persistent red banner across UI reloads.
  const [depsChangedLocal, setDepsChangedLocal] = useState(false);
  // Tracks which copy button was last clicked (for the "Copied!" pill).
  // null = idle; the string is "stale" or "deps" depending on which banner
  // owns the active confirmation.
  const [copied, setCopied] = useState<"stale" | "deps" | null>(null);
  // In-flight indicator for the dev-mode remote switch — disables the
  // toggle buttons while POST /api/settings is round-tripping.
  const [switching, setSwitching] = useState(false);
  // Dev-mode auth state — populated from GET /api/updater/dev-credential
  // on mount and after every authenticate / clear / switchRemote call.
  // The token itself NEVER reaches this client; the server only confirms
  // whether one is held in memory for this session.
  const [devCredPresent, setDevCredPresent] = useState(false);
  const [devCredSetAt, setDevCredSetAt] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [authenticating, setAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);

  // Pull the current dev-credential state from the server. Used on mount
  // and after authenticate/clear/switchRemote so the UI stays in sync.
  // The endpoint only returns { present, setAt } — the token never crosses
  // the wire in the response.
  const refreshDevCred = async () => {
    try {
      const res = await fetch("/api/updater/dev-credential");
      if (!res.ok) return;
      const data = await res.json();
      setDevCredPresent(!!data.present);
      setDevCredSetAt(data.setAt ?? null);
    } catch {
      // Non-fatal — UI will fall back to the "Authenticate" prompt.
    }
  };

  // Submit a PAT to the server. The server validates the format, calls
  // GitHub to verify read-access to Tusks-Vault-Dev, and only then stores
  // the token in process memory. The token is wiped on server restart.
  const submitToken = async () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    setAuthenticating(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const res = await fetch("/api/updater/dev-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setAuthError(data.reason || `HTTP ${res.status}`);
        return;
      }
      setAuthSuccess(data.reason || "Authenticated.");
      setTokenInput("");
      await refreshDevCred();
      await refresh(true);
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setAuthenticating(false);
    }
  };

  // Wipe the in-memory PAT. Server-side: mirrors a restart but without
  // restarting. Used to "log out of dev mode" mid-session.
  const clearToken = async () => {
    setAuthError(null);
    setAuthSuccess(null);
    try {
      await fetch("/api/updater/dev-credential", { method: "DELETE" });
    } catch {
      // Server may have already wiped the token (restart); refresh state.
    }
    await refreshDevCred();
    await refresh(true);
  };

  // Flip the persisted `updaterRemote` setting on the server and re-fetch
  // status so the UI reflects the new remote immediately. This is UX only;
  // the security gate is GitHub auth — anyone without dev-repo credentials
  // sees a 404 on the next apply, never any dev code.
  const switchRemote = async (target: "origin" | "dev") => {
    setSwitching(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updaterRemote: target }),
      });
      if (!res.ok) {
        setError(`Couldn't switch remote: HTTP ${res.status}`);
        return;
      }
      await refresh(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSwitching(false);
    }
  };

  const copyNpmCmd = async (source: "stale" | "deps") => {
    try {
      await navigator.clipboard.writeText(npmInstallCmd());
      setCopied(source);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Older browsers / non-secure contexts may refuse. Fall back to a
      // selection nudge — same as Tomes' "Copy failed" toast in spirit.
      setError("Copy failed — select the command above and copy manually.");
    }
  };

  const refresh = async (withFetch = false) => {
    if (withFetch) setChecking(true); else setLoading(true);
    setError(null);
    try {
      const url = withFetch ? "/api/updates/check?fetch=1" : "/api/updates/check";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setStatus(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setChecking(false);
    }
  };

  // Lightweight check on mount — no network fetch, just the cached state.
  // The user clicks "Check for updates" to force a fresh `git fetch`.
  // Also pulls the dev-credential status so the UI knows whether to show
  // the "Authenticate" prompt or the "Authenticated this session" state.
  useEffect(() => {
    void refresh(false);
    void refreshDevCred();
  }, []);

  const apply = async () => {
    if (!status) return;
    const count = status.pendingCommits.length;
    if (!confirm(
      `Apply ${count} update${count === 1 ? "" : "s"}? This runs git pull on disk.\n\n` +
      "• Local edits to tracked files are NOT touched — the updater refuses on a dirty tree.\n" +
      "• Your lore, API keys, Discord token, and other gitignored files are untouched.\n" +
      "• npm install only runs if package-lock.json actually changed.\n\n" +
      "The current server keeps running on the OLD code until you click Restart."
    )) return;

    setApplying(true);
    setResult(null);
    setLogLines([]);
    setShowOutput(true);
    setError(null);

    try {
      // Echo the remote HEAD SHA the user just saw, so a stale tab (status
      // older than upstream) is forced to refetch before applying. The server
      // rejects with 400 if confirmSha doesn't match remoteHead.sha.
      const res = await fetch("/api/updates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmSha: status.remoteHead?.sha ?? null }),
      });

      // Refusal path: server returned a JSON refusal (409, 400, 500) instead
      // of opening the SSE stream. Parse the body as JSON and surface as an
      // error rather than an empty log.
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        const data = await res.json().catch(() => ({}));
        if (data.alreadyUpToDate) {
          setResult(data);
          setShowOutput(false);
          return;
        }
        setError(data.error || `HTTP ${res.status}`);
        return;
      }

      if (!res.body) {
        setError("No SSE stream from /api/updates/apply.");
        return;
      }

      // SSE parser: events arrive as `event: <name>\ndata: <json>\n\n` blocks.
      // Buffer partial events between read chunks so a chunk boundary in the
      // middle of an event doesn't drop data.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const eventLine = evt.split("\n").find(l => l.startsWith("event:"))?.slice(6).trim();
          const dataLine = evt.split("\n").find(l => l.startsWith("data:"))?.slice(5).trim();
          if (!dataLine) continue;
          let payload: any;
          try { payload = JSON.parse(dataLine); } catch { continue; }
          if (eventLine === "line" && payload.line) {
            setLogLines(prev => [...prev, { stream: payload.stream || "stdout", line: payload.line }]);
          } else if (eventLine === "done") {
            const next: ApplyResult = {
              ok: !!payload.ok,
              applied: !!payload.applied,
              alreadyUpToDate: !!payload.alreadyUpToDate,
              depsChanged: !!payload.depsChanged,
              exitCode: payload.exitCode ?? 0,
              message: payload.message ?? "",
              before: payload.before ?? (status as UpdateStatus),
              after: payload.after ?? (status as UpdateStatus),
              restartRequired: !!payload.restartRequired,
            };
            setResult(next);
            if (next.after) setStatus(next.after);
            // Fire the in-the-moment deps-changed banner. The persistent
            // staleness banner (driven by status.nodeModulesStale) will
            // also appear on the next /check refresh — until then this
            // amber banner is the user's signal that they have manual work
            // to do before restarting.
            setDepsChangedLocal(next.depsChanged === true);
            // Auto-expand the full log when the apply failed so the user
            // sees the real cause without clicking "Full script output".
            setShowOutput(!next.ok);
            if (!next.ok) setError(next.message);
          } else if (eventLine === "error" && payload.error) {
            setLogLines(prev => [...prev, { stream: "stderr", line: `[update] ${payload.error}` }]);
            setError(payload.error);
          }
        }
      }
    } catch (err) {
      setError(`Network error: ${(err as Error).message}`);
    } finally {
      setApplying(false);
    }
  };

  // Trigger the graceful-restart endpoint. The server exits with code 42; the
  // launcher loop catches it and relaunches. We poll /api/status afterwards
  // to detect when the new server is up.
  const restartNow = async () => {
    if (!confirm("Restart Tusk's Vault to load the updated code?\n\nThe Discord bot will be offline for ~5–15 seconds.")) return;
    setRestarting(true);
    try {
      const res = await fetch("/api/updates/restart", { method: "POST" });
      if (!res.ok) {
        setError(`Restart request failed: HTTP ${res.status}`);
        return;
      }
      setReconnecting(true);
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1500));
        try {
          const probe = await fetch("/api/status", { cache: "no-store" });
          if (probe.ok) {
            await refresh(false);
            setReconnecting(false);
            setRestarting(false);
            setLogLines(prev => [...prev, { stream: "stdout", line: "[update] server is back online" }]);
            return;
          }
        } catch { /* expected while server is between exit-42 and re-launch */ }
      }
      setReconnecting(false);
      setError("Server didn't come back in 30s. If you launched via run.bat / run.sh, check that window for errors.");
    } catch (err) {
      setError(`Restart error: ${(err as Error).message}`);
    } finally {
      setRestarting(false);
    }
  };

  const pending = status?.pendingCommits.length ?? 0;
  const isBlocked = !!status?.blockedReason && !applying;
  const canApply = !!status?.installedViaGit && !isBlocked && pending > 0 && !applying;
  const classification = result && !result.ok ? classifyOutput(logLines.map(l => l.line).join("\n")) : null;

  return (
    <section className="relative bg-ink-800/30 border border-gold-400/20 rounded-2xl p-6 parchment">
      <div className="flex items-start gap-4 mb-4">
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-verdigris-400/20 flex items-center justify-center text-verdigris-400">
          <Download size={20} />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-xl text-gold-200 mb-0.5">Updates</h3>
          <p className="font-serif text-parchment-100/60 text-sm italic">
            Pull the latest <code className="font-mono not-italic">main</code> from GitHub. Runs <code className="font-mono not-italic">git pull</code> on disk and refuses to clobber uncommitted edits. When the pulled commits touch <code className="font-mono not-italic">package.json</code>, the updater surfaces a copy-pasteable <code className="font-mono not-italic">npm install</code> command — it never runs <code className="font-mono not-italic">npm install</code> in-process because the live server holds file handles in <code className="font-mono not-italic">node_modules</code>.
          </p>
        </div>
        <button
          onClick={() => refresh(true)}
          disabled={loading || checking || applying || restarting}
          className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-ink-800/60 border border-gold-400/20 hover:border-gold-400/50 disabled:opacity-50 rounded-lg text-xs font-bold text-gold-200 transition-all"
          title="Run git fetch and re-check"
        >
          {checking ? <FlameLoader size={12} /> : <RefreshCw size={12} />}
          {checking ? "Checking…" : "Check for updates"}
        </button>
      </div>

      <div className="space-y-3 text-sm">
        {/* Persistent staleness banner — set by the server when
            node_modules/.package-lock.json is older than package-lock.json.
            Survives across UI reloads; clears automatically the next time
            /check sees a fresh node_modules. Mirrors Tomes' destructive-red
            banner with copy-to-clipboard so users can't miss the manual
            install step after pulling new dependency versions. */}
        {status?.nodeModulesStale && (
          <div className="rounded-md border border-red-500/50 bg-red-500/[0.08] p-3 text-xs space-y-2">
            <div className="flex items-start gap-2 font-bold text-red-200">
              <PackageOpen size={14} className="mt-0.5 flex-shrink-0" />
              <span>node_modules is out of date with package-lock.json</span>
            </div>
            <p className="text-parchment-100/70 leading-relaxed">
              A previous update pulled new dependency versions but{' '}
              <code className="font-mono">npm install</code> hasn't run since.
              Tusk's Vault may fail to import new packages until you refresh
              dependencies. Stop this server, run the command below, then
              re-launch via run.bat / run.sh.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-sm bg-ink-950/60 px-2 py-1 font-mono text-[11px] text-parchment-100/90">
                {npmInstallCmd()}
              </code>
              <button
                onClick={() => copyNpmCmd("stale")}
                className="flex items-center gap-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-[11px] font-bold text-white/80 transition-colors"
              >
                {copied === "stale"
                  ? <><CheckCircle2 size={12} className="text-green-400" /> Copied!</>
                  : <><Copy size={12} /> Copy</>}
              </button>
            </div>
          </div>
        )}

        {/* In-the-moment deps-changed banner — fires immediately after a
            successful apply whose pulled commits touched the dep manifest.
            The staleness banner above shows the same command persistently
            on subsequent visits; this one gives the post-apply cue while
            the user is still looking at the result of their click. */}
        {depsChangedLocal && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/[0.08] p-3 text-xs space-y-2">
            <div className="flex items-start gap-2 font-bold text-amber-200">
              <PackageOpen size={14} className="mt-0.5 flex-shrink-0" />
              <span>Update pulled — dependencies changed, manual install required</span>
            </div>
            <p className="text-parchment-100/70 leading-relaxed">
              The in-app updater doesn't run <code className="font-mono">npm install</code>{' '}
              for you when deps change because the running server holds file
              handles in <code className="font-mono">node_modules</code> (Vite's
              chokidar watcher) — an in-process install would collide on Windows.
              Stop this server, run the command below, then re-launch.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-sm bg-ink-950/60 px-2 py-1 font-mono text-[11px] text-parchment-100/90">
                {npmInstallCmd()}
              </code>
              <button
                onClick={() => copyNpmCmd("deps")}
                className="flex items-center gap-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-[11px] font-bold text-white/80 transition-colors"
              >
                {copied === "deps"
                  ? <><CheckCircle2 size={12} className="text-green-400" /> Copied!</>
                  : <><Copy size={12} /> Copy</>}
              </button>
            </div>
          </div>
        )}

        {/* Dev-mode active banner — visible whenever the updater is
            pointed at the dev remote, regardless of whether the unlock
            is current. A user who flipped in a previous session sees this
            on next load and can switch back without re-unlocking. */}
        {status?.remoteName === "dev" && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/[0.08] p-3 text-xs space-y-2">
            <div className="flex items-start gap-2 font-bold text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>Developer mode — updater is pulling from <code className="font-mono not-italic">Tusks-Vault-Dev</code></span>
            </div>
            <p className="text-parchment-100/70 leading-relaxed">
              The updater is fetching from the private <code className="font-mono not-italic">Tusks-Vault-Dev</code> repo
              instead of the public <code className="font-mono not-italic">Tusks-Vault</code>. Access requires a GitHub Personal Access
              Token with read permission on the dev repo — pasted into this dashboard
              for the current session only. Without one, every git fetch 404s. To
              return to the public repo, click below.
            </p>
            <button
              onClick={() => switchRemote("origin")}
              disabled={switching}
              className="flex items-center gap-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-50 rounded-md text-[11px] font-bold text-white/80 transition-colors"
            >
              {switching ? <FlameLoader size={12} /> : <Power size={12} />}
              Switch back to public (origin)
            </button>
          </div>
        )}

        {/* Dev-mode PAT entry — visible whenever the updater is pointed
            at the dev remote AND no in-memory token is set. The token
            never reaches disk; the server holds it in process memory and
            wipes it on restart. The maintainer re-pastes every session. */}
        {status?.remoteName === "dev" && !devCredPresent && (
          <div className="rounded-md border border-amber-500/60 bg-amber-500/[0.10] p-3 text-xs space-y-2">
            <div className="flex items-start gap-2 font-bold text-amber-200">
              <Power size={14} className="mt-0.5 flex-shrink-0" />
              <span>Authentication required to pull from <code className="font-mono not-italic">Tusks-Vault-Dev</code></span>
            </div>
            <p className="text-parchment-100/70 leading-relaxed">
              Paste a GitHub Personal Access Token with read access to the dev
              repo. The server verifies it against GitHub before storing, holds
              it in memory only, and wipes it on restart — you'll re-enter the
              token every session. Without one, every git fetch from the dev
              remote returns 404.
            </p>
            <form
              onSubmit={(e) => { e.preventDefault(); void submitToken(); }}
              className="flex flex-col sm:flex-row gap-2"
            >
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="ghp_… or github_pat_…"
                autoComplete="off"
                spellCheck={false}
                disabled={authenticating}
                className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-400/60 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={authenticating || !tokenInput.trim()}
                className="flex items-center justify-center gap-1 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-ink-950 disabled:opacity-40 rounded-lg text-xs font-bold transition-colors"
              >
                {authenticating ? <FlameLoader size={12} /> : <CheckCircle2 size={12} />}
                {authenticating ? "Verifying…" : "Authenticate"}
              </button>
            </form>
            {authError && (
              <p className="text-[11px] text-red-300/90 leading-snug">{authError}</p>
            )}
          </div>
        )}

        {/* Authenticated state — shown when a token is in memory for the
            current session. Includes a Clear button so the maintainer can
            "log out" without restarting. */}
        {status?.remoteName === "dev" && devCredPresent && (
          <div className="rounded-md border border-green-500/40 bg-green-500/[0.06] p-3 text-xs space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 font-bold text-green-300">
                <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" />
                <span>
                  Authenticated this session
                  {devCredSetAt && (
                    <span className="ml-2 text-[10px] text-white/40 font-normal">
                      (set at {new Date(devCredSetAt).toLocaleTimeString()})
                    </span>
                  )}
                </span>
              </div>
              <button
                onClick={() => void clearToken()}
                className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-[10px] font-bold text-white/70 transition-colors"
                title="Wipe the in-memory token (mirrors what a server restart does)"
              >
                Clear token
              </button>
            </div>
            {authSuccess && (
              <p className="text-[11px] text-green-200/80 leading-snug">{authSuccess}</p>
            )}
            <p className="text-[10px] text-white/50 leading-relaxed">
              Token is held in process memory only, never written to disk. It
              will be wiped on the next server restart.
            </p>
          </div>
        )}

        {/* Hidden dev-mode toggle — only rendered after the 5-tap unlock
            on the PublisherMark in the header. The toggle is UX, not
            security: a user without dev-repo credentials clicking "Switch
            to dev" gets a 404 on the next apply. */}
        {devModeUnlocked && (
          <div className="rounded-md border border-verdigris-400/40 bg-verdigris-400/[0.06] p-3 text-xs space-y-2">
            <div className="flex items-start gap-2 font-bold text-verdigris-200">
              <Terminal size={14} className="mt-0.5 flex-shrink-0" />
              <span>Developer mode unlocked</span>
            </div>
            <p className="text-parchment-100/70 leading-relaxed">
              Choose which remote the updater pulls from. <code className="font-mono not-italic">dev</code> requires a
              GitHub Personal Access Token with read access to <code className="font-mono not-italic">Tusks-Vault-Dev</code> —
              pasted below for this session only (never written to disk; wiped on
              server restart). Anyone else who flips this toggle sees a 404 from
              git on their next apply.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => switchRemote("origin")}
                disabled={switching || status?.remoteName === "origin"}
                className={`flex items-center gap-1 px-3 py-1.5 border rounded-md text-[11px] font-bold transition-colors ${
                  status?.remoteName === "origin"
                    ? "border-green-400/40 bg-green-500/10 text-green-300"
                    : "border-white/10 bg-white/5 hover:bg-white/10 text-white/80 disabled:opacity-50"
                }`}
              >
                {status?.remoteName === "origin" ? <CheckCircle2 size={12} /> : <Power size={12} />}
                {status?.remoteName === "origin" ? "Public (origin)" : "Switch to public"}
              </button>
              <button
                onClick={() => switchRemote("dev")}
                disabled={switching || status?.remoteName === "dev"}
                className={`flex items-center gap-1 px-3 py-1.5 border rounded-md text-[11px] font-bold transition-colors ${
                  status?.remoteName === "dev"
                    ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
                    : "border-white/10 bg-white/5 hover:bg-white/10 text-white/80 disabled:opacity-50"
                }`}
              >
                {status?.remoteName === "dev" ? <CheckCircle2 size={12} /> : <GitBranch size={12} />}
                {status?.remoteName === "dev" ? "Dev (Tusks-Vault-Dev)" : "Switch to dev"}
              </button>
            </div>
          </div>
        )}

        {/* Loading + transport error */}
        {loading && !status && (
          <p className="text-xs text-parchment-100/50">Reading current install status…</p>
        )}
        {error && !applying && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/[0.06] p-3 text-xs">
            <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
            <span className="text-red-200/90">{error}</span>
          </div>
        )}

        {status && (
          <>
            {/* Identity grid — branch, commit, last fetch */}
            <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
              <span className="font-medium text-parchment-100/60 flex items-center gap-1.5">
                <GitBranch size={12} />
                Branch
              </span>
              <span className="text-parchment-100/90">
                {status.branch ?? <em>(detached)</em>}
                {!status.installedViaGit && (
                  <em className="ml-2 text-parchment-100/50">ZIP install — updater disabled</em>
                )}
              </span>
              {status.head && (
                <>
                  <span className="font-medium text-parchment-100/60">Current</span>
                  <span className="break-all text-parchment-100/90">
                    <code className="font-mono">{status.head.shortSha}</code> — {status.head.subject}
                  </span>
                </>
              )}
              {status.remoteHead && (
                <>
                  <span className="font-medium text-parchment-100/60">origin/main</span>
                  <span className="break-all text-parchment-100/90">
                    <code className="font-mono">{status.remoteHead.shortSha}</code> — {status.remoteHead.subject}
                  </span>
                </>
              )}
              <span className="font-medium text-parchment-100/60">Last fetch</span>
              <span className="text-parchment-100/90">{formatRelative(status.lastFetchAt)}</span>
            </div>

            {/* Blocked state */}
            {isBlocked && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3 text-xs">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-400" />
                <div className="space-y-1">
                  <p className="font-bold text-amber-200">Update blocked</p>
                  <p className="text-parchment-100/70">{status.blockedReason}</p>
                  {status.dirtyFiles && status.dirtyFiles.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-parchment-100/60 hover:text-parchment-100/90">
                        {status.dirtyFiles.length} dirty file{status.dirtyFiles.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="ml-4 mt-1 list-disc font-mono text-[11px] text-parchment-100/70">
                        {status.dirtyFiles.map(f => <li key={f}>{f}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
              </div>
            )}

            {/* Up-to-date state */}
            {!isBlocked && pending === 0 && status.installedViaGit && (
              <div className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/[0.06] p-3 text-xs text-green-200">
                <CheckCircle2 size={14} />
                <span className="font-bold">You're on the latest version.</span>
              </div>
            )}

            {/* Update-ready state */}
            {!isBlocked && pending > 0 && !applying && !result && (
              <div className="space-y-2 rounded-md border border-verdigris-400/40 bg-verdigris-400/[0.06] p-3 text-xs">
                <p className="text-sm font-bold text-verdigris-200">
                  {pending} update{pending === 1 ? "" : "s"} available
                </p>
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {status.pendingCommits.map(c => (
                    <li key={c.sha} className="flex items-start gap-2">
                      <code className="shrink-0 font-mono text-parchment-100/60">{c.shortSha}</code>
                      <span className="flex-1 text-parchment-100/90">{c.subject}</span>
                      <span className="hidden text-[10px] text-parchment-100/50 sm:inline">{c.author}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={apply}
                  disabled={!canApply}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 rounded-lg text-sm font-bold transition-all"
                >
                  <Download size={14} />
                  Apply update
                </button>
              </div>
            )}

            {/* Ahead-of-remote warning (rare) */}
            {status.aheadCommits.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.05] p-3 text-xs text-parchment-100/70">
                You have {status.aheadCommits.length} unpushed local commit{status.aheadCommits.length === 1 ? "" : "s"} on main — the updater won't touch them, but pulling will refuse if upstream has diverged.
              </div>
            )}
          </>
        )}

        {/* In-flight indicator */}
        {applying && (
          <div className="flex items-center justify-center gap-2 px-4 py-3 bg-gold-500/30 text-gold-100 rounded-lg text-sm font-bold">
            <FlameLoader size={16} /> Updating… live log below.
          </div>
        )}

        {/* Post-update result block + Restart button */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className={`rounded-lg p-3 border ${result.ok ? "bg-green-500/[0.08] border-green-500/40" : "bg-red-500/[0.08] border-red-500/40"}`}>
                <div className="flex items-start gap-2">
                  {result.ok
                    ? <CheckCircle2 size={14} className="text-green-400 flex-shrink-0 mt-0.5" />
                    : <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />}
                  <p className={`text-sm font-bold flex-1 ${result.ok ? "text-green-200" : "text-red-300"}`}>
                    {result.message || (result.ok ? "Update applied." : `Update failed (exit ${result.exitCode}).`)}
                  </p>
                </div>

                {result.ok && result.restartRequired && (
                  <button
                    onClick={restartNow}
                    disabled={restarting || reconnecting}
                    className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-verdigris-400 hover:bg-verdigris-300 disabled:opacity-50 text-ink-950 rounded-lg text-sm font-bold transition-all"
                  >
                    {reconnecting
                      ? <><FlameLoader size={14} /> Reconnecting…</>
                      : restarting
                        ? <><FlameLoader size={14} /> Restart requested…</>
                        : <><Power size={14} /> Restart now</>}
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Classification panel — surfaces likely cause + fix above the raw log. */}
        {classification && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3 text-xs space-y-1.5">
            <p className="font-bold text-amber-200">Likely cause: {classification.hint}</p>
            <pre className="font-mono text-[11px] text-parchment-100/75 whitespace-pre-wrap break-words">
              {classification.fix}
            </pre>
          </div>
        )}

        {/* Output-tail preview — always visible on failure. */}
        {result && !result.ok && logLines.length > 0 && (
          <div className="rounded-md border border-red-500/30 bg-red-500/[0.05] p-2 text-xs">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-parchment-100/50">
              Last lines of script output
            </p>
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-red-200/90">
              {outputTail(logLines)}
            </pre>
          </div>
        )}

        {/* Full collapsible log */}
        {logLines.length > 0 && (
          <details
            open={showOutput}
            onToggle={(e) => setShowOutput((e.target as HTMLDetailsElement).open)}
            className="rounded-md border border-gold-400/10 bg-ink-950/40 p-2 text-xs"
          >
            <summary className="cursor-pointer text-parchment-100/60 hover:text-parchment-100/90 flex items-center gap-1.5">
              <Terminal size={12} />
              Full script output ({logLines.length} line{logLines.length === 1 ? "" : "s"})
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
              {logLines.map((l, i) => (
                <span key={i} className={l.stream === "stderr" ? "text-red-300/90" : "text-parchment-100/80"}>
                  {l.line}{"\n"}
                </span>
              ))}
            </pre>
          </details>
        )}
      </div>

      <p className="text-[10px] text-parchment-100/40 mt-3 font-serif">
        Tip: you can also run <code className="font-mono">npm run update</code> from a terminal in this folder — same script.
      </p>
    </section>
  );
}
