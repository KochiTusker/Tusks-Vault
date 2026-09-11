# Security Policy

Thanks for taking the time to help keep Tusk's Vault safe.

This document does three things:

1. Lays out a **lightweight STRIDE threat model** so you know what Vault defends against, what it doesn't, and how to plug the gaps in your own environment.
2. Explains the **per-feature security impact** — a few features change the threat surface in small, specific ways worth knowing.
3. Describes how to **report a vulnerability** privately.

For the **data** answer — what leaves your machine, every host it can reach, and
where each secret is stored — see [Privacy](docs/security/privacy.md).

---

## 👥 Who this is built for

Tusk's Vault assumes **you know and trust the people who can ask it questions.**

It is built for:

- a **small private Discord** — your table's own server, invite-only, people you
  actually game with;
- a **Foundry game with trusted players**, where the GM decides who may ask at
  all.

It is **not** built for a public Discord, an open community server, a
convention table of strangers, or any game where you would hesitate to hand
someone your campaign notes directly. There is no per-player lore scoping yet:
anyone allowed to ask can reach the whole corpus, and a determined player can
do so deliberately. That is a current design limit, stated plainly rather than
buried — *What a prompt injection can and cannot do*, below, spells out exactly
what it means at the table.

The Foundry surface and its player ceiling both ship **off**. Discord ships on but
inert — it does nothing until you supply a bot token, and *which* channels the bot
can read is decided in Discord, not here. A bot that cannot see a channel never
receives the question at all.

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

<details class="docs-section" open>
<summary><h2>🧪 What a prompt injection can and cannot do</h2></summary>
<div class="docs-section-body">

Sooner or later somebody at your table will type *"ignore all previous
instructions"* at the bot. This is the honest answer to what happens next, split
into the part that is structurally prevented and the part that is not.

### What it cannot do: touch your machine

No connection Vault ships gives the model tools. Gemini, OpenRouter and Ollama
are text in, text out — there is no function-calling surface for an injected
instruction to reach in the first place.

The Claude Code connection is the one that runs a real CLI on your machine, and
it is invoked with its tool surface denied outright: no filesystem, no shell, no
network, and none of your own MCP servers registered on a call that carries
untrusted text. The child environment is cut to infrastructure variables, so it
never holds your Discord token or your provider keys. Its working directory is a
fresh, unguessable temporary directory per call, removed afterwards; if no such
directory can be created the call fails rather than falling back to a shared
one.

This is verified rather than asserted, and the two halves are worth separating
because only one of them is a control.

**Enforced by the gate, and reproducible.** File reads (absolute, relative,
traversal, extended-length paths), file writes, shell execution, environment
disclosure, outbound network calls, MCP tool invocation and scheduled-task
persistence are refused because the tool surface is not there to reach. The
flags are pinned as a test contract — asserted at the call sites, not by
searching the file for their names — so they cannot be quietly removed. The
same checks were run against a host configuration that pre-approves every tool,
because a guarantee that only holds for careful users is not much of a
guarantee.

**Attempted, and declined by the model — which is judgement, not a boundary.**
Base64-obfuscated instructions, instructions planted *inside* a lore document,
forged claims of prior GM approval, and emotional-pressure framing were all
tried, and the archivist declined them. That is worth knowing and it is not a
guarantee: there is no gate behind those, only the model's reading of the
prompt, and a model's judgement is not a security boundary. The prompt is
structured to make them harder — the asker's question, and the text of
anything they attach, are quoted inside a per-request marker they cannot
predict, and a retrieved DM clarification counts as genuine only if it carries
that marker. A PDF sent to Gemini is the exception: it travels as a document
rather than as text, so it cannot be quoted, and the rules block covers it
instead. Treat resistance to forged *content* as mitigation, not closure.

Two honest limits on the enforced half: it covers the connections and CLI
version shipping today, and a future CLI release that adds a brand-new tool
name is not covered until the list is updated.

### What it can do: read your lore

This is the real exposure, and no amount of hardening removes it.

Your campaign material is *in* the prompt — that is how the bot answers at all.
So anyone allowed to ask can reach it, and they do not need a successful
injection to get there: retrieval happens before the model decides anything.

Three consequences worth stating plainly:

- **The player steers what gets retrieved.** Notes are selected by similarity to
  the question, and the player writes the question. Asking about a mystery pulls
  the notes about that mystery.
- **In Obsidian-vault mode, every prompt carries an index of the whole vault.** A
  one-line digest of every note travels with each question so the model knows
  what exists. That index doubles as a table of contents, and it tells a curious
  player exactly what to ask for next.
- **A refusal is not silence.** "I won't tell you who the traitor is" confirms
  that there is a traitor.

The bot's persona is **not** a security boundary. It will often decline — but
that is a model's judgement on the day, not a control, and a different phrasing
on a different day may get a different answer. Do not design a mystery around
the assumption that it will hold.

### What actually protects a mystery

- **Leave the Foundry player ceiling off.** It ships off, and it is the control
  that genuinely works. On Discord the equivalent is channel permissions: keep the
  bot out of channels your players can read.
- **Point Vault at a player-safe subset.** The lore folder and the Obsidian
  vault path both accept any directory, so a subtree that excludes your secrets
  is a real reduction in what can be reached.
- **Choose who may *ask*, not who may *see*.** Whispering an answer hides it from
  the table, not from the player who asked — see [Foundry VTT](docs/surfaces/foundry-vtt.md)
  for the full version of that trade-off.

Per-note visibility — marking material GM-only so it is excluded from both the
index and retrieval — is the actual fix, and it is tracked in
[ROADMAP.md](ROADMAP.md). Until it ships, *who may ask* is the whole of the
access model.

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
- **I — Information disclosure** — the CLI is invoked with its tool surface denied: no filesystem, shell or network tools, and `--strict-mcp-config` so the user's own MCP servers are never registered on a call carrying untrusted text. This does not depend on the user's own `~/.claude` allow-list, which Vault neither sets nor can read — the denial was checked against a configuration that pre-approves everything. The child environment is an **allow-list** of infrastructure variables: by the time this runs `.env.local` has been loaded into the process environment, so passing it through would have handed the child `DISCORD_TOKEN` and every provider key. The working directory is a fresh `mkdtemp` directory per call, removed afterwards — a fixed name in a world-writable `/tmp` would let another account on a shared machine pre-create it and leave instructions the CLI reads before it reads the prompt.
- **Billing** — not a STRIDE category, but the one that costs money: the environment allow-list excludes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` by construction. A stray key otherwise takes precedence inside the CLI and bills the API instead of the subscription you already pay for.

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
