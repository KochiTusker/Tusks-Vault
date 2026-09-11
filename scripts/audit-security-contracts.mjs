#!/usr/bin/env node
// Codified institutional memory — every invariant CLAUDE.md states about
// this codebase, asserted instead of remembered. When a future contributor
// (human or AI) breaks one, CI fails here before the change ships.
//
// To allowlist a finding deliberately, put a comment on the same line or
// within the 3 lines above it, of the form:
//     // AUDIT: <one-line reason>
// A bare `// AUDIT:` with no reason fails loudly, so an exception always
// arrives with its justification.
//
// Run: `node scripts/audit-security-contracts.mjs` (also part of `verify`).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PATTERNS } from "./audit-patterns.mjs";
import { readPublicExcludes, isPublicExcluded } from "./lib/public-exclude.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function read(file) {
  try {
    return readFileSync(path.join(REPO_ROOT, file), "utf8");
  } catch {
    return "";
  }
}

/** Find an AUDIT: opt-out on this line or any of the previous 3 lines.
 *  Returns the reason text, null when absent, or "" when bare (which is
 *  treated as missing — an exception must say why it exists). */
function auditOptOut(lines, lineIdx) {
  for (let offset = 0; offset <= 3; offset++) {
    const line = (lines[lineIdx - offset] ?? "").replace(/\r$/, "");
    const m = line.match(/AUDIT:\s*(.*)$/);
    if (m) return m[1].trim();
  }
  return null;
}

const findings = [];
function report(file, lineNum, ruleId, message) {
  findings.push({ file, lineNum, ruleId, message });
}

const RELEASE_SCRIPT = "scripts/release-to-public.mjs";

// ─── R1: the pinned public identity exists in the release script ───────────
// It is the trust root for the commit-identity scanner layer AND the thing
// that keeps a drifted local git config from deanonymising a release.
function rulePinnedIdentity() {
  const src = read(RELEASE_SCRIPT);
  if (!/PUBLIC_AUTHOR_NAME\s*=\s*"[^"]+"/.test(src)) {
    report(RELEASE_SCRIPT, 0, "pinned-identity-name",
      "PUBLIC_AUTHOR_NAME constant is missing — release commits would take their author from local git config.");
  }
  if (!/PUBLIC_AUTHOR_EMAIL\s*=\s*"[^"]+@users\.noreply\.github\.com"/.test(src)) {
    report(RELEASE_SCRIPT, 0, "pinned-identity-email",
      "PUBLIC_AUTHOR_EMAIL constant is missing or not a noreply address.");
  }
}

// ─── R2: identity + UTC env reaches both the commit AND the tag ────────────
// GitHub shows author and committer, and a tag object carries its own
// tagger identity + date. Any of the three taking values from local config
// leaks name/timezone.
function ruleReleaseEnv() {
  const src = read(RELEASE_SCRIPT);
  const envBlocks = (src.match(/GIT_COMMITTER_NAME:\s*PUBLIC_AUTHOR_NAME/g) ?? []).length;
  if (envBlocks < 2) {
    report(RELEASE_SCRIPT, 0, "release-env-coverage",
      `expected the pinned-identity env block on both the commit and the tag paths; found ${envBlocks} block(s).`);
  }
  if (!/GIT_AUTHOR_DATE/.test(src) || !/GIT_COMMITTER_DATE/.test(src)) {
    report(RELEASE_SCRIPT, 0, "release-env-dates",
      "GIT_AUTHOR_DATE / GIT_COMMITTER_DATE pinning is gone — release timestamps would leak the local timezone.");
  }
  for (const call of ["commit-tree", '"tag"']) {
    if (!src.includes(call)) {
      report(RELEASE_SCRIPT, 0, "release-env-calls",
        `expected a ${call} invocation in the release script; the release flow has changed shape — re-verify identity pinning end to end and update this rule.`);
    }
  }
}

// ─── R3: no shell-quoted messages in the release script ────────────────────
// execSync + JSON.stringify mangled multi-line messages into literal \n\n
// once already. Messages travel as spawnSync/execFileSync argv arrays only.
function ruleNoShellQuoting() {
  const src = read(RELEASE_SCRIPT);
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (/\bexecSync\s*\(/.test(line) && auditOptOut(lines, i) === null) {
      report(RELEASE_SCRIPT, i + 1, "release-execsync",
        "execSync in the release script — messages and paths must travel as argv arrays (execFileSync/spawnSync), never through a shell.");
    }
  });
}

// ─── R4: the dev-only exclusion step sits between read-tree and commit ─────
// Removing it silently starts shipping CLAUDE.md (and every other dev-only
// doc) to the public mirror.
function ruleExclusionStep() {
  const src = read(RELEASE_SCRIPT);
  // Quoted forms so the doc comment's prose mentions don't count — only the
  // actual argv invocations do.
  const readTree = src.indexOf('"read-tree"');
  const rmCached = src.indexOf('"rm", "--cached"');
  const commitTree = src.indexOf('"commit-tree"');
  if (!src.includes("readPublicExcludes")) {
    report(RELEASE_SCRIPT, 0, "exclusion-step-missing",
      "the release script no longer consumes .public-exclude — dev-only files would ship.");
  }
  if (!(readTree !== -1 && rmCached > readTree && commitTree > rmCached)) {
    report(RELEASE_SCRIPT, 0, "exclusion-step-order",
      "the .public-exclude stripping must happen after the tree is read and before the commit is created.");
  }
  if (!/leaked/.test(src)) {
    report(RELEASE_SCRIPT, 0, "exclusion-step-verify",
      "the post-strip verification (release tree re-listed and checked against the exclusion list) is gone.");
  }
}

// ─── R5: param routes that touch the filesystem go through safe-slug ───────
// The B4 path-traversal guard. A route may opt out with an AUDIT comment
// when its param is a registry key rather than a path component.
function ruleSafeSlug() {
  for (const file of trackedFiles()) {
    if (!/^src\/server\/routes\/[^/]+\.ts$/.test(file)) continue;
    const src = read(file);
    if (!src.includes("req.params")) continue;
    if (!/path\.join|readFile|writeFile|unlink|readdir/.test(src)) continue;
    if (src.includes("safe-slug")) continue;
    const lines = src.split("\n");
    let optedOut = false;
    lines.forEach((line, i) => {
      if (/req\.params/.test(line) && auditOptOut(lines, i) !== null) optedOut = true;
    });
    if (!optedOut) {
      report(file, 0, "safe-slug-missing",
        "route reads req.params and touches the filesystem without safe-slug — path-traversal guard (or an AUDIT: justification) required.");
    }
  }
}

// ─── R6: security middleware installs before the routes ────────────────────
//
// Matched with a whitespace-tolerant regex rather than indexOf, so wrapping the
// call across lines does not read as "the middleware was deleted". A contract
// that fails on formatting trains people to edit the contract.
function ruleMiddlewareOrder() {
  const file = "src/server/index.ts";
  const src = read(file);
  const at = name => {
    const m = new RegExp("app\\.use\\(\\s*" + name + "\\(").exec(src);
    return m ? m.index : -1;
  };
  const guard = at("hostOriginGuard");
  const headers = at("securityHeaders");
  const routes = src.indexOf("registerRoutes(app)");
  if (guard === -1 || headers === -1) {
    report(file, 0, "middleware-missing",
      "hostOriginGuard / securityHeaders are no longer installed — DNS-rebinding and header hardening are gone.");
  } else if (!(guard < routes && headers < routes)) {
    report(file, 0, "middleware-order",
      "hostOriginGuard and securityHeaders must be app.use()d BEFORE registerRoutes so every endpoint is covered.");
  }
}

// ─── R6b: the guard's cross-origin exemption stays narrow ──────────────────
//
// `crossOriginPaths` turns OFF the guard's cross-origin write check for the
// paths it names. Exactly three belong there — the MCP endpoint and the two
// pre-trust pairing calls — because a GM's Foundry page is not served from
// loopback and cannot reach Vault otherwise.
//
// The pairing APPROVAL route must never join them. A page that can both request
// and approve its own pairing has paired itself, with no human in the loop at
// all. This encodes that as a contract instead of a comment, because the
// tempting fix when something 403s is to add one more path to the list.
const ALLOWED_CROSS_ORIGIN_PATHS = new Set([
  "/mcp",
  "/api/mcp/pair/request",
  "/api/mcp/pair/status",
]);

function ruleCrossOriginExemption() {
  const file = "src/server/index.ts";
  const src = read(file);
  const block = /crossOriginPaths\s*:\s*\[([^\]]*)\]/.exec(src);
  if (!block) return; // absent is the safe state — nothing is exempted

  const listed = [...block[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map(m => m[1]);
  for (const path of listed) {
    if (!ALLOWED_CROSS_ORIGIN_PATHS.has(path)) {
      report(file, 0, "cross-origin-exemption",
        `"${path}" is exempted from the cross-origin write check but is not one of the three pre-trust ` +
        `paths. If this is the pairing approval route, a hostile page can now approve its own pairing.`);
    }
  }
}

// ─── R7: secret-holding stores write atomically ────────────────────────────
//
// Asserts the write goes through util/atomic-write.ts, NOT merely that a
// ".tmp" and a "renameSync" appear. The original rule checked exactly that,
// and passed the code that corrupted settings.json in practice: a FIXED temp
// filename is atomic against a crash but not against a second process, which
// truncates the same temp file mid-write. Only the shared helper's unique
// temp name closes that.
function ruleAtomicWrites() {
  for (const file of ["src/server/keys/store.ts", "src/server/config/settings.ts"]) {
    const src = read(file);
    if (!src.includes("writeFileAtomic(")) {
      report(file, 0, "atomic-write",
        "writes no longer go through util/atomic-write.ts — a concurrent writer can tear the file on disk.");
    }
    if (/\.tmp["`]/.test(src)) {
      report(file, 0, "atomic-write",
        "a hand-rolled temp path is back; a fixed temp filename is not safe against a second process.");
    }
  }
  // The helper itself must keep the property the rule above is buying.
  const helper = read("src/server/util/atomic-write.ts");
  if (!/randomBytes/.test(helper)) {
    report("src/server/util/atomic-write.ts", 0, "atomic-write",
      "the temp filename is no longer unique — two processes writing the same target can interleave.");
  }
}

// ─── R8: env-file writes reject control characters ─────────────────────────
function ruleEnvFileInjection() {
  const src = read("src/server/util/env-file.ts");
  if (!/\[\\r\\n\\x00\]/.test(src)) {
    report("src/server/util/env-file.ts", 0, "env-injection-guard",
      "the [\\r\\n\\x00] value rejection is gone — a crafted value could inject extra env lines.");
  }
}

// ─── R9: audit-patterns and the runtime scrubber stay in sync ──────────────
// Same shapes, scanned at rest by the audit scripts and at log time by
// scrub-secrets.ts. Compared by regex SOURCE so drift is caught exactly.
function ruleScrubberSync() {
  const scrub = read("src/server/util/scrub-secrets.ts");
  for (const { name, re } of PATTERNS) {
    if (!scrub.includes(re.source)) {
      report("src/server/util/scrub-secrets.ts", 0, "scrubber-drift",
        `the ${name} pattern (${re.source.slice(0, 40)}…) exists in audit-patterns.mjs but not in the runtime scrubber — add it to both or neither.`);
    }
  }
}

// ─── R10: shell:true never appears without a justification ─────────────────
function ruleShellTrue() {
  for (const file of trackedFiles()) {
    if (!/\.(ts|tsx|mjs|js)$/.test(file)) continue;
    if (file === "scripts/audit-security-contracts.mjs") continue;
    const lines = read(file).split("\n");
    lines.forEach((line, i) => {
      // \r first: `.` never matches a carriage return, so on a CRLF checkout
      // an un-stripped \r stops the comment-stripper from reaching $ and
      // full-line comments would be scanned as code.
      const code = line.replace(/\r$/, "").replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
      if (/\bshell\s*:\s*true\b/.test(code) && auditOptOut(lines, i) === null) {
        report(file, i + 1, "shell-true",
          "spawn with shell:true and no AUDIT: justification — argv arrays through a shell re-open the injection class.");
      }
    });
  }
}

// ─── R11: .gitignore runtime/secret entries stay root-anchored ─────────────
// An un-anchored `knowledge/` once silently hid src/server/knowledge from
// git for several commits. Build outputs and globals are conventionally
// unanchored; everything else must start with `/`.
const GITIGNORE_UNANCHORED_ALLOW = new Set([
  "node_modules/", "build/", "dist/", "coverage/", ".DS_Store", "*.log",
  // .env* is deliberately UN-anchored: its failure direction is inverted.
  // Over-ignoring a nested .env is safer, not a bug — unlike a runtime-state
  // dir name, where an unanchored entry can hide tracked source from git.
  ".env*",
]);
function ruleGitignoreAnchors() {
  const lines = read(".gitignore").split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    if (line.startsWith("/") || line.startsWith("!")) return;
    if (GITIGNORE_UNANCHORED_ALLOW.has(line)) return;
    if (line.startsWith("*")) return; // extension globs apply everywhere by design
    report(".gitignore", i + 1, "gitignore-anchor",
      `"${line}" is not root-anchored — a same-named path anywhere in the tree gets silently hidden. Prefix with "/" (or add to the allowlist in this rule if it is genuinely a build-output convention).`);
  });
}

// ─── R12: bare AUDIT: markers fail loudly ──────────────────────────────────
function ruleBareAudit() {
  for (const file of trackedFiles()) {
    if (!/\.(ts|tsx|mjs|js)$/.test(file)) continue;
    if (file === "scripts/audit-security-contracts.mjs") continue;
    const lines = read(file).split("\n");
    lines.forEach((line, i) => {
      if (/\/\/\s*AUDIT:\s*$/.test(line)) {
        report(file, i + 1, "bare-audit",
          "bare AUDIT: marker with no reason — an exception must carry its justification.");
      }
    });
  }
}

// ─── R14: no Discord invite in a public-bound file ─────────────────────────
// CLAUDE.md states this as an absolute rule, and until now nothing enforced
// it — the invite had been removed from every public-bound file by hand and
// stayed gone only for as long as somebody remembered why. A server invite
// names a place the maintainer can be found and answered in, and its
// moderator list is a second identity surface the repo does not control.
//
// Scoped to what actually ships: files stripped by `.public-exclude` may say
// `discord.gg` (CLAUDE.md has to, to state the rule), and so may this file.
// When a community Discord launches, allowlist that one invite here rather
// than deleting the rule.
function ruleNoDiscordInvite() {
  const excludes = readPublicExcludes(REPO_ROOT);
  for (const file of trackedFiles()) {
    if (file === "scripts/audit-security-contracts.mjs") continue;
    if (excludes.some(e => isPublicExcluded(file, e))) continue;
    const lines = read(file).split("\n");
    lines.forEach((line, i) => {
      if (/discord\.gg/i.test(line)) {
        report(file, i + 1, "discord-invite",
          "a discord.gg invite in a file that ships publicly. CLAUDE.md forbids this until a community Discord launches — remove it, or allowlist the launched invite in this rule.");
      }
    });
  }
}

// ─── R15: the Claude Code spawn keeps its tool gate and env allowlist ──────
// This spawn runs a prompt built from lore plus untrusted asker text — the
// Foundry and MCP surfaces can pin provider: "claude-code", so a player's
// question reaches it. `claude -p` with no gating flags registers the HOST
// user's entire tool surface (Bash, Write, WebFetch, cron, and every tool from
// their personal MCP servers), governed only by a ~/.claude allowlist that
// Vault does not set and cannot read.
//
// Verified against the real CLI, not assumed: without --disallowedTools an
// injected instruction read a canary file; with it, the read was refused. Also
// verified that an EMPTY --allowedTools does NOT deny-all — it was ignored and
// the canary was read anyway — which is why the gate is a denylist.
function ruleClaudeCodeSandbox() {
  const file = "src/server/llm/claude-code-cli.ts";
  const raw = read(file);
  if (!raw) return;

  // Match against a COMMENT-STRIPPED copy. Tightening these to call-site
  // regexes was not enough on its own: this file's comments reproduce the call
  // sites almost verbatim, so `stdin ... .write(` was satisfied by a doc
  // comment even with the real call deleted, and "--strict-mcp-config" or
  // "--disallowedTools", DENIED_TOOLS survived removal whenever the change
  // left a comment behind — which is what a careful refactor does. Verified by
  // mutating each one and re-running.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // Match the CALL SITES, not the vocabulary. This file is heavily commented
  // and every one of these identifiers also appears in its prose — `mkdtemp`
  // twice in doc comments, `childEnvForCli` in its own export declaration — so
  // a substring check passed on a source where both controls had been deleted
  // and only the comments describing them remained. Verified by mutating the
  // source and re-running: all four substrings survived, the rule reported
  // nothing. Same lesson CLAUDE.md records for atomic-write.ts: assert that
  // the helper is USED, not that its name appears.
  const required = [
    [/(^|[^\w"'])"--disallowedTools"\s*,\s*\n?\s*DENIED_TOOLS\b/m,
      "the tool denylist is no longer passed to the spawn. An injected instruction in a player's question then reaches whatever that host user happened to pre-approve in ~/.claude."],
    [/"--strict-mcp-config"/,
      "the MCP gate is gone. The host user's own MCP servers register as tools on a call carrying untrusted text, and a denylist cannot enumerate them — their names come from that user's config."],
    [/env:\s*childEnvForCli\(/,
      "the child environment is no longer allowlisted at the spawn. dotenv has loaded .env.local into process.env by this point, so a pass-through hands the CLI DISCORD_TOKEN and every provider key."],
    [/await\s+fs\.mkdtemp\(/,
      "the per-call temp directory is no longer created. A fixed name in a world-writable /tmp lets another local account pre-create it and plant a CLAUDE.md, which the CLI reads as instructions before it reads the prompt."],
    [/cwd:\s*sandboxCwd\b/,
      "the sandbox directory is created but not USED as the child's cwd, so the child inherits the server's own — the repo root, holding .env.local and .git."],
  ];
  for (const [pattern, why] of required) {
    if (!pattern.test(src)) {
      report(file, null, "claude-code-sandbox", String(pattern) + " does not match: " + why);
    }
  }

  // DENIED_TOOLS is joined into one argv value, so an emptied array still
  // produces a syntactically valid `--disallowedTools ""` that denies nothing
  // while every name above still matches.
  const denied = /const DENIED_TOOLS = \[([\s\S]*?)\]\s*\.join/.exec(src);
  if (!denied) {
    report(file, null, "claude-code-sandbox",
      "DENIED_TOOLS is no longer a joined array literal — the denylist cannot be checked for content.");
  } else {
    for (const needed of ['"Bash"', '"Write"', '"WebFetch"', '"*"']) {
      if (!denied[1].includes(needed)) {
        report(file, null, "claude-code-sandbox",
          `DENIED_TOOLS no longer contains ${needed}. An emptied or trimmed denylist passes a valid flag that denies nothing.`);
      }
    }
  }

  // The prompt is untrusted text; it must reach the child on stdin, never argv,
  // or shell:true on the Windows shim becomes an injection surface.
  if (!/stdin[\s\S]{0,80}?\.write\(/.test(src)) {
    report(file, null, "claude-code-sandbox",
      "the prompt no longer reaches the child via stdin. On Windows the spawn uses shell:true, so a prompt on argv is a shell-injection surface.");
  }

  // Catch the tempting "simplification". An empty allowlist reads like
  // "nothing is permitted" and is not: the real CLI ignored it.
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (line.includes('"--allowedTools"') && !auditOptOut(lines, i)) {
      report(file, i + 1, "claude-code-sandbox",
        "--allowedTools in the spawn. An empty allowlist does NOT deny-all (verified against the real CLI), and a non-empty one re-opens the surface. Use --disallowedTools.");
    }
  });
}

// ─── R16: chat surfaces do not broadcast operator error detail ─────────────
// formatAdapterError names the provider, the model, the env var to set and the
// local CLI that is missing. In the dashboard — loopback-only, GM-operated —
// that is exactly right. In a Discord channel or a Foundry chat log it is a
// broadcast to the table, and it happened: a provider's empty-response error
// was posted verbatim, disclosing the exact model id and the configured output
// ceiling to every player present.
//
// So the audience picks the formatter. Chat-bound code paths use
// chatSafeError; the dashboard keeps the detail; both log the full error to
// Vault's own console, which is where the GM looks.
function ruleChatErrorDisclosure() {
  const CHAT_SURFACES = ["src/server/surfaces/discord.ts", "src/server/mcp/server.ts"];
  for (const file of CHAT_SURFACES) {
    const src = read(file);
    if (!src) continue;
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      if (line.includes("formatAdapterError") && !auditOptOut(lines, i)) {
        report(file, i + 1, "chat-error-disclosure",
          "formatAdapterError in a chat surface. That message names the provider, the model and the env var to set — a channel or a Foundry chat log is the wrong audience for all three. Use chatSafeError and log the detail to the console.");
      }
    });
  }
  // The chat-safe formatter must still exist and be reachable, or the rule
  // above is satisfied by deleting the guard rather than keeping it.
  if (!read("src/server/llm/registry.ts").includes("export function chatSafeError")) {
    report("src/server/llm/registry.ts", null, "chat-error-disclosure",
      "chatSafeError is gone. Chat surfaces have nothing safe to call, so error detail will reach the table again.");
  }
}

// ─── Run everything ────────────────────────────────────────────────────────

rulePinnedIdentity();
ruleReleaseEnv();
ruleNoShellQuoting();
ruleExclusionStep();
ruleSafeSlug();
ruleMiddlewareOrder();
ruleCrossOriginExemption();
ruleAtomicWrites();
ruleEnvFileInjection();
ruleScrubberSync();
ruleShellTrue();
ruleGitignoreAnchors();
ruleBareAudit();
ruleNoDiscordInvite();
ruleClaudeCodeSandbox();
ruleChatErrorDisclosure();

if (findings.length === 0) {
  console.log("✓ Security contracts hold (16 rules).");
  process.exit(0);
}

console.error(`✗ ${findings.length} security-contract violation(s):\n`);
for (const f of findings) {
  console.error(`  ${f.file}${f.lineNum ? `:${f.lineNum}` : ""}  [${f.ruleId}]`);
  console.error(`    ${f.message}\n`);
}
console.error("Each rule encodes an invariant from CLAUDE.md. Restore the invariant, or");
console.error("— for a deliberate exception — add `// AUDIT: <reason>` within 3 lines.");
process.exit(1);
