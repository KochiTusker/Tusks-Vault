// The `claude` CLI, wrapped once.
//
// Vault can answer through the user's OWN Claude Code subscription instead
// of an API key. The browser cannot spawn processes, so the server does —
// and both callers (the adapter used by the Discord handler, and the
// /api/claude-code/generate route used by the dashboard) go through this
// module rather than each shelling out for themselves.
//
// The adapter used to reach the CLI by fetching its own HTTP route. That
// worked, but it made an in-process text transform depend on the server
// knowing its own base URL — and this app rebinds its port when the
// preferred one is busy, so that was a live failure mode for no benefit.
//
// Auth model: the app NEVER handles login. The user runs `claude login`
// themselves; we only invoke their already-authenticated binary. The child
// env has ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL
// stripped, case-insensitively — a stray key in the environment otherwise
// silently takes precedence and bills the API instead of the subscription,
// which is the opposite of why anyone chooses this provider.
//
// Ported from the sibling project, whose implementation had already paid for
// several of the non-obvious details noted below.

import { spawn, spawnSync } from "child_process";
import os from "os";
import path from "path";
import fs from "fs/promises";

const CLI_COMMAND = "claude";

/** Aliases first, so the default stays stable across model upgrades. */
// Owned by model-namespace.ts — the namespace rules need this list, and that
// module must stay free of process-spawning imports. Imported (not just
// re-exported) because this file uses it too, and re-exported so every
// existing call site keeps working.
import { CLAUDE_CODE_MODELS } from "./model-namespace";
import { shellSafeSpawn } from "../util/win-spawn";
export { CLAUDE_CODE_MODELS };

/** The model is the only request-derived value that reaches argv (the prompt
 *  goes via stdin), so it is charset-validated to keep the Windows
 *  shell:true spawn injection-free. */
const MODEL_RE = /^[A-Za-z0-9._-]+$/;

/** Neutral empty working directory. Pins the child's cwd AWAY from the repo:
 *  answering a lore question is a stdin→stdout text transform that needs no
 *  project context, and the prompt contains the user's lore plus a Discord
 *  message — untrusted text. If the user has pre-approved tools in their own
 *  ~/.claude config, a prompt-injected tool call then sees an empty sandbox
 *  rather than .git, .env.local, or the source tree. */
const SANDBOX_DIR = path.join(os.tmpdir(), "tusks-vault-claude-sandbox");

/** Exit codes at or above 0xC0000000 are NTSTATUS failures: the process was
 *  created but could not start. That is emphatically NOT "the CLI is
 *  absent" — it means we could not look, and reporting it as absent makes
 *  the UI state confidently and wrongly that a working CLI is missing. */
const NTSTATUS_FAILURE_FLOOR = 0xc0000000;

/** Categorised failure, so the route can pick an HTTP status and the adapter
 *  can pick a message without either re-parsing the other's prose. */
export type ClaudeCodeFailure = "usage_limit" | "not_installed" | "bad_request" | "cli_failed";

export class ClaudeCodeError extends Error {
  constructor(message: string, readonly kind: ClaudeCodeFailure) {
    super(message);
    this.name = "ClaudeCodeError";
  }
}

export type ProbeOutcome =
  | { kind: "found"; version: string }
  | { kind: "absent" }
  | { kind: "unknown"; reason: string };

export interface ClaudeCodeStatus {
  installed: boolean;
  version: string | null;
  /** Set when the check itself failed. `installed: false` then means
   *  "unknown", not "absent". */
  probeFailed?: string;
  /** Best-effort: a credentials file exists. Advisory only — on macOS the
   *  credentials may live in the Keychain with no file, so `false` does not
   *  prove "not logged in". The generate path surfaces the real answer. */
  authenticated: boolean;
  models: string[];
}

let statusCache: { value: ClaudeCodeStatus; at: number } | null = null;
const STATUS_TTL_MS = 5_000;

async function credentialsFileExists(): Promise<boolean> {
  const home = os.homedir();
  const candidates = [
    path.join(home, ".claude", ".credentials.json"),
    path.join(home, ".claude", ".credentials"),
  ];
  const results = await Promise.all(
    candidates.map(p => fs.access(p).then(() => true).catch(() => false))
  );
  return results.some(Boolean);
}

function probeVersion(): Promise<ProbeOutcome> {
  return new Promise(resolve => {
    let out = "";
    let settled = false;
    const finish = (v: ProbeOutcome) => {
      if (!settled) { settled = true; resolve(v); }
    };
    let child;
    try {
      // AUDIT: shell:true is required on Windows to resolve the `claude.cmd`
      // npm shim (bare-name spawn cannot find .cmd via PATHEXT). Safe here:
      // argv is the literal '--version' — no request-derived value.
      // shellSafeSpawn pre-quotes into one string and passes an empty args
      // array, which is what keeps Node 22+ from printing DEP0190 at boot.
      const cmd = shellSafeSpawn(CLI_COMMAND, ["--version"]);
      child = spawn(cmd.command, cmd.args, {
        shell: cmd.shell,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      return finish({ kind: "unknown", reason: `spawn threw: ${(err as Error).message}` });
    }
    child.stdout?.on("data", (b: Buffer) => (out += b.toString("utf8")));
    child.on("error", err => finish({ kind: "unknown", reason: err.message }));
    child.on("close", code => {
      if (code === 0) return finish({ kind: "found", version: out.trim() || "unknown" });
      if (code !== null && code >= NTSTATUS_FAILURE_FLOOR) {
        return finish({
          kind: "unknown",
          reason: `the check could not start (0x${code.toString(16)}) — restarting Tusk's Vault usually clears this`,
        });
      }
      return finish({ kind: "absent" });
    });
    setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish({ kind: "unknown", reason: "the check timed out" });
    }, 4000);
  });
}

export async function claudeCodeStatus(force = false): Promise<ClaudeCodeStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) {
    return statusCache.value;
  }
  const [probe, authenticated] = await Promise.all([probeVersion(), credentialsFileExists()]);
  const value: ClaudeCodeStatus = {
    installed: probe.kind === "found",
    version: probe.kind === "found" ? probe.version : null,
    probeFailed: probe.kind === "unknown" ? probe.reason : undefined,
    authenticated,
    models: CLAUDE_CODE_MODELS,
  };
  statusCache = { value, at: Date.now() };
  return value;
}

/** Synchronous availability check for the provider registry, so the picker
 *  can hide the option when the CLI is absent without an async hop. Cheap:
 *  spawnSync of `--version` with a short timeout, cached by the caller. */
export function claudeCodeInstalledSync(): boolean {
  try {
    // AUDIT: shell:true needed for the Windows claude.cmd shim; argv is the
    // literal '--version' with no request-derived value. Pre-quoted via
    // shellSafeSpawn so this sync probe does not emit DEP0190 either — it runs
    // during provider-registry resolution, i.e. on the boot path.
    const cmd = shellSafeSpawn(CLI_COMMAND, ["--version"]);
    const r = spawnSync(cmd.command, cmd.args, {
      shell: cmd.shell,
      timeout: 4000,
      stdio: "ignore",
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** Strip the variables that would silently switch the CLI onto API billing.
 *  Case-INSENSITIVE: Windows treats env names case-insensitively, but a
 *  plain JS object delete is case-sensitive, so `anthropic_api_key` would
 *  otherwise survive the strip while the child still resolved it. */
export function childEnvWithoutApiKeys(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const STRIP = new Set(
    ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"].map(k => k.toLowerCase())
  );
  const next: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (!STRIP.has(k.toLowerCase())) next[k] = v;
  }
  return next;
}

interface ClaudeJsonResult {
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  api_error_status?: number;
}

export interface ClaudeCodeResult {
  text: string;
  costUsd?: number;
}

/** Parse the `--output-format json` payload. Exported for tests. */
export function parseClaudeJson(stdout: string): ClaudeCodeResult {
  let parsed: ClaudeJsonResult;
  try {
    parsed = JSON.parse(stdout) as ClaudeJsonResult;
  } catch {
    throw new Error(
      `Claude Code returned output that wasn't valid JSON. First 300 chars:\n${stdout.slice(0, 300)}`
    );
  }
  if (parsed.is_error) {
    throw new Error(parsed.result?.trim() || "Claude Code reported an error with no detail.");
  }
  return {
    text: typeof parsed.result === "string" ? parsed.result : "",
    ...(typeof parsed.total_cost_usd === "number" ? { costUsd: parsed.total_cost_usd } : {}),
  };
}

/** Usage-limit signals. The CLI has no typed error channel for subscription
 *  exhaustion, so this pattern-matches its human-readable message. Patterns
 *  lean INCLUSIVE on purpose: a transient 429 misread as a limit costs one
 *  clear "wait for the window" message, whereas a real limit misread as a
 *  generic error tells the user something broke when nothing did. */
const USAGE_LIMIT_PATTERNS = [
  /you've hit your (usage )?limit/i,
  /you're out of extra usage/i,
  /usage limit reached/i,
  /rate.?limit(_error| reached|ed)?/i,
  /exceed your account'?s rate limit/i,
  /resource_exhausted/i,
];

export function detectUsageLimit(raw: string): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as ClaudeJsonResult;
    if (parsed && typeof parsed === "object") {
      // A NON-error JSON wrapper is never "limited": its `result` field is
      // model output, and generated prose that happens to mention limits
      // would otherwise false-positive.
      if (!parsed.is_error) return false;
      if (parsed.api_error_status === 429) return true;
      return USAGE_LIMIT_PATTERNS.some(re => re.test(parsed.result ?? ""));
    }
  } catch {
    /* not JSON — fall through to text matching */
  }
  return USAGE_LIMIT_PATTERNS.some(re => re.test(raw));
}

export interface RunClaudeCodeInput {
  model?: string;
  prompt: string;
  /** Called with a kill function once the child exists, so an HTTP caller can
   *  terminate it if the client hangs up. */
  onSpawn?: (kill: () => void) => void;
}

/**
 * Run one prompt through the CLI and resolve with its text.
 *
 * Rejects with a ClaudeCodeError whose `kind` tells the caller what happened,
 * so neither caller has to re-parse the other's prose to decide on a status
 * code or a user-facing message.
 */
export function runClaudeCode(input: RunClaudeCodeInput): Promise<ClaudeCodeResult> {
  const chosenModel = (input.model || "sonnet").trim();
  if (!MODEL_RE.test(chosenModel)) {
    return Promise.reject(new ClaudeCodeError(`Invalid model id: ${chosenModel}`, "bad_request"));
  }
  if (typeof input.prompt !== "string" || !input.prompt.trim()) {
    return Promise.reject(new ClaudeCodeError("Missing prompt.", "bad_request"));
  }

  return (async () => {
    let sandboxCwd: string | undefined;
    try {
      await fs.mkdir(SANDBOX_DIR, { recursive: true });
      sandboxCwd = SANDBOX_DIR;
    } catch {
      sandboxCwd = undefined; // temp not writable — better than failing the call
    }

    return await new Promise<ClaudeCodeResult>((resolve, reject) => {
      let child;
      try {
        // AUDIT: shell:true is required on Windows for the claude.cmd shim.
        // argv holds only literals plus the MODEL_RE-validated model; the
        // prompt (lore + user question, both untrusted) goes via stdin and
        // never touches the shell. shellSafeSpawn quotes each argument and
        // passes an empty args array, so Node concatenates nothing itself —
        // belt and braces on top of MODEL_RE, and no DEP0190.
        const cmd = shellSafeSpawn(CLI_COMMAND, [
          "-p",
          "--output-format",
          "json",
          "--model",
          chosenModel,
        ]);
        child = spawn(cmd.command, cmd.args, {
          shell: cmd.shell,
          stdio: ["pipe", "pipe", "pipe"],
          env: childEnvWithoutApiKeys(process.env),
          cwd: sandboxCwd,
        });
      } catch (err) {
        reject(
          new ClaudeCodeError(
            `Couldn't launch the Claude Code CLI: ${(err as Error).message}. Make sure "claude" is on your PATH.`,
            "not_installed"
          )
        );
        return;
      }

      let stdout = "";
      let stderr = "";
      let settled = false;
      const fail = (e: ClaudeCodeError) => {
        if (!settled) { settled = true; reject(e); }
      };
      const succeed = (v: ClaudeCodeResult) => {
        if (!settled) { settled = true; resolve(v); }
      };

      input.onSpawn?.(() => {
        if (settled) return;
        settled = true;
        try { child.kill(); } catch { /* already gone */ }
        reject(new ClaudeCodeError("Claude Code call was cancelled.", "cli_failed"));
      });

      child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
      child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));

      child.on("error", err => {
        const enoent = (err as NodeJS.ErrnoException).code === "ENOENT";
        fail(
          new ClaudeCodeError(
            enoent
              ? "Claude Code CLI not found. Install it and run `claude login` with your Pro/Max plan."
              : `Claude Code CLI error: ${err.message}`,
            enoent ? "not_installed" : "cli_failed"
          )
        );
      });

      child.on("close", (code, signal) => {
        if (settled) return;
        const limited = detectUsageLimit(stdout) || detectUsageLimit(stderr);
        if (code !== 0) {
          const detail =
            stderr.trim() || stdout.trim() ||
            (signal ? `terminated by signal ${signal}` : `exit code ${code}`);
          fail(
            limited
              ? new ClaudeCodeError(`Claude Code usage limit reached: ${detail.slice(0, 300)}`, "usage_limit")
              : new ClaudeCodeError(`Claude Code CLI failed: ${detail.slice(0, 600)}`, "cli_failed")
          );
          return;
        }
        try {
          succeed(parseClaudeJson(stdout));
        } catch (err) {
          const msg = (err as Error).message;
          fail(
            limited || detectUsageLimit(msg)
              ? new ClaudeCodeError(`Claude Code usage limit reached: ${msg.slice(0, 300)}`, "usage_limit")
              : new ClaudeCodeError(msg, "cli_failed")
          );
        }
      });

      // A Vault prompt carries the whole lore corpus, so stdin.write() buffers
      // and flushes ASYNCHRONOUSLY. If the CLI exits before draining — not
      // logged in, bad model, limit already hit — the stream emits 'error',
      // and without this listener that is an uncaught exception that takes the
      // whole server down mid-answer. A try/catch only ever caught the
      // synchronous throw.
      child.stdin.on("error", (err: NodeJS.ErrnoException) => {
        fail(
          new ClaudeCodeError(
            `Claude Code closed its input before the prompt was sent (${err.code ?? err.message}). ` +
              `The CLI usually exits this early when it is not logged in, the model id is unavailable ` +
              `on your plan, or a usage limit was already reached.`,
            "cli_failed"
          )
        );
      });

      try {
        child.stdin.write(input.prompt);
        child.stdin.end();
      } catch (err) {
        fail(
          new ClaudeCodeError(
            `Failed to send prompt to Claude Code: ${(err as Error).message}`,
            "cli_failed"
          )
        );
      }
    });
  })();
}
