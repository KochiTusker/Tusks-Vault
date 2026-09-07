# Privacy — what leaves your machine

← Back to [README](../../README.md)

Tusk's Vault is local-first by design. This page is the **data** answer: what
stays on your machine, what travels over the network, where every secret is
stored, and what that does *not* protect you from.

For the **threat model** — what counts as a vulnerability here, the STRIDE
breakdown per feature, and how to report one — see
[Security policy](../../SECURITY.md).

---

<details class="docs-section">
<summary><h2>🔐 The guarantees</h2></summary>
<div class="docs-section-body">

Each claim first, then the part that qualifies it. Nothing here is a promise
the code does not keep.

**A fresh clone holds zero credentials, zero lore, zero personal state.**
Source and templates only — see the next section for the file-by-file split.

**Your documents never leave your machine as files.** What travels per
question is the *text* the prompt carries: your question, the clarifications
that matched it, and your lore.
→ *The caveat that matters:* with the default folder source there is no
per-question retrieval, so the **whole parsed corpus** goes into every prompt,
truncated at a document boundary past 500,000 characters (`KB_CHAR_LIMIT`).
The [Obsidian source](../lore/obsidian-vault.md) narrows, and only once a vault
outgrows the budget. **Assume your provider sees your campaign.**

**The dashboard binds to `127.0.0.1`.** Other devices on your LAN cannot reach
it.

→ *If you set `HOST=0.0.0.0`:*

- The API does not authenticate requests.
- `host-origin-guard.ts` enforces its loopback `Host` check **only while the
  bind is loopback** — a non-loopback bind switches that check off rather than
  widening it.
- The cross-origin `Origin` check on writes still runs.
- The routes that act on the host — the Claude Code spawn, choosing a lore
  folder, updating, the diagnostics bundle, the log, approving an MCP pairing,
  and writing a persona's prompt — stay gated on the peer address by
  `loopbackOnly()`.
- Two writes are **not** gated, on purpose: `/api/keys` and `/api/discord`. On
  a widened bind, anyone who can reach the dashboard can set an API key or the
  bot token. That is the trade `HOST=0.0.0.0` asks you to accept, and it is why
  the recommendation is to widen it only on a network you control.

**API keys are encrypted at rest** — AES-256-GCM in your per-user config
directory, key derived by scrypt from a machine identity. Masked in every
response.

→ *Honest framing, and `keys/crypto.ts` says the same:* this is obfuscation with
authenticated encryption, not high-grade cryptography. The salt sits beside the
ciphertext, and anything running as you can derive the key. What it defeats is a
backup client or support bundle scooping up a readable key file — a likelier
path to a leaked key than a local attacker.

**Embeddings run locally**, via
[MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2). Your
clarification text is never sent anywhere to be embedded — though a
clarification that matches a question is then quoted into that question's
prompt, and reaches your provider the way your lore does.

**No telemetry, no analytics, no phone-home.** Every host this app can reach is
listed in the next section, so you can check the list against the code.

**OpenRouter requests pin a zero-data-retention floor** — `zdr: true` and
`data_collection: deny` on every call, including `model-probe.ts`, or a model
would test reachable and then fail every real question. It is why most `:free`
variants are unavailable: they run on hosts that keep prompts.
→ *The one way past it* is deliberately awkward: an opt-in recorded **per model
id**, visible everywhere that model is shown, revoked automatically when you
pick a different model.

**You can audit every byte.** ~29,000 lines of TypeScript, plus ~9,700 of tests
sitting next to the code they cover.

---

</div>
</details>

<details class="docs-section">
<summary><h2>🌐 Every host it can reach</h2></summary>
<div class="docs-section-body">

`grep -rn 'fetch(' src/` finds every HTTP call in the app. The only one it
misses is the updater, which goes out through `git`.

| When | Where | Carries |
|---|---|---|
| Per question | Discord's gateway | The mention and the reply |
| Per question | Your chosen provider's API | Question, system prompt, matched clarifications, lore |
| Per question, if a file is attached | Discord's CDN | Downloads the attachment to parse it |
| Model browser, keyless | OpenRouter catalogue + host-policy directory | Nothing. Cached 24 h |
| Model browser, ≤ once a day | `kochitusker.github.io/…/grades.json` | Nothing — a static file, no key, no query string, no identifier |
| Once, first boot | Hugging Face | Downloads MiniLM (~25 MB), then cached forever |
| When you update | GitHub, via `git fetch` / `pull --ff-only` | The same traffic a manual `git pull` makes |
| Every dashboard load | `fonts.googleapis.com` / `gstatic.com` | Your IP, User-Agent, referring page |
| **Never** | Ollama | Loopback-only, enforced by the SSRF guard in `routes/settings.ts` |

Two of those deserve a note.

- **The grades feed** exists so a model graded after your version shipped still
  shows a grade. If it fails you get the cached copy, then the grades your build
  shipped with — nothing breaks, nothing retries in the background.
- **The fonts** are a plain `@import` on the first line of `src/index.css`: the
  one third-party request the dashboard makes on its own, and it happens before
  you configure any provider. If that bothers you — reasonably — delete that
  line and the dashboard falls back to system fonts.

---

</div>
</details>

<details class="docs-section">
<summary><h2>📂 What's in a fresh clone vs. what's created at runtime</h2></summary>
<div class="docs-section-body">


### A fresh clone contains (~357 tracked files)

Source code, setup scripts, the launcher, and configuration **templates only**. Nothing in this list contains personal data or credentials:

- Source code (`src/`, `server.ts`)
- Installer, setup + launcher scripts (`install-tusks-vault.bat` / `.sh`, `setup.bat`, `setup.sh`, `run.bat`, `run.sh`) and the uninstaller (`uninstall.bat`, `uninstall.ps1`, `uninstall.sh`)
- The updater script (`scripts/update.mjs`)
- `.env.example` — env-var template, no values
- `Lore/README.md` — placeholder README explaining the lore folder (the actual documents go in a sibling `Tusks-Lore/` directory; see [How it's built](../about/how-its-built.md#-the-shared-tusks-lore-folder) for details)
- Standard files (license, README, docs, package files, tsconfig, etc.)

Verify the count yourself with `git ls-files | wc -l`; it moves with every release, so treat the figure as an order of magnitude rather than a checksum.

### Files created at runtime, on your machine, gitignored

These files appear during use and never get pushed. They land in three places — the repo, your resolved lore folder, and your per-user config directory (`env-paths`' `tusks-vault` config location, overridable with `TUSKS_VAULT_CONFIG_DIR`). Which one a file lands in is a deliberate choice: campaign state follows the campaign, per-install state stays with the install.

**In the repo:**

| File / folder | When it's created | What it holds |
|---|---|---|
| `node_modules/` | First `npm install` | Dependencies. |
| `node_modules/.tv-lockfile-snapshot` | After every successful install | Copy of `package-lock.json` from the last successful install. `run.bat` / `run.sh` use it to auto-detect "deps changed since last boot" and re-run `npm install` before launch (fixes `ERR_MODULE_NOT_FOUND` after `git pull`). |
| `models/` | First server boot | Local embedding model cache (~25 MB). |
| `.port-runtime` | Every server boot | The port the server actually bound to. |
| `.env.local` | When you save your Discord token | Discord App ID + Bot Token. |
| `settings.json` | When you save settings | Bot name, models, thresholds, surface toggles, etc. |
| `.diagnose/latest.md` | Automatically when a Discord reply errors; on demand via `POST /api/diagnostics/bundle` | Settings, lore-resolution state, git position and a scrubbed log tail. Keys appear only as 6-character SHA-256 fingerprints and lore *content* never appears — but it is written to be pasted into a chat window, so read it before you paste it. |
| `run.log` | Each `run.bat` invocation (optional) | A copy of the launcher's terminal output. |

**In your lore folder** — the sibling `Tusks-Lore/` if you have one, otherwise `<repo>/Lore/` — so campaign state survives a clean reinstall:

| File / folder | When it's created | What it holds |
|---|---|---|
| the folder itself | First "Create Tusks-Lore folder" click in the dashboard (or first dashboard upload, for the repo-local fallback) | Your campaign documents (PDFs, DOCX, MD, …), Tomes' `tusks-lore.json` metadata, Tomes-written session chronicles under `Sessions/<campaign>/`. |
| `clarifications.json` | When you record your first clarification | DM clarifications. |
| `clarifications.embeddings.json` | When the first clarification is embedded | Base64-encoded 384-dim vectors for semantic matching. |
| `lore_gaps.json` | When the bot first hits an off-corpus question | Questions the bot couldn't answer. |
| `logs/tusks-vault.log` | First server boot | The captured server log, run through the secret scrubber. |

**In your per-user config directory** — per-install, machine-bound or rebuildable, and deliberately *not* carried around with a campaign folder:

| File | When it's created | What it holds |
|---|---|---|
| `keys.enc` + `keys.salt` | When you add your first LLM key | Your provider keys, AES-256-GCM encrypted and machine-bound; written atomically, `0o600` on POSIX. Keys are never written to the repo. |
| `mcp-clients.json` | When you approve an MCP or Foundry pairing | One record per paired client: a SHA-256 hash of its bearer token (never the token), its origin, and which surface it speaks for. |
| `openrouter-models.json` | First time the model browser opens | The public OpenRouter catalogue, cached 24 h. Prices and capability flags — no account data. |
| `vault-map.<id>.json` | When you build an Obsidian vault map | One-line digests of your notes plus their embeddings. This is derived from your vault and reads like your vault; the vault itself is never written to. |

### Need to verify your setup?

Hit `GET /api/diagnostics` from the dashboard (or via curl) and you'll get a JSON report on the eight paths that hold your state — `keys.enc`, `.env.local`, `settings.json`, the two clarification files, `lore_gaps.json`, the resolved lore folder (with *which* resolution rule won), and the model cache — each with its absolute path, whether it exists, its size, and its last modified time. Useful for debugging "where did my settings go?" type questions.

---


</div>
</details>

<details class="docs-section">
<summary><h2>🛡️ What this does not protect you from</h2></summary>
<div class="docs-section-body">

The formal version lives in **[SECURITY.md](../../SECURITY.md)** — a STRIDE
table of what Vault does for you and what you should do, per-feature addenda
for Ollama, Claude Code, Obsidian, Foundry and personas, and the list of what
is still open. It is one page rather than two because a second copy of a
security posture is a copy that goes stale, and the stale one is the one
somebody trusts.

The short version, for a GM deciding whether to install:

- **Loopback is a machine boundary, not a user boundary.** A second account on
  the same box is inside it.
- **`HOST=0.0.0.0` widens trust, not just reach.** There is no auth in front of
  state-changing endpoints. Keep the default bind unless you trust every device
  on your network.
- **Players can pull more than they have discovered.** Vault answers from the
  whole corpus and has no notion of what your table has found. The
  `allowPlayers` ceiling is off by default, so a fresh install answers only the
  GM. See [Foundry VTT](../surfaces/foundry-vtt.md).
- **Document parsers are not sandboxed.** Don't drop PDFs from strangers into
  your lore folder.

---

</div>
</details>

<details class="docs-section">
<summary><h2>🔑 Where every secret lives</h2></summary>
<div class="docs-section-body">


| Secret | File | Format | Sent over the network to whom |
|---|---|---|---|
| LLM API keys | `keys.enc` + `keys.salt` in the per-user config dir | AES-256-GCM, machine-bound | Only to that provider's API, only when generating an answer that uses that key |
| Discord bot token | `.env.local` | Plaintext key=value | Only to Discord's gateway during bot login |
| MCP / Foundry bearer tokens | `mcp-clients.json` in the per-user config dir | SHA-256 hash only — the token itself is handed to the client once at pairing and never stored | Never sent by Vault. The paired client presents it back on each request |
| GitHub PAT (maintainer dev-mode updates only) | Nowhere — memory only, wiped on restart | — | Only to `api.github.com`, to verify the token reaches the private dev repo |
| MiniLM model weights | `models/` | HuggingFace cache | Downloaded once from huggingface.co, then offline forever |
| Your campaign documents | `Tusks-Lore/<files>` (or `<repo>/Lore/<files>`) | Whatever you dropped in — PDF, DOCX, MD, etc. | The parsed text goes to the LLM provider you chose for that query. With the folder source that is the whole corpus, every query, up to the 500 K-character cap. The files themselves are never uploaded |
| Your clarifications | `clarifications.json` + `.embeddings.json` in the lore folder | JSON + base64 Float32 | The embeddings never leave this machine — matching runs locally. A clarification that matches a question is quoted into that question's prompt, so it goes to the same provider the answer comes from |
| Your Obsidian vault | Wherever you keep it — Vault only ever reads it | Your own notes | To your provider, as prompt text: the whole vault while it fits the prompt budget, and above that the map's digest plus the notes a question selects. The vault is opened read-only, enforced by `readonly-guard.test.ts`, which scans the reader's own source for filesystem mutators |

Nothing in this table is sent to a Tusk's-Vault-controlled server. We don't run one.

---


</div>
</details>

<details class="docs-section">
<summary><h2>Next steps</h2></summary>
<div class="docs-section-body">


- 🐞 [Known issues + active hardening backlog](../troubleshooting/known-issues.md)
- 🧠 [How retrieval works under the hood](../about/how-its-built.md)
- 💸 [What it costs](../about/what-it-costs.md) — the pricing table that used to live on this page
- 🔌 [Choosing a provider](../getting-started/choosing-a-provider.md) — what each one sees
- 📦 [Dependencies and why each is here](../about/dependencies.md)


</div>
</details>
