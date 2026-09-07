import { Router } from "express";
import express from "express";
import { spawn } from "node:child_process";
import { applyUpdate, getUpdateStatus, scheduleRestart } from "../util/updater";
import { getSettings } from "../config/settings";
import { getDevAuthHeader, hasDevCredential } from "../util/dev-credential";
import { loopbackOnly } from "../util/loopback-only";

// One-shot helper for the deps-changed git diff. Lives here rather than
// updater.ts because it's a route-layer concern: derive a UI hint from the
// before/after SHAs the route just observed. Mirrors Tomes' inline runGit().
function gitDiffNamesOnly(rangeFrom: string, rangeTo: string): Promise<string> {
  return new Promise(resolve => {
    // shell:false — git.exe resolves on PATH without a shell, dodging DEP0190
    // on Node 22+ (which warns when shell:true is combined with a separate
    // args array because the runtime concatenates without escaping).
    const child = spawn("git", ["diff", "--name-only", `${rangeFrom}..${rangeTo}`], {
      cwd: process.cwd(),
    });
    let out = "";
    child.stdout?.on("data", c => { out += c.toString(); });
    child.on("exit", () => resolve(out.trim()));
    child.on("error", () => resolve(""));
  });
}

export const updatesRouter = Router();

// Every route here acts on the HOST, which is the rule for loopbackOnly():
// /apply spawns git and rewrites the working tree, /restart kills the process,
// and /check runs `git fetch` and reports the install's exact position.
//
// This was the one place the code disagreed with the policy. The Origin check
// in hostOriginGuard only fires when an Origin or Referer is actually present
// (`if (raw && ...)`), which is true of browsers and not of curl — so under the
// documented HOST=0.0.0.0 a LAN peer could read the sha from /check and POST
// it straight back to /apply. `confirmSha` never defended against that: it is
// a stale-tab guard, and the value it demands is what /check just handed out.
// /restart had no guard at all.
//
// Cost of the gate: with a non-loopback bind the dashboard's Updates card
// stops working for LAN visitors. That is the intended trade — updating is
// administration, and `npm run update` on the host still does it.
updatesRouter.use("/api/updates", loopbackOnly());

// In-process mutex — mirrors Tusks-Tomes' applyInFlight guard. Prevents two
// concurrent /apply calls from racing on the same working tree (e.g.
// impatient user double-clicking, or a second dashboard tab firing the same
// request). Read-only /check calls are deliberately NOT gated; they're idempotent.
let applyInFlight = false;

// GET /api/updates/check
//   Returns the full UpdateStatus shape. Accepts ?fetch=1 to also run
//   `git fetch origin main` before computing, so the "Check for updates"
//   button can poll a freshly-fetched answer. Without the query param this
//   reports the cached state, which is what the dashboard's mount-time
//   check wants (cheap, no network).
updatesRouter.get("/api/updates/check", async (req, res) => {
  try {
    const settings = getSettings();
    const track = settings.updaterTrack ?? "main";
    const remote = settings.updaterRemote ?? "origin";
    // In dev mode, every network-touching git call needs the in-memory PAT.
    // If no token has been pasted into the dashboard this session, the
    // fetch will 404 — we still attempt the call so the UI gets a clear
    // signal ("blockedReason: Authentication required") rather than failing
    // silently.
    const authHeader = remote === "dev" ? getDevAuthHeader() ?? undefined : undefined;
    const status = await getUpdateStatus({
      fetch: req.query.fetch === "1",
      track,
      remote,
      authHeader,
    });
    // Surface the "no token" state through the existing blockedReason field
    // so the UI can render the authenticate-first prompt uniformly.
    if (remote === "dev" && !authHeader && !status.blockedReason) {
      status.blockedReason =
        "Dev mode is active but no GitHub token has been entered this session. Paste a Personal Access Token with read access to Tusks-Vault-Dev to enable updates.";
      status.error = status.blockedReason;
    }
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/updates/apply — pull origin/main and conditionally re-run npm ci.
//
// Streams progress as Server-Sent Events so the dashboard's update log
// populates line-by-line instead of blocking for the whole run. Mirrors
// Tomes' apply contract on refusal semantics: a blockedReason (not on main,
// dirty tree, fetch failed, ZIP install) returns HTTP 409 with a clear
// explanation BEFORE the SSE stream opens. The apply mutex returns 409 too
// if a previous run is still in flight.
//
// Event shape:
//   event: line   data: {"stream":"stdout"|"stderr","line":"..."}
//   event: done   data: {"ok":boolean,"applied":boolean,"alreadyUpToDate":boolean,
//                        "exitCode":number,"message":string,"before":UpdateStatus,
//                        "after":UpdateStatus,"restartRequired":boolean}
//   event: error  data: {"error":"..."}
//
// Safe to call while the server is handling other requests: the update runs
// in a child process and never touches the live process's module graph.
//
// Body: { confirmSha: <sha> } — must match the remote HEAD SHA the user just
// observed via /api/updates/check. Second line of defence against drive-by
// RCE: even if the host/origin guard ever misfires, an attacker can't trigger
// an apply without first reading the current remote HEAD. The frontend echoes
// `status.remoteHead.sha` back here.
updatesRouter.post("/api/updates/apply", express.json({ limit: "1kb" }), async (req, res) => {
  if (applyInFlight) {
    res.status(409).json({
      ok: false,
      error: "An update is already in progress. Wait for the current run to finish.",
    });
    return;
  }

  const settings = getSettings();
  const track = settings.updaterTrack ?? "main";
  const remote = settings.updaterRemote ?? "origin";

  // Dev-mode auth gate: without an in-memory PAT, refuse to apply.
  if (remote === "dev" && !hasDevCredential()) {
    res.status(401).json({
      ok: false,
      error:
        "Dev mode requires a GitHub Personal Access Token with read access to Tusks-Vault-Dev. Paste one in the dashboard (the token is held in memory only and is wiped on server restart).",
    });
    return;
  }

  const authHeader = remote === "dev" ? getDevAuthHeader() ?? undefined : undefined;
  let before;
  try {
    before = await getUpdateStatus({ fetch: true, track, remote, authHeader });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
    return;
  }
  if (before.blockedReason) {
    res.status(409).json({
      ok: false,
      error: before.blockedReason,
      status: before,
    });
    return;
  }
  if (before.pendingCommits.length === 0) {
    res.json({
      ok: true,
      alreadyUpToDate: true,
      applied: false,
      message: `Already up to date — HEAD is at ${before.head?.shortSha ?? "unknown"}.`,
      before,
      after: before,
      restartRequired: false,
    });
    return;
  }

  // Validate confirmSha against the SHA we just fetched. The exact equality
  // check means a stale client (one that hasn't refetched after a new commit
  // landed upstream) is forced to re-check before applying.
  const { confirmSha } = (req.body ?? {}) as { confirmSha?: unknown };
  const expectedSha = before.remoteHead?.sha;
  if (typeof confirmSha !== "string" || !expectedSha || confirmSha !== expectedSha) {
    res.status(400).json({
      ok: false,
      error: typeof confirmSha !== "string"
        ? "Missing `confirmSha` in body. Apply must echo the remote HEAD sha the user just saw."
        : `confirmSha mismatch: expected ${expectedSha}, got ${confirmSha}. Re-run /api/updates/check?fetch=1 and retry.`,
      expected: expectedSha,
    });
    return;
  }

  // Switch to SSE only after the pre-flight checks pass, so a 400/409 refusal
  // stays a clean JSON response that the client can parse without an SSE reader.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const emit = (event: string, payload: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  applyInFlight = true;
  try {
    // In tag mode, pass the resolved tag name through to update.mjs so it
    // hard-resets to that ref instead of pulling main. Tag was already
    // resolved during the pre-flight `getUpdateStatus` above.
    const targetRef = track === "tag" && before.targetTag ? before.targetTag : undefined;
    const run = await applyUpdate(line => emit("line", line), { targetRef, remote, authHeader });
    const after = await getUpdateStatus({ track, remote, authHeader });
    const beforeSha = before.head?.sha;
    const afterSha = after.head?.sha;
    const applied = run.code === 0 && beforeSha != null && afterSha !== beforeSha;

    // Compute depsChanged server-side instead of making the UI string-grep
    // the script output for DEPENDENCY_CHANGES_DETECTED. Mirrors Tomes'
    // route-layer detection: same source of truth, two independent signals
    // (script marker + this diff) so neither can drift past the other.
    let depsChanged = false;
    if (applied && beforeSha && afterSha) {
      const changedFiles = await gitDiffNamesOnly(beforeSha, afterSha);
      depsChanged = /^package(-lock)?\.json$/m.test(changedFiles);
    }

    emit("done", {
      ok: run.code === 0,
      applied,
      alreadyUpToDate: false,
      depsChanged,
      exitCode: run.code,
      message: run.code !== 0
        ? `Update script exited with code ${run.code}. See output above for the cause.`
        : !applied
          ? `Update script finished but HEAD did not move (${after.head?.shortSha}).`
          : depsChanged
            ? `Updated to ${after.head?.shortSha}. Dependencies changed — run npm install before restarting (the banner below has a copy-pasteable command).`
            : `Updated to ${after.head?.shortSha}. Click "Restart now" to load the new code.`,
      before,
      after,
      // Only auto-restart when the pull DIDN'T touch dependencies. If it
      // did, the user needs to npm-install first; auto-restarting would
      // launch the new server with stale node_modules.
      restartRequired: run.code === 0 && applied && !depsChanged,
    });
  } catch (err) {
    emit("error", { error: (err as Error).message });
  } finally {
    applyInFlight = false;
    res.end();
  }
});

// POST /api/updates/restart — graceful restart endpoint.
//
// Responds immediately with { ok: true, exitCode: 42 } so the dashboard can
// show a "Reconnecting…" state, then schedules process.exit(42) on a short
// delay (long enough for Express to flush the response). The launchers
// (run.bat / run.sh) catch exit code 42 specifically and re-launch the
// server — any other non-zero code falls through to their error path.
//
// Only exposed when this install is a git clone with updates applied; the
// frontend hides the button otherwise. The endpoint itself is unconditional
// because nothing prevents a user from intentionally restarting on demand.
updatesRouter.post("/api/updates/restart", (_req, res) => {
  res.json({ ok: true, exitCode: 42, scheduledIn: "1s" });
  scheduleRestart(800);
});
