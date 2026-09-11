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

/** Prefix for the child's working directory. A FRESH directory is created per
 *  call via mkdtemp and removed afterwards — never reused, never guessable.
 *
 *  Pinning cwd away from the repo was right and is kept: answering a lore
 *  question is a stdin→stdout text transform that needs no project context, so
 *  an injected tool call sees an empty directory rather than .git, .env.local
 *  or the source tree.
 *
 *  What changed is the FIXED name. It used to be a constant path in the shared
 *  temp dir, published in open source. On Linux and macOS /tmp is
 *  world-writable, so any other local account could pre-create that directory
 *  and leave a CLAUDE.md in it, which the CLI reads as project instructions
 *  before it reads the prompt. That is prompt injection that never travels
 *  through the prompt, so no upstream input validation could ever see it.
 *  Reproduced against the real CLI before this change; the planted instruction
 *  was obeyed.
 *
 *  Same class as the fixed .tmp filename that corrupted settings.json: a
 *  predictable shared path is a rendezvous point for whatever else is on the
 *  box. */
const SANDBOX_PREFIX = path.join(os.tmpdir(), "tusks-vault-claude-");
/** Tried in order. The second exists only so that an unwritable system temp
 *  degrades to a different PRIVATE directory rather than to the repo root. */
const SANDBOX_PREFIXES = [SANDBOX_PREFIX, path.join(os.homedir(), ".tusks-vault-claude-")]
  // os.tmpdir() returns TEMP/TMPDIR verbatim, so a relative or empty value
  // yields a relative prefix and mkdtemp then resolves it against cwd — the
  // repo root. Claude Code walks PARENT directories for CLAUDE.md, so a
  // sandbox inside the repo still reaches the instructions this control
  // exists to keep away from it. An unusable prefix must fail loudly.
  .filter(p => path.isAbsolute(p) && !p.startsWith(process.cwd() + path.sep));

/** Tools the child may NOT use.
 *
 *  The CLI is invoked here as a text transform: lore plus an untrusted player
 *  question in, prose out. It has no business touching the filesystem, the
 *  network, or a shell. But `claude -p` with no flags registers the host
 *  user's ENTIRE tool surface, governed only by their own ~/.claude allowlist —
 *  which Vault does not set and cannot read. Measured on one developer machine,
 *  that surface included Bash, PowerShell, Write, WebFetch, cron creation, and
 *  every tool from whatever MCP servers that user had configured.
 *
 *  The wildcard first, then the explicit names: belt and braces. The wildcard
 *  is not documented in `claude --help`, so it is not load-bearing on its own —
 *  it is there to cover tools that future CLI versions add and this list cannot
 *  know about. The explicit half is the verified one.
 *
 *  Do NOT "simplify" this to an empty --allowedTools. That was tested against
 *  the real CLI and does NOT deny-all: the empty allowlist was ignored and the
 *  child read a protected file anyway. An empty allowlist permits everything;
 *  it does not forbid anything. */
const DENIED_TOOLS = [
  "*",
  "Bash", "BashOutput", "KillShell", "PowerShell",
  "Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep",
  "WebFetch", "WebSearch",
  "Task", "Agent", "Skill", "SlashCommand", "Artifact", "Workflow", "ToolSearch",
  "SendMessage", "ListAgents", "Monitor", "TodoWrite", "ExitPlanMode",
  "CronCreate", "CronDelete", "CronList", "RemoteTrigger", "PushNotification",
  "DesignSync", "EnterWorktree", "ExitWorktree", "ScheduleWakeup", "ReportFindings",
  "TaskCreate", "TaskGet", "TaskList", "TaskOutput", "TaskStop", "TaskUpdate",
  "ListMcpResourcesTool", "ReadMcpResourceTool", "ReadMcpResourceDirTool",
].join(",");

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

/** Environment variables the CLI is allowed to inherit.
 *
 *  This is an ALLOWLIST, and the direction is the point. It used to exclude
 *  just three ANTHROPIC_* variables, which meant the child inherited
 *  everything else — and by the time this runs, dotenv has loaded .env.local
 *  into process.env, so "everything else" included DISCORD_TOKEN,
 *  GEMINI_API_KEY and OPENROUTER_API_KEY. A process that runs untrusted text
 *  through a model should not be holding the user's Discord token, and no
 *  exclusion list keeps up with secrets added later.
 *
 *  Entries are infrastructure only: what the process needs to start, find its
 *  own config, resolve TLS, and traverse a corporate proxy. Adding a name here
 *  is a security decision — it belongs only if the CLI genuinely cannot work
 *  without it. */
const ENV_ALLOWLIST = [
  // Process + shell basics.
  "PATH", "PATHEXT", "COMSPEC", "SHELL", "TMPDIR", "TEMP", "TMP",
  // Where the CLI finds ~/.claude and its credentials.
  "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_CACHE_HOME",
  "CLAUDE_CONFIG_DIR",
  // Windows needs these for spawn/shell resolution at all.
  "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "PROGRAMDATA",
  "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS",
  // Network egress: a user behind a corporate proxy has no route without these.
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
  // TLS trust stores — self-signed corporate roots break the CLI without them.
  "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR",
  // Locale, so output encoding matches the parent.
  "LANG", "LC_ALL", "LC_CTYPE", "TZ",
].map(k => k.toLowerCase());

/** Build the child environment from the allowlist above.
 *
 *  Comparison is case-INSENSITIVE because Windows env names are, but a plain
 *  JS object lookup is not. The original version carried the same note for the
 *  same reason: on Windows, `Path` and `PATH` are one variable, and a
 *  case-sensitive check would drop the former while matching the latter.
 *
 *  ANTHROPIC_API_KEY / _AUTH_TOKEN / _BASE_URL are absent from the allowlist by
 *  construction, which preserves the original billing guarantee: this provider
 *  exists to bill the user's subscription, and a stray key in the environment
 *  silently takes precedence inside the CLI and bills the API instead — a bug
 *  the user only discovers on an invoice. Asserted by test. */
export function childEnvForCli(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = new Set(ENV_ALLOWLIST);
  const next: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (allowed.has(k.toLowerCase())) next[k] = v;
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
  /** Wall-clock ceiling for the whole call. Injectable so tests can exercise
   *  the timeout path in milliseconds instead of minutes. */
  timeoutMs?: number;
}

/** Wall-clock ceiling on one CLI answer.
 *
 *  Deliberately far above a real answer rather than close to it. A question
 *  takes 5-10 s; the corpus can push that, and a timeout that trips on a slow
 *  but working answer would turn a working install into a broken one, which is
 *  worse than the hang it is guarding. Five minutes matches the updater's
 *  wall-clock guard — by then the call is not slow, it is stuck.
 *
 *  Without this the promise simply never settles. runQueued holds the surface's
 *  slot until it does, and concurrencyFor() gives Claude Code a limit of ONE,
 *  so a single stuck child silently stops that surface answering anyone at all
 *  until the server is restarted. */
const DEFAULT_CLI_TIMEOUT_MS = 5 * 60 * 1000;

/** Terminate the child AND anything it started.
 *
 *  On Windows the spawn goes through cmd.exe (the claude.cmd shim needs a
 *  shell), so child.kill() kills the shim and can leave `claude` running,
 *  holding the sandbox directory open and still spending the subscription call
 *  the caller just cancelled. taskkill /T walks the tree; same approach as
 *  scripts/boot-check.mjs. Everywhere else the direct kill is the tree. */
function killProcessTree(child: { pid?: number; kill: (sig?: NodeJS.Signals) => boolean }): void {
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
    // spawn reports a FAILED LAUNCH asynchronously, via 'error'. A try/catch
    // around it catches nothing, and a ChildProcess with no 'error' listener
    // rethrows as an uncaught exception — which on this path would take the
    // whole server down at the exact moment the wall-clock guard exists to
    // keep it up. Same trap this file already documents for child.stdin.
    // The realistic trigger is not a missing taskkill (it lives in System32)
    // but a refused one: policy-blocked by AppLocker or EDR, or EMFILE under
    // the resource pressure that a hung call tends to come with.
    killer.on("error", () => {
      try { child.kill(); } catch { /* already gone */ }
    });
    killer.unref?.();
    return;
  }
  try { child.kill(); } catch { /* already gone */ }
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
    // Fresh, unguessable directory per call. mkdtemp creates it with the
    // caller's own permissions and never reuses a name, so there is no window
    // in which another local account can plant anything at a path it predicted.
    // Two candidate locations, then give up. The previous fallback was
    // `undefined`, which Node reads as "inherit the parent's cwd" — the repo
    // root, holding .env.local, .git, settings.json and (on a dev checkout) a
    // CLAUDE.md the CLI reads as project instructions before it reads the
    // prompt. That is the exact channel this sandbox exists to close, so it is
    // the one thing the failure path must never fall back to. A second
    // location under the home directory covers the realistic failure (a
    // locked-down or full %TEMP%) without weakening the control; if both fail
    // the machine cannot give us a private directory at all, and an error the
    // operator can read beats a silently unsandboxed spawn.
    let sandboxCwd: string | undefined;
    let sandboxError: unknown;
    for (const prefix of SANDBOX_PREFIXES) {
      try {
        sandboxCwd = await fs.mkdtemp(prefix);
        break;
      } catch (err) {
        sandboxError = err;
      }
    }
    if (!sandboxCwd) {
      console.error("[claude-code] could not create a private working directory:", sandboxError);
      throw new ClaudeCodeError(
        "Could not create a private working directory for the Claude Code CLI. Check that the system temp folder is writable.",
        "cli_failed"
      );
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
          // Deny the tool surface outright rather than trusting the host's own
          // ~/.claude allowlist, which Vault neither sets nor can read. The
          // prompt below carries untrusted player text; without this, an
          // injected instruction reaches whatever that user pre-approved.
          // See DENIED_TOOLS.
          "--disallowedTools",
          DENIED_TOOLS,
          // The user's own MCP servers register as tools on this call too, and
          // an exclusion list cannot cover them: the identifiers come from that user's
          // config and are arbitrary, so there is nothing to enumerate ahead of
          // time. This flag is the only thing that closes the whole class.
          "--strict-mcp-config",
          // With the tools denied, a model that still decides it wants one
          // emits raw <function_calls> markup as ANSWER TEXT — which Vault
          // then posts to Foundry or Discord as the archivist's reply. The
          // gate holds either way; this keeps the failure legible to the
          // table instead of shipping them XML. Observed, not theorised.
          "--append-system-prompt",
          "You have no tools and no filesystem, shell, or network access. Answer only "
            + "from the text supplied in this prompt. Never emit tool-call syntax; if you "
            + "cannot answer from the supplied text, say so in plain prose.",
        ]);
        child = spawn(cmd.command, cmd.args, {
          shell: cmd.shell,
          stdio: ["pipe", "pipe", "pipe"],
          env: childEnvForCli(process.env),
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
      let timer: NodeJS.Timeout | undefined;
      const fail = (e: ClaudeCodeError) => {
        if (!settled) { settled = true; clearTimeout(timer); reject(e); }
      };
      const succeed = (v: ClaudeCodeResult) => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(v); }
      };

      const timeoutMs = input.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
      timer = setTimeout(() => {
        if (settled) return;
        // Log for the operator, then answer the caller with the chat-safe
        // message the surfaces already know how to render. The child is killed
        // as a TREE: leaving it alive would keep burning the subscription call
        // nobody is waiting for any more.
        console.error(
          `[claude-code] no response after ${Math.round(timeoutMs / 1000)}s — terminating the CLI process.`
        );
        killProcessTree(child);
        fail(
          new ClaudeCodeError(
            `Claude Code did not respond within ${Math.round(timeoutMs / 1000)}s and was stopped.`,
            "cli_failed"
          )
        );
      }, timeoutMs);
      // A pending answer must not be the reason the process refuses to exit.
      timer.unref?.();

      input.onSpawn?.(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        killProcessTree(child);
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
    }).finally(async () => {
      // One directory per call would otherwise accumulate in temp forever.
      // Best-effort: a failed cleanup must not turn a good answer into an
      // error, and the next call gets its own directory regardless.
      if (sandboxCwd) await fs.rm(sandboxCwd, { recursive: true, force: true }).catch(() => {});
    });
  })();
}
