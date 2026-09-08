#!/usr/bin/env node
// Does the server actually start on this machine?
//
// The suite had 1,488 unit tests and not one of them started the application.
// That gap is not academic: the defect this script was written alongside made
// the server fail at import on Windows on ARM, and every one of those tests
// still passed, because none of them loaded the boot path. A green suite said
// nothing about whether the program runs.
//
// So this is deliberately shallow and deliberately real. It boots the actual
// server the actual way, waits for it to answer, checks a handful of endpoints,
// and stops. It is not an integration suite and should not grow into one — the
// question it answers is "does a fresh install come up", and the value is that
// it runs on every OS in the CI matrix.
//
//   node scripts/boot-check.mjs            # port 3987, sandboxed state
//   BOOT_CHECK_PORT=3999 node scripts/boot-check.mjs
//
// The config directory, the key store and the lore folder are all redirected
// into scratch locations, so this never reads or writes the real ones. Read
// the comment on `loreDir` before changing where any of it points — that one
// is placed to make a data-loss path impossible, not for tidiness.
//
// The exception, stated because a half-true isolation claim is worse than
// none: `settings.json` is resolved from `process.cwd()`, and the child runs
// with cwd = repo root, so a LOCAL run reads (and, because getSettings()
// persists on read, rewrites) the developer's real settings.json. It is not
// destructive and there is no such file in CI, but it does mean a local run
// inherits whatever lore source is configured. Redirecting it needs an env
// override in config/settings.ts, which does not exist yet.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.BOOT_CHECK_PORT ?? 3987);
const BOOT_TIMEOUT_MS = Number(process.env.BOOT_CHECK_TIMEOUT_MS ?? 180_000);

// A unique sandbox per run: two checks in parallel (a CI matrix re-run, a
// developer with the dev server up) must not share a config dir or a port file.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-boot-"));
const configDir = path.join(sandbox, "config");
fs.mkdirSync(configDir, { recursive: true });

// The lore directory goes INSIDE the repo, and that placement is a safety
// property rather than a convenience.
//
// `ensureKnowledgeDir` migrates `<repo>/Lore` into the resolved lore root the
// first time that root is external — moving the user's documents, by design.
// Pointing this check at a temp directory therefore made it a migration
// destination: on a developer machine with files in `<repo>/Lore`, a run moved
// them into the sandbox and the cleanup step then deleted the sandbox. That is
// exactly how it went wrong once, and the lost directory was not recoverable.
//
// The migration is gated on `isOutsideRepo(KNOWLEDGE_DIR)`, so a path inside
// the working tree cannot trigger it at all. That makes the dangerous case
// structurally impossible instead of merely handled.
//
// The name is unique per run, so this never inherits — or wipes — a directory
// it did not create. An earlier draft used a fixed name and cleared it at
// startup, which reintroduced the same destroy-first hazard at the other end.
const loreDir = path.join(ROOT, `.boot-check-lore-${process.pid}`);
const LORE_MARKER = "boot-check.md";
// Everything this check is willing to delete on the way out. Anything NOT in
// this set arrived from somewhere else, and its presence stops the cleanup
// dead. Listed explicitly rather than pattern-matched: the guard's job is to
// notice migrated DOCUMENTS, so a wildcard would defeat it.
const OURS = new Set([
  LORE_MARKER,
  // Written into the lore root by the server itself, so ours by consequence.
  "logs",
  "clarifications.json",
  "clarifications.embeddings.json",
  "lore_gaps.json",
]);
fs.mkdirSync(loreDir, { recursive: true });
fs.writeFileSync(
  path.join(loreDir, LORE_MARKER),
  "# Boot check\n\nA single lore file, so the loader has something to walk.\n"
);

const env = {
  ...process.env,
  TUSKS_VAULT_CONFIG_DIR: configDir,
  TUSKS_VAULT_LORE_PATH: loreDir,
  PORT: String(PORT),
  // Never open a browser from CI, and never from a maintainer running this by
  // hand either — the check is over in seconds and a stray tab is just litter.
  TUSKS_VAULT_OPEN_BROWSER: "0",
};
// A Discord token in the environment would make this check log a real bot in
// and out on every run. The server treats a missing token as "not configured",
// which is exactly the state a first boot is in.
delete env.DISCORD_TOKEN;

// tsx is invoked through node directly rather than via `npm run start`.
// Node 22+ refuses to spawn a .cmd shim without shell:true (it throws EINVAL),
// and reaching for a shell here to run a fixed command would be the one place
// in this repo that does it for no reason. See src/server/util/win-spawn.ts for
// the case where a shell genuinely is unavoidable.
const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
if (!fs.existsSync(tsx)) {
  console.error(`[boot-check] tsx not found at ${tsx} — run npm ci first.`);
  process.exit(1);
}

// Refuse to run if anything already answers on the preferred port.
//
// Without this the check can report a false GREEN, which is the one outcome a
// boot check must never produce: an orphaned Vault from an earlier run (Ctrl+C
// skips cleanup, and on Windows the tsx grandchild outlives its parent) answers
// /api/status with valid JSON, all four probes pass, and the summary prints
// that stale process's version while the code under test never started.
try {
  const stray = await fetch(`http://127.0.0.1:${PORT}/api/status`, {
    signal: AbortSignal.timeout(2000),
  });
  if (stray.ok) {
    console.error(
      `[boot-check] FAIL: something is already answering on port ${PORT}.\n` +
        "  A previous run may have been interrupted and left a server behind.\n" +
        `  Stop it, or pick another port:  BOOT_CHECK_PORT=3999 npm run boot-check`
    );
    fs.rmSync(sandbox, { recursive: true, force: true });
    fs.rmSync(loreDir, { recursive: true, force: true });
    process.exit(1);
  }
} catch {
  /* nothing listening — the state we want */
}

console.log(`[boot-check] starting the server on port ${PORT}`);
console.log(`[boot-check] sandboxed state in ${sandbox}`);

const child = spawn(process.execPath, [tsx, "server.ts"], { cwd: ROOT, env });
let output = "";
child.stdout.on("data", d => { output += d; });
child.stderr.on("data", d => { output += d; });

let childExit = null;
child.on("exit", code => { childExit = code; });

function stopServer() {
  if (childExit !== null) return;
  if (process.platform === "win32") {
    // child.kill() signals only the direct child; tsx runs the server in a
    // grandchild, which would survive and hold the port.
    spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function cleanup() {
  stopServer();
  try {
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch {
    /* a temp dir we could not remove is not a reason to fail the check */
  }

  // Belt and braces behind the placement above. If anything other than our own
  // marker file is in here, something moved real data in, and deleting the
  // directory would destroy it. Leave it on disk and say where it is — a
  // stranded folder is a nuisance, and the alternative was not.
  try {
    const left = fs.readdirSync(loreDir).filter(name => !OURS.has(name));
    if (left.length > 0) {
      console.warn(
        `[boot-check] NOT deleting ${loreDir} — it contains files this check did not create: ${left.join(", ")}`
      );
      return;
    }
    fs.rmSync(loreDir, { recursive: true, force: true });
  } catch {
    /* nothing to clean up, or already gone */
  }
}

function fail(message) {
  console.error(`\n[boot-check] FAIL: ${message}`);
  if (output.trim()) {
    console.error("\n--- server output ---");
    console.error(output.trimEnd());
    console.error("--- end server output ---");
  }
  cleanup();
  process.exit(1);
}

// The port the server ACTUALLY bound, which is not necessarily the one we
// asked for: bindWithFallback walks upward when the preferred port is taken or
// reserved. Polling the requested port instead would report "no response" for
// a server that started perfectly well on the next one along.
let actualPort = PORT;

async function get(pathname) {
  return fetch(`http://127.0.0.1:${actualPort}${pathname}`, { signal: AbortSignal.timeout(30_000) });
}

// Wait for the port to answer. The embedding model downloads ~25 MB on a cold
// machine, but that happens after the socket is bound and must not gate this.
const deadline = Date.now() + BOOT_TIMEOUT_MS;
let up = false;
while (Date.now() < deadline) {
  if (childExit !== null) fail(`the server exited with code ${childExit} before it answered`);

  // The server announces the bound port on stdout once it is listening.
  const announced = /running on https?:\/\/[^\s:]+:(\d+)/i.exec(output);
  if (announced) {
    const bound = Number(announced[1]);
    if (bound !== actualPort) {
      console.log(`[boot-check] server bound ${bound} (asked for ${PORT}) — following it`);
      actualPort = bound;
    }
  }

  try {
    const res = await get("/api/status");
    if (res.ok) { up = true; break; }
  } catch {
    /* not listening yet */
  }
  await new Promise(r => setTimeout(r, 1000));
}

if (!up) fail(`no response on port ${actualPort} within ${Math.round(BOOT_TIMEOUT_MS / 1000)}s`);

// Endpoints chosen to cover the boot path's distinct pieces rather than to be
// exhaustive: process state, the settings file, the knowledge loader, and the
// frontend the launcher opens.
//
// `expect` is not decoration. In dev the Vite middleware serves index.html as
// an SPA fallback for anything it does not recognise, so a MISSPELLED API path
// returns 200 with an HTML body — which is exactly how the first draft of this
// script "passed" against `/api/knowledge/status`, a route that does not
// exist. Asserting the content type is what makes an API check an API check.
const checks = [
  ["/api/status", "server state", "json"],
  ["/api/settings", "settings file", "json"],
  ["/api/knowledge", "lore loader", "json"],
  ["/", "dashboard", "html"],
];

/** Poll one endpoint until it answers in the expected shape, or time out.
 *  Vite compiles the frontend on the first request for it, so `/` can take a
 *  few seconds on a cold cache — one-shot checks made this flaky. */
async function check(pathname, expect, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  let last = "no response";
  while (Date.now() < until) {
    if (childExit !== null) return { ok: false, detail: `server exited (${childExit})` };
    try {
      const res = await get(pathname);
      const type = res.headers.get("content-type") ?? "";
      const matches = expect === "json" ? type.includes("json") : type.includes("html");
      if (res.ok && matches) return { ok: true, detail: `${res.status} ${expect}` };
      last = res.ok
        ? `${res.status} but content-type was "${type}" (expected ${expect})`
        : `HTTP ${res.status}`;
    } catch (err) {
      last = err.message;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return { ok: false, detail: last };
}

let failed = 0;
for (const [pathname, label, expect] of checks) {
  const { ok, detail } = await check(pathname, expect);
  console.log(`  ${ok ? "OK " : "ERR"} ${pathname.padEnd(16)} ${label.padEnd(14)} ${detail}`);
  if (!ok) failed++;
}

if (failed) fail(`${failed} of ${checks.length} endpoint(s) did not answer correctly`);

const status = await (await get("/api/status")).json();
console.log(`\n[boot-check] PASS — v${status.version} booted on ${process.platform}/${process.arch}, node ${process.version}`);
cleanup();
process.exit(0);
