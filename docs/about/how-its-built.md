# How it's built — Tusk's Vault

← Back to [README](../../README.md)

How Tusk's Vault turns "an `@`-mention in Discord" into a cited, source-grounded answer.

This page is written to be readable by both seasoned developers and people who've never opened a TypeScript file. Code paths are linked inline so you can dive in where you want; the prose stands on its own if you don't.

---

<details class="docs-section" open>
<summary><h2>🧠 The retrieval pipeline at a glance</h2></summary>
<div class="docs-section-body">

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│  Your Discord server          Tusk's Vault  (runs on your PC, 100%)    │
│                                                                        │
│   ┌──────────────┐             ┌──────────────────────────────────┐    │
│   │ Player:      │             │  Discord bot listener            │    │
│   │ @Tusk who is │ ─────────►  │      │                           │    │
│   │ Ser Alric?   │             │      ▼                           │    │
│   └──────────────┘             │  Semantic-match clarifications   │    │
│                                │  (local MiniLM, on CPU)          │    │
│                                │      │                           │    │
│                                │      ▼                           │    │
│                                │  Prompt assembly:                │    │
│                                │  - your Tusks-Lore/ documents    │    │
│                                │  - top-K relevant clarifications │    │
│                                │  - canonical 7-rule block        │    │
│                                │  - the player's question         │    │
│                                │      │                           │    │
│                                │      ▼                           │    │
│                                │  LLM adapter (you pick one):     │    │
│                                │  OpenRouter · Gemini ·           │    │
│                                │  Claude Code · Ollama            │    │
│                                │      │                           │    │
│   ┌──────────────┐             │      ▼                           │    │
│   │ Tusk: "Ser   │             │  Cited, source-grounded answer   │    │
│   │ Alric was…   │ ◄─────────  │  + lore-gap detector             │    │
│   │ [Session 3]" │             │                                  │    │
│   └──────────────┘             └──────────────────────────────────┘    │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

</div>
</details>

<details class="docs-section">
<summary><h2>🚶 Walkthrough — what happens when a player @-mentions the bot</h2></summary>
<div class="docs-section-body">

Step by step, in the order it actually happens.

1. **A player types `@Tusk who is Ser Alric Vane?` in Discord.**
   The bot's Discord.js client receives a `messageCreate` event — wired up in [src/server/surfaces/discord.ts](../../src/server/surfaces/discord.ts).

2. **The question is embedded locally** using MiniLM-L6-v2 running on your CPU (no cloud round-trip). The embedding is compared against every stored DM clarification to find any that are *semantically* close — "what happened to Alric?" matches "Ser Alric Vane died in session 6" even though the words are different. See [src/server/clarifications/retrieve.ts](../../src/server/clarifications/retrieve.ts).

3. **The prompt is assembled**, in [src/server/prompt/assemble.ts](../../src/server/prompt/assemble.ts), from four parts:

   - **System instruction** — the base Chronicler prompt, or the active persona.
     The seven core rules are guaranteed by `CANONICAL_RULES_BLOCK` in
     [system.ts](../../src/server/prompt/system.ts): if a custom persona drops
     them, the block is force-appended at assembly time.
   - **Lore corpus** — every readable file under `Tusks-Lore/`, via the
     recursive walker in [loader.ts](../../src/server/knowledge/loader.ts),
     each under a `[SOURCE DOCUMENT: <relative path>]` header so the model
     knows which filename to cite.
     - Hard ceiling of `KB_CHAR_LIMIT` (500,000 characters), cut on a
       **document boundary**, never mid-sentence.
     - The header then lists only the documents that survived, and names the
       ones that didn't — a header promising a file the model never received
       hands it a citation for free.
     - On an Obsidian vault with the map switched on, this part is instead a
       one-line digest of every note plus the full text of the notes the
       question selected. See [Obsidian vault](../lore/obsidian-vault.md).
   - **Top-K clarifications** — only those whose embedding matched the question
     above a similarity threshold.
   - **The player's question.**

   The corpus is marked `cacheable` and the clarifications deliberately are not: the lore bytes are stable between questions, so a caching adapter can put its prompt-cache breakpoint there and re-bill only the per-question tail.

4. **The chosen LLM adapter is called.**

   - **Which provider** is resolved by [registry.ts](../../src/server/llm/registry.ts). The active key in the Key Vault outranks the saved `provider` setting, and a surface may pin a provider and model of its own on top — so the chat surfaces can answer on a Claude Code subscription while the dashboard keeps using whatever is globally selected.
   - **Which code** is one file per provider in [src/server/llm/](../../src/server/llm), each implementing the same `LlmAdapter` interface. Every *cloud* adapter wraps its call in the shared 429 / transient-5xx backoff in [retry.ts](../../src/server/llm/retry.ts).
   - **Adding a provider** is therefore one new file plus a registry entry.

5. **The reply comes back**, with a citation marker on every factual claim:

   - `[filename]` — content from one of your `Tusks-Lore/` documents (path relative to the lore root, e.g. `Sessions/Curse-of-Strahd/Session-03.docx`).
   - `[clarification: ID]` — a DM clarification you recorded via the dashboard.
   - `[D&D 5e]` — a generic 5th-edition rules answer (e.g. "rolls a d20").
   - `[speculation]` — only when Speculative Mode is on, for character-driven guesses.

   The dashboard's `includeReferences` toggle strips markers from the *displayed* text only. The model still emitted them, and still used them to ground the answer.

6. **The lore-gap detector** scans the reply for the canonical refusal phrase (*"I am unsure about this detail. I have recorded this as a lore gap for the DM to clarify."*). If found, the question lands in the dashboard's **Lore Gaps** tab so the DM can answer it once and have it remembered forever via the clarification-embedding pipeline.

   A *model decline* is checked first and is deliberately not a lore gap: [src/server/llm/refusal.ts](../../src/server/llm/refusal.ts) recognises "I won't answer that" as its own thing. It says nothing about the chronicle being incomplete, so recording it would put a question in the DM's queue that no clarification could ever close. The decline is still shown to the asker — it's the best explanation available — just labelled rather than filed.

7. **The reply is posted back to Discord.** Over-2000-character replies get chunked on a regex boundary so the Discord message limit doesn't truncate citations.

That's the whole flow — no database, no vector store, no remote services beyond the LLM provider itself.

</div>
</details>

<details class="docs-section">
<summary><h2>🏗️ What ships in the box</h2></summary>
<div class="docs-section-body">

Vault has two layers that are easy to mix up but worth keeping separate in your head.

### The base product (what runs out of the box)

- **HTTP server** — Express 4 + Vite middleware on a single socket. No separate frontend dev server.
- **Four LLM connections, of which two take a key** — Gemini and OpenRouter (keyed), Claude Code and Ollama (keyless). Each is one file in `src/server/llm/<provider>.ts` implementing the same `LlmAdapter` interface.
- **Discord bot** — discord.js 14, one client, one message listener.
- **Chat surfaces** — three of them (`discord`, `foundry`, `mcp`), all answering through one transport-agnostic `ask()` core in `src/server/chat/`. A surface owns presentation and nothing else; two surfaces that disagreed about what the bot knows would be two different bots. Each can be switched off independently, and each can pin its own provider and model.
- **MCP bridge** — an authenticated Streamable-HTTP endpoint at `/mcp` exposing three tools (`ask_lore`, `search_lore`, `list_sources`). Built for the Foundry module, but any MCP client can use it. See [Foundry VTT](../surfaces/foundry-vtt.md) and the wire contract in [Foundry contract](../tooling/foundry-contract.md).
- **Local embeddings** — `@huggingface/transformers` running MiniLM-L6-v2 on CPU.
- **Knowledge loader** — recursive walk over `Tusks-Lore/`, with parsers for PDF, DOCX, MD, plain text, JSON, YAML, CSV, TSV, HTML, RTF. An Obsidian vault can be read instead, strictly read-only.
- **Source-grounded prompt** — canonical seven-rule block, force-appended at assembly time.
- **Security middleware** — host/origin guard, security headers, secret scrubbing, safe-slug guards, loopback-only gating on the routes that act on the host, atomic-write key store.
- **Persistence** — JSON files on disk, split by what should survive what: campaign state inside the resolved `Tusks-Lore/` folder (so it survives clean reinstalls), per-install state in the platform config directory, and `settings.json` at the repo root.
- **Dashboard** — React 19 + Tailwind CSS 4 served by the same Express process.

None of this is optional and none of it is a plugin — a fresh clone gives you all of the above. The one thing fetched at runtime is the MiniLM model weights (~25 MB, once, on first boot); no *code* is ever downloaded outside `git pull` / `npm install`.

### There is no add-on system

An early design had one, and it was cut before the first release. Personas
and local LLMs were to be "add-ons" installed from the dashboard — except
there was nothing to install: every one of them shipped in the clone already,
so "installing" could only ever write a marker file. The mechanism existed to
gate features that were always present.

So there is no module layer. **Personas** ship as an ordinary feature, and
**Ollama** is a connection the picker probes: it is either answering on its
port or it is not, which is a live question rather than a module to opt into.
Neither has anything to install, so neither needs a switch. Re-introducing a
gate for something always present is the mistake to avoid here.

Foundry VTT integration has since shipped — the module lives in its own
repository and talks to the MCP bridge above. Planned work (in-PDF OCR, live
Tomes push, player-vs-GM lore scoping) is on the [Roadmap](../../ROADMAP.md).

</div>
</details>

<details class="docs-section">
<summary><h2>⚙️ The four guarantees worth knowing</h2></summary>
<div class="docs-section-body">

### 1. Source-grounded by design

Off-corpus questions don't get a guess. They get the canonical refusal — **"I am unsure about this detail. I have recorded this as a lore gap for the DM to clarify."** — and the question lands in the dashboard's Lore Gaps tab.

The seven-rule block in [src/server/prompt/system.ts](../../src/server/prompt/system.ts) is **structurally enforced**: `buildSystemInstruction()` checks the finished prompt with `hasCanonicalRules()` and appends `CANONICAL_RULES_BLOCK` whenever any of the seven is missing, so a user-authored persona that dropped them still gets them. There's no configuration toggle that turns citation off.

### 2. Semantic clarification memory

When a DM corrects an answer via the dashboard ("Actually, Ser Alric Vane died in session 6"), the correction is embedded **locally** using MiniLM-L6-v2 on the CPU — no cloud round-trip. The embedding lives next to the clarification in `clarifications.embeddings.json` (base64-encoded 384-dim Float32 vectors). The next time anyone asks anything semantically similar, the matching clarification gets pulled into the prompt automatically. You only have to teach Vault a fact once.

### 3. LLM-agnostic

Pick the model. Switch any time from the dashboard — no restart, no config file edit.

- **Almost everything** → OpenRouter. One key reaches Claude, GPT, Llama and a few hundred others, on one bill.
- **Free tier, and cheap after it** → Gemini, called directly because it is cheaper that way than through an aggregator.
- **Already paying for Claude Pro or Max** → Claude Code, through the CLI you are already signed into. No API key, no extra bill.
- **Zero ongoing cost, runs offline** → Ollama.

There are no direct Anthropic or OpenAI key slots: OpenRouter reaches the same models on one key and one bill, so three credentials to talk to two labs would be work with nothing to show for it.

The adapter pattern lives in [`src/server/llm/`](../../src/server/llm) — each provider implements the same `LlmAdapter` interface, and the registry resolves a single adapter per call. Adding a provider is one new file in that folder plus a registry entry.

Details: **[Choosing a provider](../getting-started/choosing-a-provider.md)**.

### 4. Models are tested, not trusted

A model id in a dropdown is a claim, not a capability. Vault probes the
connection you picked — under the same routing policy a real question uses, or
it would report a model reachable and then fail every question — and reports
what that key can actually call.

How to run a probe and read the result:
**[Choosing a provider](../getting-started/choosing-a-provider.md)**.
</div>
</details>

<details class="docs-section">
<summary><h2>🛠️ Tech stack</h2></summary>
<div class="docs-section-body">

Built with TypeScript end-to-end, ESM-only. **No database** — everything persists as JSON files on disk, none of it ever committed (repo-root state is gitignored; per-install state lives outside the repo entirely).

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ |
| HTTP server | Express 4 + Vite middleware (shared HTTP socket — no separate Vite port to collide on) |
| Dashboard UI | React 19 + Tailwind CSS 4 + Motion |
| Discord bot | discord.js 14 |
| LLM providers | `@google/genai` for Gemini. `openai` for OpenRouter — it is wire-compatible with the OpenAI API, so the SDK is the honest client for it. Ollama goes over raw `fetch`. Claude Code is a child process. |
| Local embeddings | `@huggingface/transformers` running MiniLM-L6-v2 on CPU |
| Document ingestion | `pdf-parse` (PDF), `mammoth` (DOCX), built-in for text/markdown/HTML/RTF/JSON/YAML/CSV/TSV |
| File uploads | `multer` |
| Per-user config dir | `env-paths` (cross-platform per-user config directory) |

Full dependency rationale lives in [Dependencies](dependencies.md).

</div>
</details>

<details class="docs-section">
<summary><h2>📁 Where each concern lives in the source tree</h2></summary>
<div class="docs-section-body">

```
src/
├── App.tsx                           Dashboard UI (React)
├── components/
│   ├── panels/                       One panel per dashboard card / tab
│   │   ├── KeyVaultPanel.tsx         Settings → API keys
│   │   ├── ObsidianVaultPanel.tsx    Lore → lore-source picker + vault map
│   │   ├── PersonasPanel.tsx         Settings → Personas
│   │   ├── SurfacesPanel.tsx         Home → per-surface switches + MCP pairing
│   │   └── ...
│   └── ...                           Other reusable UI components
├── hooks/                            Dashboard data hooks (usePersonas, …)
├── lib/                              Pure helpers shared with the frontend (and unit-tested)
└── server/
    ├── index.ts                      Express bootstrap (security middleware first, then routes)
    ├── routes/                       HTTP API endpoints — one file per concern
    ├── chat/                         Transport-agnostic ask() core, surface registry, queue
    ├── surfaces/                     Per-surface plumbing (discord.ts: mentions, typing, chunking)
    ├── mcp/                          Streamable-HTTP bridge at /mcp — auth, pairing, tools
    ├── llm/                          Adapters + registry
    │   ├── openrouter*.ts            OpenRouter adapter, catalogue cache, pricing
    │   ├── gemini.ts                 Gemini adapter
    │   ├── claude-code*.ts           Claude Code CLI wrapper + adapter
    │   ├── ollama.ts                 Local models over HTTP
    │   ├── model-probe.ts            One-token availability probe + its cache
    │   ├── refusal.ts                Tells a model decline apart from a lore gap
    │   └── retry.ts                  Shared 429 / 5xx backoff
    ├── discord/                      Bot client + token inspection (the handler lives in surfaces/)
    ├── knowledge/                    Lore loading
    │   ├── loader.ts                 Tusks-Lore/ tree walker + document parsers
    │   └── obsidian/                 Obsidian vault source (READ-ONLY) + the vault map
    ├── embeddings/                   MiniLM embedding + cosine similarity
    ├── clarifications/               DM corrections + semantic retrieval
    ├── lore-gaps/                    Unanswered-question log
    ├── prompt/                       System prompt + canonical rules + prompt assembly
    ├── keys/                         API key vault (encrypted, atomic-write store)
    ├── personas/                     Voice presets + user-authored personas
    ├── forge/                        Builds an Obsidian vault out of the lore documents (verbatim, never invents)
    ├── diagnose/                     Scrubbed diagnostic bundle → .diagnose/latest.md
    ├── integrations/                 Tusk's Tomes companion-app detector + Tusks-Lore folder helper
    ├── config/                       Settings, paths, env loader, per-user app data
    └── util/                         Updater, port-fallback, browser-open, env-file writer,
                                       host-origin-guard, security-headers, loopback-only,
                                       safe-slug, atomic-write, scrub-secrets, log capture
```

`server.ts` at the repo root is a six-line entry point that imports `src/server/index.ts` and calls `startServer()`.

</div>
</details>

<details class="docs-section">
<summary><h2>📚 The shared `Tusks-Lore/` folder</h2></summary>
<div class="docs-section-body">

Vault's "knowledge directory" — the folder Vault scans for lore documents — resolves at boot via this priority order (implemented in [src/server/config/paths.ts](../../src/server/config/paths.ts)):

1. **`TUSKS_VAULT_LORE_PATH`** env var (highest priority — useful for tests and unusual layouts).
2. **`loreFolderPath`** in `settings.json` (set from the dashboard).
3. **Sibling `../Tusks-Lore/`** directory (recommended; auto-detected).
4. **Repo-local `<repo>/Lore/`** — the fallback when none of the above resolve, so a fresh clone has somewhere to put lore before you make a sibling folder.

The recommended layout drops a `Tusks-Lore/` folder next to the app:

```
parent-dir/
├── Tusks-Tomes/        (optional companion — see tomes.md)
├── Tusks-Vault/        (this repo)
└── Tusks-Lore/         ← knowledge directory
    ├── tusks-lore.json (Tomes' consolidated glossary + speaker map;
    │                    filtered from generic ingestion)
    └── Sessions/       (Tomes writes session chronicles here)
        └── <campaign>/
            ├── Session-NN-DATE-full.docx
            └── Session-NN-DATE-condensed.docx
```

The dashboard's **Lore** tab has a **"Tusks-Lore folder"** card with a *"Create Tusks-Lore folder"* button — it `mkdir`s the sibling + the `Sessions/` subdir + a starter README, and prompts you to restart so the boot-time probe picks the new location up. (If a sibling already exists the button offers to adopt it instead.)

Campaign-state files (`clarifications.json`, `clarifications.embeddings.json`, `lore_gaps.json`, `logs/tusks-vault.log`) also live inside the resolved lore folder, so a clean reinstall of Vault keeps all your work. If they are ever found at the repo root instead, boot moves them in once.

Vault walks the entire `Tusks-Lore/` tree recursively, so files at any depth surface as lore — bounded at 5,000 files and 8 directory levels so a mis-pointed folder or a symlink loop can't run away. Some files are skipped from generic ingestion, matched **by basename at any depth** rather than only at the root:

- **Tomes-managed metadata** — `tusks-lore.json`, and the legacy `glossary.json` / `speakers.json`. Reserved for grounding-context use in a future Vault release, not generic document scanning.
- **Vault's own state, written into the lore folder** — `clarifications.json`, `clarifications.embeddings.json`, `lore_gaps.json`, `tusks-vault.log`, and the root `logs/` directory. Left unfiltered the bot reads its own list of unanswered questions back as campaign canon, and then cites it.
- **Conventional non-lore** — READMEs, dotfiles and dot-directories, `_`-prefixed files.
- **A vault Vault forged itself**, marked by a `.forged-by-tusks-vault` file in its root. Ingesting it would count every fact twice: once as the source document, again as the note derived from it.

</div>
</details>

<details class="docs-section">
<summary><h2>🔌 The Tusk's Tomes integration</h2></summary>
<div class="docs-section-body">

Tomes writes session chronicles into `Tusks-Lore/Sessions/<campaign>/`; Vault
walks that tree recursively and surfaces them like any other document. No sync
step, no import, no coupling in either direction — the shared folder is the
whole interface.

Setup and the recommended layout: **[Tusk's Tomes](../lore/tusks-tomes.md)**.

---

</div>
</details>

<details class="docs-section">
<summary><h2>📡 Network calls</h2></summary>
<div class="docs-section-body">

Every host this app can reach, when, and what the request carries is a table on
**[Privacy](../security/privacy.md#-every-host-it-can-reach)**. It lives there
because "what leaves my machine" is a privacy question, and keeping one copy
means the answer cannot drift between two pages.

The one architectural note worth repeating here: `grep -rn 'fetch(' src/` finds
every HTTP call the app makes. The updater is the only omission, because it
goes out through `git`.

---

</div>
</details>

<details class="docs-section">
<summary><h2>🛡️ Security middleware</h2></summary>
<div class="docs-section-body">

Two middlewares are installed before the route table, so they cover every
endpoint including the Vite dev server's:

- **`host-origin-guard.ts`** — DNS-rebinding defence. Rejects requests whose
  `Host` is not a loopback literal, and non-GET writes from a non-loopback
  `Origin`/`Referer`.
- **`security-headers.ts`** — clickjacking, MIME-sniff, referrer policy, and a
  CSP that limits scripts to the app's own origin. (There is a stricter policy
  in the file intended for a bundled production build, but nothing sets
  `NODE_ENV=production` today, so every install serves the permissive one. It
  allows inline scripts and `eval`, which Vite needs; it still blocks
  third-party origins. Listed in
  [known issues](../troubleshooting/known-issues.md).)

What each one does and does not defend against, with the exceptions the MCP
bridge needs, is in **[SECURITY.md](../../SECURITY.md)**.

---

</div>
</details>

<details class="docs-section">
<summary><h2>🧰 Diagnostics endpoint</h2></summary>
<div class="docs-section-body">

`GET /api/diagnostics` reports the absolute path, existence, size and mtime of
every file holding your state — including *which* lore-resolution rule won.
Loopback-only, like every route that acts on the host.

Full list of what it covers:
**[Privacy → verify your setup](../security/privacy.md)**.

---

</div>
</details>

## Next steps

- 🔌 [Providers — the four connections, in detail →](../getting-started/choosing-a-provider.md)
- 📚 [Obsidian vault as a lore source →](../lore/obsidian-vault.md)
- 🎲 [Use cases — what people actually ask →](use-cases.md)
- 📦 [Dependencies — every package and why →](dependencies.md)
- 🔐 [Privacy & security →](../security/privacy.md) · [STRIDE threat model →](../../SECURITY.md)
- 🗺️ [Roadmap →](../../ROADMAP.md)
