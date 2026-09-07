# Security Policy

Thanks for taking the time to help keep Tusk's Vault safe.

This document does three things:

1. Lays out a **lightweight STRIDE threat model** so you know what Vault defends against, what it doesn't, and how to plug the gaps in your own environment.
2. Explains the **per-feature security impact** — a few features change the threat surface in small, specific ways worth knowing.
3. Describes how to **report a vulnerability** privately.

For the **data** answer — what leaves your machine, every host it can reach, and
where each secret is stored — see [Privacy](docs/security/privacy.md).

---

<details class="docs-section" open>
<summary><h2>🛡️ Lightweight STRIDE threat model (base product)</h2></summary>
<div class="docs-section-body">

Tusk's Vault is **a locally-installed application** that binds to `127.0.0.1` by default. It's not a hosted service — there's no public endpoint to attack, no shared database, no other users sharing your install. That assumption shapes everything below.

| Threat | What Vault does for you | What you should do |
|---|---|---|
| **S — Spoofing** | Default bind is `127.0.0.1`; the [host/origin guard](src/server/util/host-origin-guard.ts) refuses requests whose `Host` is not a loopback literal, and rejects non-GET writes whose `Origin`/`Referer` is non-loopback. | Don't flip `HOST=0.0.0.0` unless you fully trust your LAN — there's no auth yet, so widening the bind = widening trust. Be exact about the shape of that: a non-loopback bind switches the `Host` check **off** rather than widening it, and the `Origin` check only fires when an `Origin` or `Referer` is actually present — which is true of a browser and not of `curl`. What still holds against a headerless LAN client is `loopbackOnly()`, which reads the peer address, so that is the gate the host-acting routes are on. |
| **T — Tampering** | Atomic-write helper (`util/atomic-write.ts`) behind every key and settings write — unique temp name per call, then rename; `safe-slug` validator on every path-parameter route; `.env.local` writer refuses `\r` / `\n` / `\x00` injection. | Don't run untrusted scripts in this folder; keep `node_modules/` user-owned by **not** running the launcher as root. |
| **R — Repudiation** | Log capture with secret scrubbing (Anthropic / OpenAI / Gemini key shapes + Discord token shapes); clarifications + lore gaps are timestamped. | Keep `run.log` private if you ever attach it to a bug report — scrubbing is best-effort, not perfect. |
| **I — Information disclosure** | API keys are never returned to the dashboard in unmasked form; `0o600` mode on POSIX; loopback-only bind by default; CSP restricts `script-src` to `'self'`, so no third-party script can load; MiniLM embeddings run locally, never sent over the network. | API keys are encrypted at rest (AES-256-GCM), but the salt sits beside the ciphertext and the key is derived from `hostname::username::platform` — three usually-knowable values — so a backup that captures the whole config directory leaves scrypt as the only barrier. Treat that directory as sensitive. Don't drop hostile PDFs into `Tusks-Lore/` (no parse timeout yet). |
| **D — Denial of service** | Body-size limits per route (10 KB for IDs/flags, 200 KB for prose, 1 KB for one-shot triggers); 5 / min rate limit on the persona-generate endpoint; updater has a 5-minute wall-clock timeout. | Don't ingest hostile documents; `pdf-parse` / `mammoth` don't have parse-time bounds yet. |
| **E — Elevation of privilege** | Single-user model with no auth (intentional — the loopback bind is the access gate for most routes). The routes that act on the **host** rather than on data are gated harder, by `loopbackOnly()` on the peer address rather than on a header: spawning the Claude Code CLI, choosing which directory to read lore from (`/api/obsidian/*`, `/api/forge/*`, `/api/integrations/*`), the updater (`/api/updates/*`), which runs git and can restart the process, the MCP pairing-approval routes, and the routes that author a persona's prompt. **Not** in that set, deliberately: `/api/keys` and `/api/discord`, so under `HOST=0.0.0.0` a LAN peer can write API keys and the bot token — `.env.example` says so at the point where you widen the bind. Launcher refuses to run as root on POSIX. | Don't expose the dashboard publicly. If you must run on a shared machine, run under your own user account, not a service account. Note what `loopbackOnly()` costs under `HOST=0.0.0.0`: the Updates card stops working for LAN visitors, deliberately — updating is administration, and `npm run update` on the host still does it. |

### How to think about it

The default install is **as safe as the other software running on your machine**. The host/origin guard means an attacker would need to be either:
- A process already running on your machine as your user (in which case they already have your data), or
- Something on your LAN *after* you've explicitly widened the bind (in which case you've consented to trust those devices).

For a single DM running Vault on their personal laptop, that's the right tradeoff. For a shared host or a publicly-reachable server, the [Roadmap](ROADMAP.md) tracks the auth-token + signed-update work that would close the remaining gaps.

### What is still open

Named rather than implied, because a threat model that only lists wins is a
sales page.

- **Another user on the same machine.** Loopback is a machine boundary, not a
  user boundary. Anything that can open a socket to `127.0.0.1` reaches the
  API, and anything running *as you* can decrypt the key store outright.
- **A malicious browser tab while the dashboard is open.** Some endpoints
  accept `multipart/form-data` uploads that bypass CORS preflight. The
  host/origin guard catches the obvious cases and the CSP blocks third-party
  scripts, but don't browse hostile sites with the dashboard open.
- **A client you already paired to the MCP bridge.** A paired client can ask
  the archive anything. `/mcp` and the two pre-trust pairing calls are the only
  paths exempt from the cross-origin write check — three exact paths, never a
  prefix, and `/api/mcp/pair/approve` is deliberately not among them, because a
  page that could request *and* approve its own pairing has paired itself.
  Unpair anything you no longer recognise, under **Surfaces**.
- **A compromised upstream dependency.** The updater uses `git pull --ff-only`
  and never runs `npm install` in-process. Tag mode (`updaterTrack: "tag"`)
  refuses to advance without a `v<x.y.z>` tag rather than following every push
  to `main` — but be clear about the limit: that forces a deliberate tagging
  step, it does **not** verify a signature. GPG verification is a future
  enhancement, not a shipped one.

</div>
</details>

<details class="docs-section">
<summary><h2>🧩 Per-feature impact addenda</h2></summary>
<div class="docs-section-body">

A few features change the surface in a small, specific way. This section is the security-impact note for each.

### 🦙 Ollama

**Adds:** an outbound HTTP call to `http://localhost:11434` (or whichever loopback URL you configured) for every Discord query routed to Ollama.

**Threat-surface change:**
- **I — Information disclosure** — the matched snippets + question now travel to your local Ollama process instead of (or in addition to) the cloud provider. Ollama is "your other process running as your user" — same trust boundary as the rest of your machine.
- **S — Spoofing** — the [SSRF guard in `routes/settings.ts`](src/server/routes/settings.ts) restricts `ollamaBaseUrl` to **loopback literals only**. You cannot point Vault at a remote Ollama from the dashboard; you'd have to edit `settings.json` directly to bypass it (in which case you've made an explicit choice).
- **D — DoS** — Ollama runs as a separate process with its own resource limits; if it hangs, the LLM adapter surfaces a clear error message rather than blocking the bot indefinitely.

### 🖥 Claude Code

**Adds:** a child process on the host, running the user's own `claude` CLI.

**Threat-surface change:**
- **E — Elevation of privilege** — the endpoint that spawns it is `loopbackOnly`. Under the documented `HOST=0.0.0.0` option a LAN visitor reaches every other route by design; this one they must not. The gate checks the peer socket address, not a header.
- **T — Tampering** — the model id is the only request-derived value that reaches argv and is charset-validated before spawn (`shell:true` is required for the Windows `.cmd` shim, and Node concatenates argv into one shell string without escaping). The prompt — lore plus an untrusted Discord message — travels via stdin and never touches a shell.
- **I — Information disclosure** — the child's cwd is pinned to an empty temp directory, away from the repo. If the user has pre-approved tools in their own `~/.claude` config, a prompt-injected tool call sees an empty sandbox rather than `.git`, `.env.local`, or the source tree.
- **Billing** — not a STRIDE category, but the one that costs money: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` are stripped from the child environment case-insensitively. A stray key otherwise takes precedence inside the CLI and bills the API instead of the subscription.

### 📚 Obsidian vault as a lore source

**Adds:** reading an arbitrary directory the user names.

**Threat-surface change:**
- **E — Elevation of privilege** — every `/api/obsidian/*` and `/api/integrations/*` route is `loopbackOnly` (gated at the mount, so a route added later is covered the day it is added), as are the `loreSource`, `obsidianVaultPath` and `tomesSessionsPath` fields on `/api/settings`. Without that, a LAN visitor under `HOST=0.0.0.0` could point the vault at any directory and read it back through the map — a file-disclosure primitive.
- **T — Tampering** — the vault is read **strictly read-only**, enforced mechanically: a test scans the vault-reading module's own source for filesystem mutators and fails if one appears. The user's notes are work that may exist nowhere else.
- **I — Information disclosure** — derived data (the map, its embeddings) is written to the app's config directory, never beside the user's notes.

### 🎲 Foundry VTT / MCP bridge

**Adds:** an authenticated MCP endpoint (`/mcp`) plus three unauthenticated pre-trust routes (`/api/mcp/hello`, `/api/mcp/pair/request`, `/api/mcp/pair/status`) that must answer cross-origin, because the GM's Foundry page is not served from loopback.

**Threat-surface change:**
- **S — Spoofing** — a bearer token minted at pairing, stored only as a SHA-256 hash, compared with `crypto.timingSafeEqual`, never logged and never echoed in an error. Every stored client is compared against so the work done does not depend on which token was presented. A token is additionally bound to the origin it paired from, so one that leaked out of a browser does not work from another page that also paired.
- **E — Elevation of privilege** — two controls. The `Origin` allow-list is the set of origins that completed pairing: never a wildcard, never a value read from the request. The MCP transport spec makes this mandatory, and it is what stops a drive-by page, since a browser sets `Origin` itself and a page cannot forge it. Separately, the surface a credential speaks for (`foundry` vs `mcp`) is fixed at pairing, so a caller cannot pick its own policy by claiming a different one per request.
- **T — Tampering** — the global host/origin guard delegates its cross-origin *write* check for exactly three paths, listed individually rather than by prefix. The pairing **approval** route is deliberately not among them: a page that could both request and approve a pairing would have paired itself. A test asserts that approval is refused cross-origin.
- **I — Information disclosure** — `/api/mcp/hello` is the one unauthenticated probe and its payload is a contract: the app name, its version, the protocol revisions it speaks, and whether a pairing is already outstanding. Not which surfaces are enabled, not how much lore is loaded, nothing about the campaign. A test pins the exact field set.
- **D — DoS** — the pre-trust routes are rate-limited per peer address with separate budgets for reads and writes; pairing requests are capped tightly, status polls generously, because a client legitimately polls on a timer for the whole approval window. Answering is queued per surface with a per-asker cooldown checked before any work is done, so a held-down Enter key costs nothing.
- **Spoilers** — not a STRIDE category, and the one most likely to bite a real table: Foundry's chat log *is* the table, and Vault answers from the whole corpus with no notion of what has been revealed. Whisper mode bounds who sees an answer, not what a player can pull. The `allowPlayers` ceiling is off by default and [Foundry VTT](docs/surfaces/foundry-vtt.md) states the trade-off rather than implying whisper is a spoiler control.

### 🎭 Personas

**Adds:** user-editable system prompts stored in `<configDir>/personas.user.json`, plus the AI-generate endpoint that drafts new personas via the active LLM.

**Threat-surface change:**
- **T — Tampering** — a malicious system prompt could try to weaken citation rules. **Mitigation:** the canonical seven-rule block in [src/server/prompt/system.ts](src/server/prompt/system.ts) is force-appended at assembly time whenever a custom persona doesn't already contain all seven rules. Citation discipline is structurally enforced, not configurable away.
- **D — DoS** — the AI-generate endpoint hits a paid (or rate-limited free) LLM. **Mitigation:** in-memory token bucket caps the endpoint at 5 calls / min with a `Retry-After` response on overflow.
- **I — Information disclosure** — none beyond the base product; persona prompts go to the same LLM provider you've already chosen.

</div>
</details>

<details class="docs-section">
<summary><h2>📜 Scope of in-scope vulnerabilities</h2></summary>
<div class="docs-section-body">

The main classes of vulnerability we care about for this project:

- 🔓 **Local privilege issues** — e.g. a way for code running on the same machine but in a different user context to read the encrypted key store.
- 🌐 **LAN-exposure flaws** — if the user has set `HOST=0.0.0.0`, are there auth-bypass / SSRF / RCE issues another LAN device could exploit?
- 📦 **Supply-chain risks** — typo-squatted dependency, malicious update path, dependency with a known CVE we should pin around.
- 📜 **Prompt-injection escalation** — beyond "the LLM said something weird", a campaign-document injection that exfiltrates secrets, rewrites local files, or bypasses the canonical citation rules.
- 🔑 **Key-handling bugs** — the dashboard accidentally returning unmasked keys, logs containing tokens, the env-file writer accepting injection, etc.

**Out of scope:**

- The LLM occasionally hallucinating (use the lore-gap workflow).
- Issues that require an attacker to already have full shell access or physical access on the host.
- Social-engineering reports about the project owner.
- Cosmetic CSS / UX issues without a security impact.

</div>
</details>

<details class="docs-section">
<summary><h2>📣 Reporting a vulnerability</h2></summary>
<div class="docs-section-body">

**Please do not open a public GitHub issue for a security report.**

Use **GitHub's private vulnerability reporting** instead:

- Open [this repository's Security tab](https://github.com/KochiTusker/Tusks-Vault/security/advisories/new) and click **Report a vulnerability**.
- GitHub keeps the report private between you and the maintainers, and gives us a private fork to develop and review the fix in.
- Be specific, attach what you need to demonstrate the issue, and please don't post details publicly until a fix has landed.

This is currently the only supported private channel. A community Discord with a moderator-DM route is on the [roadmap](ROADMAP.md), and this section will be updated if it launches.

Include, where you can:

- A clear description of the issue and the impact you believe it has.
- Reproduction steps (commands, sample inputs, screenshots, video — anything that helps).
- Your environment (OS, Node version, branch / commit SHA).
- Any suggested mitigations or patches.

</div>
</details>

<details class="docs-section">
<summary><h2>⏱️ What to expect from us</h2></summary>
<div class="docs-section-body">

- **Acknowledgement** of your report within **72 hours**.
- A first **triage assessment** (likely severity, likely fix complexity) within **7 days**.
- For confirmed vulnerabilities: a fix landing on `main` and a coordinated public disclosure once users have had time to update. We'll keep you in the loop on the timeline.
- **Credit** in the release notes (unless you'd prefer to remain anonymous — just let us know).

If you don't hear back within a week, please add a comment to your own advisory thread — it is the only private channel this project has.

</div>
</details>

<details class="docs-section">
<summary><h2>🔧 Hardening notes for users</h2></summary>
<div class="docs-section-body">

A few quick things every Tusk's Vault user should know — distilled from [Privacy](docs/security/privacy.md):

- The dashboard binds to `127.0.0.1` by default. Only flip `HOST=0.0.0.0` if you trust everyone on your LAN.
- The key store (`keys.enc`) is encrypted at rest and machine-bound. It is still worth treating the config directory like a password-manager export — don't commit it (already gitignored), don't email it, don't paste it into a chat.
- The bot makes exactly two outbound network calls per query: Discord's gateway and your chosen LLM provider's API. There is no other phone-home.
- Update via the in-app updater or `npm run update` to pick up security fixes promptly — both refuse to clobber uncommitted local edits.
- If you use Ollama, make sure it is also bound to loopback (Ollama's `OLLAMA_HOST` env var; default behaviour is loopback already).

Thanks again for helping keep Tusk's Vault safe for everyone running it at their kitchen tables.

</div>
</details>
