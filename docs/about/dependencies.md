# Dependencies — Tusk's Vault

← Back to [README](../../README.md)

Every package Vault depends on, with the rationale for each choice. Skip to [Why these choices](#why-these-choices) for the high-level reasoning.

---

<details class="docs-section" open>
<summary><h2>🧱 Base runtime dependencies</h2></summary>
<div class="docs-section-body">

These are required for Vault to run at all.

| Package | Version | Purpose |
|---|---|---|
| `@google/genai` | `^1.29.0` | Gemini provider adapter ([`src/server/llm/gemini.ts`](../../src/server/llm/gemini.ts)) |
| `openai` | `^6.38.0` | OpenRouter speaks the OpenAI wire format, so its adapter uses this SDK ([`src/server/llm/openrouter.ts`](../../src/server/llm/openrouter.ts)). Claude and GPT models are reached through it. |
| `discord.js` | `^14.25.1` | Discord bot client ([`src/server/discord/`](../../src/server/discord)) |
| `@huggingface/transformers` | `^4.2.0` | Local MiniLM embeddings on CPU ([`src/server/embeddings/`](../../src/server/embeddings)) |
| `express` | `^4.21.2` | HTTP server framework |
| `vite` | `^6.2.0` | Build tool + dev server (also used as Express middleware in dev) |
| `@vitejs/plugin-react` | `^5.0.4` | Vite plugin for React JSX/TSX |
| `@tailwindcss/vite` | `^4.1.14` | Tailwind CSS 4 build integration |
| `react` | `^19.0.0` | Dashboard UI |
| `react-dom` | `^19.0.0` | Dashboard UI |
| `react-markdown` | `^10.1.0` | Renders these very docs inside the dashboard's Help → Docs viewer ([`DocsViewer.tsx`](../../src/components/DocsViewer.tsx)) |
| `remark-gfm` | `^4.0.1` | GitHub-flavoured markdown extensions for `react-markdown` — tables and task lists |
| `rehype-raw` | `^7.0.0` | Lets the same renderer handle the raw `<details class="docs-section">` blocks these pages are written with |
| `motion` | `^12.23.24` | UI animations (transitions, candle loader) |
| `lucide-react` | `^0.546.0` | Icon set used throughout the dashboard |
| `mammoth` | `^1.12.0` | DOCX → text extraction |
| `pdf-parse` | `^2.4.5` | PDF → text extraction |
| `multer` | `^2.1.1` | Multipart file upload handling |
| `dotenv` | `^17.2.3` | Load `.env.local` at boot |
| `env-paths` | `^3.0.0` | Cross-platform per-user config dir resolver — where the encrypted key store, personas, the OpenRouter catalogue cache, the model-availability cache, the paired-MCP-client list and the vault map live |
| `@types/multer` | `^2.1.0` | Type definitions for multer |

</div>
</details>

<details class="docs-section">
<summary><h2>🔌 What the optional connections need</h2></summary>
<div class="docs-section-body">

**None.** Every provider Vault talks to reuses what is already here.

| Connection | Extra dependencies pulled in | Why |
|---|---|---|
| 🦙 **Ollama** | None | A raw `fetch` to `http://localhost:11434` — no SDK required. See [`src/server/llm/ollama.ts`](../../src/server/llm/ollama.ts). |
| 🌐 **OpenRouter** | None | Wire-compatible with the OpenAI API, so it uses the `openai` SDK already in the base table — the one dependency, shared. See [`src/server/llm/openrouter.ts`](../../src/server/llm/openrouter.ts). |
| 🖥 **Claude Code** | None | A child process running the CLI you already installed. |
| 🎭 **Personas** | None | Reuses the existing LLM adapter (via the active provider) for the AI-generate feature. Stores user personas in a plain JSON file via the base `fs` module. |
| 🎲 **Foundry VTT / MCP** | None | The bridge is hand-rolled JSON-RPC over Express — no MCP SDK. Three tools and one transport is less code than wiring a framework in. See [Foundry contract](../tooling/foundry-contract.md). |

A new provider that needs a package should declare it in this table and add it to `package.json` like any other dependency. Vault deliberately does not lazy-load packages at runtime — that would make whether a feature works depend on whether the network is up.

</div>
</details>

<details class="docs-section">
<summary><h2>🧪 Dev dependencies</h2></summary>
<div class="docs-section-body">

| Package | Version | Purpose |
|---|---|---|
| `@types/express` | `^4.17.21` | Type definitions for Express |
| `@types/node` | `^22.14.0` | Type definitions for Node |
| `autoprefixer` | `^10.4.21` | PostCSS plugin for vendor prefixes |
| `rehype-stringify` | `^10.0.1` | Markdown → HTML, for the docs-site builder (maintainer tooling, not shipped) |
| `remark-parse` | `^11.0.0` | Markdown parser for the same builder |
| `remark-rehype` | `^11.1.2` | Bridges the markdown AST to the HTML AST for the same builder |
| `tailwindcss` | `^4.1.14` | CSS framework |
| `tsx` | `^4.21.0` | TypeScript runner — `npm start` is `tsx server.ts` |
| `typescript` | `~5.8.2` | TypeScript compiler (`npm run lint` = `tsc --noEmit`) |
| `unified` | `^11.0.5` | The pipeline the three remark/rehype plugins above plug into |
| `vite` | `^6.2.0` | Build tool (also listed in runtime — npm handles the dedup) |
| `vitest` | `^4.1.6` | Test runner. `npm test` covers `src/server/**/*.test.ts` (path resolution, key store, prompt assembly, the Obsidian reader's read-only guard, atomic writes, security middleware, the MCP bridge and its Foundry wire contract), `src/lib/**/*.test.ts`, and `scripts/**/*.test.mjs`. `fileParallelism` is off so files run sequentially. |

</div>
</details>

<details class="docs-section">
<summary><h2>🤔 Why these choices</h2></summary>
<div class="docs-section-body">

### Why only two cloud LLM SDKs?

Vault is **LLM-agnostic by design** (see [How it's built](how-its-built.md)), and the obvious shape is one SDK per lab. It isn't the one used: OpenRouter reaches Claude and GPT on one key and one bill, so a per-lab SDK would add a dependency, a key slot and a bill to reach models already reachable.

What is left is `@google/genai` and `openai`. Gemini keeps a direct slot deliberately: it is meaningfully cheaper called directly than through the aggregator. `openai` stays because OpenRouter *is* the OpenAI wire format — that dependency is not drift, it is the OpenRouter client.

Note that both are ordinary top-level imports, not lazy ones: [`registry.ts`](../../src/server/llm/registry.ts) imports every adapter statically, so both SDKs load at boot regardless of which provider you have selected. That is the deliberate trade — see the note on lazy-loading in the connections table above. Adding a fifth provider is one new file in [`src/server/llm/`](../../src/server/llm) implementing the `LlmAdapter` interface, plus a registry entry.

### Why MiniLM via `@huggingface/transformers`?

We needed local, CPU-only embeddings. MiniLM-L6-v2 produces 384-dim vectors that are good enough for short-question semantic matching (clarification retrieval), runs in ~50–300 ms per embedding on CPU, and weighs ~25 MB cached. The transformers.js port lets us run it without a Python sidecar.

Alternatives considered: OpenAI embeddings (cloud round-trip, conflicts with local-first), `e5-small` (similar quality, larger model), `nomic-embed-text` (better quality, much larger). MiniLM hit the sweet spot — clarifications are short, the embedding step has to be invisible to the user, and we can't assume a GPU.

### Why pdf-parse + mammoth?

- **`pdf-parse`** takes a Buffer — exactly what the multer upload flow and
  `fs.readFileSync` already hand it — and needs no system-level PDF library, so
  an install doesn't turn into a Poppler hunt.
- **`mammoth`** flattens complex tables, nested lists and embedded styles down
  to plain text, which is the only thing an LLM prompt wants from a DOCX.

Both are widely used and actively maintained. Neither sandboxes documents, and
neither has a per-parse timeout or size cap today — see
[Known issues](../troubleshooting/known-issues.md).

### Why no database?

The data model is **small files per concern**, split by what should survive what.

Campaign state lives inside the resolved `Tusks-Lore/` folder, so it survives a clean reinstall of the app:

- `clarifications.json` + `clarifications.embeddings.json` — corrections + vectors.
- `lore_gaps.json` — unanswered questions.

Per-install state lives in the platform config directory — per-machine, rebuildable, and deliberately *not* following a campaign folder around:

- `keys.enc` + `keys.salt` — your keys, encrypted (AES-256-GCM; the key is scrypt-derived from a stable machine identity). [`keys/crypto.ts`](../../src/server/keys/crypto.ts) is honest about what this is: obfuscation with authenticated encryption, not high-grade cryptography — anything running as you on this machine can derive the key. What it defeats is the realistic threat, a backup client or a support bundle hoovering up a file literally named `api-keys.json`.
- `personas.user.json` — your own personas.
- The OpenRouter model-catalogue cache, the model-availability cache, and the per-vault AI vault map.
- `mcp-clients.json` — paired MCP clients, tokens stored only as SHA-256 hashes.

And `settings.json` stays at the repo root for dashboard preferences. Every one of these writes goes through the atomic-write helper, and on POSIX the key store is `0o600`.

For a single-user local-first tool with hundreds (not millions) of records, JSON files are simpler, debuggable by hand, and have zero runtime cost. If your campaign grows to thousands of lore documents and the JSON stores get unwieldy, that's the trigger to add a real vector store / SQLite layer — tracked in the [Roadmap](../../ROADMAP.md).

### Why Vite as Express middleware in dev?

Vault runs **one HTTP server**, not two. Vite is registered as Express middleware in development mode (see [`src/server/index.ts`](../../src/server/index.ts)), so the React dashboard and the bot's HTTP API share the same socket. That means:

- No "Vite is on 5173, server is on 3000, why don't they talk to each other" confusion.
- One port to bind, one port to fall back from.
- Same `fetch("/api/...")` from the dashboard, no proxy config.

In production (`npm run build`), Vite drops out entirely — Express serves the prebuilt static bundle directly.

### Why React 19 + Tailwind 4 + Motion?

- **React 19** for the concurrent rendering improvements (matters for the multi-tab dashboard).
- **Tailwind 4** because it's the current major and the new Vite plugin is meaningfully faster.
- **Motion** (the rebranded Framer Motion) for the candle loaders, rune dividers, and panel transitions — light footprint, mature API.

If you're forking and want a smaller bundle, the easiest cut is Motion. The fantasy animations are 60-80 KB; the rest of the dashboard is bone-stock React.

### Why `env-paths`?

Per-install state — the encrypted key store, personas, caches — lives in a cross-platform per-user config directory rather than the repo. Vault asks for `envPaths("tusks-vault", { suffix: "" }).config` (the empty suffix drops env-paths' default `-nodejs`), which resolves to:
- Windows: `%APPDATA%\tusks-vault\Config\`
- macOS: `~/Library/Preferences/tusks-vault/`
- Linux: `$XDG_CONFIG_HOME/tusks-vault/`, defaulting to `~/.config/tusks-vault/`

This means your keys and settings survive a `git clean -fdx` and can't be accidentally committed. `TUSKS_VAULT_CONFIG_DIR` overrides it, for a portable install or a test.

</div>
</details>

<details class="docs-section">
<summary><h2>🔒 Security posture of dependencies</h2></summary>
<div class="docs-section-body">

**Check, don't assume.** A "0 vulnerabilities as of this commit" line in a doc is true for about a week — advisories land against dependencies that have not changed. The current answer is whatever `npm audit --omit=dev` says on your checkout, and the honest thing for this page to record is the *policy*, not a number that quietly rots.

The gate is `--omit=dev --audit-level=high`: shipping dependencies only, high and critical only. Dev-only tooling is excluded deliberately — a vulnerability in a test runner is not a vulnerability in what a user installs — and low/moderate findings in a locally-bound, single-user tool do not justify a forced major bump.

Hardening practices:

- `npm audit --omit=dev --audit-level=high` runs in [CI](../../.github/workflows/ci.yml) on every push to `main` and every pull request against it, scoped to the dependencies that actually ship.
- The two highest-risk parsers (`pdf-parse`, `mammoth`) will gain resource limits (timeout + size cap) in a future release — tracked in [Known issues](../troubleshooting/known-issues.md).
- The in-app updater already uses `git pull --ff-only` (refuses on diverged branches) and deliberately never runs `npm install` in-process — see [Setup.md → Updating](../getting-started/installation.md).

See [SECURITY.md](../../SECURITY.md) for the full threat model.

</div>
</details>

<details class="docs-section">
<summary><h2>🧮 What's NOT in here</h2></summary>
<div class="docs-section-body">

Choices we explicitly avoided, with reasons:

- **No telemetry / analytics SDK.** Local-first means no phone-home.
- **No vector-database client** (Pinecone / Weaviate / Chroma). Embeddings live in a 384-dim Float32Array on disk; we don't need a service.
- **No auth library** (yet). The dashboard is loopback-only by default. A one-time setup token is on the roadmap for users who need LAN exposure.
- **No state management library** (Redux / Zustand). The dashboard is small enough that `useState` + lifted state + a custom hook or two (`usePersonas`) is fine.
- **No CSS-in-JS runtime.** Tailwind classes handle 100% of the styling.
- **No PostgreSQL / SQLite / Redis.** See "Why no database" above.
- **No Python sidecar.** Embeddings run via `@huggingface/transformers` in pure JS. A future feature might want one — offline speech-to-text, say — but it would be optional and never required to run Vault.

</div>
</details>

---

## Next steps

- 🧠 [Architecture — how it all fits together](how-its-built.md)
- 🔌 [Providers — the four connections](../getting-started/choosing-a-provider.md)
- 🔐 [Privacy — what each dep does and doesn't see](../security/privacy.md)
- 🐞 [Issues — known limitations](../troubleshooting/known-issues.md)
