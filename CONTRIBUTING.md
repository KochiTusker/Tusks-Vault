# Contributing to Tusk's Vault

First — thank you. Tusk's Vault is a community-shaped project, and the contributions that matter most aren't always code. There's a list below.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

<details class="docs-section">
<summary><h2>Ways to contribute (no code required)</h2></summary>
<div class="docs-section-body">


**You don't need to ship a pull request to make this project better.** A few of the most useful things anyone can do:

- 🐛 **File a bug.** Found something broken? [Open an issue](https://github.com/KochiTusker/Tusks-Vault/issues/new/choose). Include OS, Node version, the command you ran, and the error. Even a partial report helps.
- 💡 **Pitch a feature.** Roadmap items come from real DMs asking for real things. [Open a feature-request issue](https://github.com/KochiTusker/Tusks-Vault/issues/new/choose) — the situation you want solved matters more than the feature you have in mind.
- 📝 **Improve the docs.** Spotted a confusing step in the README or the setup walkthrough? Even one-sentence tweaks are welcome PRs.
- 🎨 **Design feedback.** The dashboard is heavily themed. If something reads wrong, looks broken, or is hard to use, screenshot it and tell us.
- 🌍 **Help translate.** A localised dashboard is on the wishlist — if you'd help with strings in another language, open an issue and say which language.
- 📣 **Spread the word.** ⭐ Star the repo, mention it to your DM friends, write a blog post or tweet about how it worked for your campaign.
- ☕ **Sponsor.** If the project saves your campaign night, [Buy me a coffee](https://buymeacoffee.com/kochitusker). One-off or recurring both welcome.

All of the above counts. None of it is optional or required.

---


</div>
</details>

<details class="docs-section">
<summary><h2>Contributing code</h2></summary>
<div class="docs-section-body">


### Before you start

For anything bigger than a small fix:

1. **Open an issue first** so we can agree on the approach before you write code. This saves you from sinking hours into a PR that needs a rewrite.
2. **Pick one thing.** PRs are easier to land when they do one thing. If you're tempted to fix five unrelated issues in one PR, split them.

For typo / docs / one-line fixes, skip step 1 and just open the PR.

### Setting up a dev environment

```sh
git clone https://github.com/KochiTusker/Tusks-Vault.git
cd Tusks-Vault
npm install
npm run dev    # starts the server + Vite middleware on http://localhost:3000
```

The server is a single TypeScript process running through `tsx` — no build step in dev. Frontend changes hot-reload through Vite middleware; backend changes need a server restart (`Ctrl+C` then `npm run dev`).

### Project layout

- [src/server/](src/server/) — backend. One concern per file.
  - `llm/` — provider adapters (Gemini, OpenRouter, Claude Code, Ollama). Adding a new provider = drop a file here that implements the same interface.
  - `routes/` — Express route handlers. One file per route group.
  - `knowledge/` — document loading and parsing.
  - `embeddings/` — local MiniLM embedding pipeline for clarifications.
  - `discord/` — bot client and message handler.
  - `prompt/` — system prompt + prompt assembly.
  - `config/` — env, paths, settings persistence.
- [src/](src/) (outside `server/`) — React 19 dashboard. Component files live in `src/components/`.
- [server.ts](server.ts) — entrypoint that boots both Express and Vite.
- [scripts/update.mjs](scripts/update.mjs) — the in-app updater.

### Style + conventions

- **TypeScript throughout.** Avoid `any`. Run `npm run lint` (which is `tsc --noEmit`) before pushing.
- **No new dependencies without discussion.** We keep the dep tree small on purpose. If you need one, mention it in your issue.
- **Match the file's existing style.** No new formatters or linters as part of feature PRs.
- **Comments**: only when the *why* is non-obvious. Don't narrate what the code already says.
- **Commits**: small, focused, with a one-line subject and (optional) longer body explaining *why*. Match the style of existing commits in `git log`.

### Adding a new LLM provider (base-product, cloud)

1. Create `src/server/llm/<name>.ts` that exports the same `LlmAdapter` interface as `gemini.ts` / `openrouter.ts` / `ollama.ts`, and wrap the API call in `withRetry` from `llm/retry.ts`.
2. Register it in `src/server/llm/registry.ts`.
3. Add a Key Vault entry in the dashboard (`src/types/keys.ts` for the type, `src/components/panels/KeyVaultPanel.tsx` for the UI) if the provider needs an API key.
4. Update the relevant docs ([How it's built](docs/about/how-its-built.md), [Dependencies](docs/about/dependencies.md)) and the `.env.example` file.

### Adding a new provider

There is no plugin system to learn. Vault had one; it gated features that were
always present, so it was removed. A provider is just a file.

1. Add `src/server/llm/<name>.ts` exporting a factory that returns an `LlmAdapter` — the interface is in [src/server/llm/types.ts](src/server/llm/types.ts).
2. Wrap the outbound call in `withRetry` from [src/server/llm/retry.ts](src/server/llm/retry.ts), so rate limits behave like every other provider's.
3. Add a case to the switch in [src/server/llm/registry.ts](src/server/llm/registry.ts), and the provider to `LlmProvider` in [src/server/config/settings.ts](src/server/config/settings.ts).
4. Pick a reference: [`gemini.ts`](src/server/llm/gemini.ts) for a cloud provider with an SDK, [`ollama.ts`](src/server/llm/ollama.ts) for one that is plain HTTP, [`claude-code.ts`](src/server/llm/claude-code.ts) for one that shells out.
5. Add it to the probe in [src/server/llm/model-probe.ts](src/server/llm/model-probe.ts) if "which models can this key call" has a non-obvious answer — it usually does.
6. Update [Choosing a provider](docs/getting-started/choosing-a-provider.md) with what it costs and what it needs.

**Don't add a dependency unless the provider genuinely needs one**, and never lazy-load packages — that makes whether a feature works depend on whether the network is up.

### Adding a new ingester (file format)

1. Add the parser in `src/server/knowledge/loader.ts` — keep parsers small and side-effect-free.
2. Add an entry to the supported-formats table in [Lore/README.md](Lore/README.md).

### Tests

Backend has a Vitest suite (`npm test`) covering security middleware, path resolution, key store, persona store, prompt assembly, atomic writes, and the Obsidian reader's read-only guard. The React dashboard is intentionally untested today — manual smoke-testing is the standard for frontend changes.

If you're touching backend code, add or update the relevant `*.test.ts` next to your source file. If you're touching parsing or prompt assembly, include a couple of example documents and queries in the PR description that demonstrate the change behaving as advertised.

A proper frontend test harness is on the [Roadmap](ROADMAP.md). Contributions toward that are particularly welcome.

### Pull request checklist

- [ ] Issue opened first (for non-trivial changes), and approach agreed
- [ ] `npm run lint` passes locally
- [ ] One thing per PR
- [ ] PR description explains *why* and includes a brief test plan
- [ ] If you added an LLM provider or file format, the README + `.env.example` are updated
- [ ] No secrets, lore folders, `api-keys.json`, or `.env*` files in the diff

---


</div>
</details>

<details class="docs-section">
<summary><h2>Reporting a security vulnerability</h2></summary>
<div class="docs-section-body">


Please **don't** open a public issue. See [SECURITY.md](SECURITY.md) for the disclosure process.

---


</div>
</details>

<details class="docs-section">
<summary><h2>Questions?</h2></summary>
<div class="docs-section-body">


[Open an issue](https://github.com/KochiTusker/Tusks-Vault/issues/new/choose) — new-contributor questions are welcome and get answered with a smile, not a sigh. A community Discord with a dedicated support channel is on the [roadmap](ROADMAP.md).


</div>
</details>
