# 🗺️ Tusk's Vault — Roadmap

What's next in Tusk's Vault, and why. What already works is in the
[README](README.md) and the [docs](docs/README.md) — this page is the queue.

> ⚠️ Aspirational, not a contract. Items move between sections, get descoped, or
> get dropped when a better approach turns up.

**To influence it:** [open an issue](https://github.com/KochiTusker/Tusks-Vault/issues/new?template=feature_request.yml)
and describe the situation, not just the feature — *"when Y happens in my
campaign, I wish Z"* is what makes a priority concrete. Comments and reactions
on an issue are what move something up.

---

<details class="docs-section">
<summary><h2>📚 Table of contents</h2></summary>
<div class="docs-section-body">

- [🎯 Project north star](#project-north-star)
- [🔨 In progress](#in-progress)
- [🎯 Up next](#up-next)
- [💭 Wishlist & longer-term ideas](#wishlist-longer-term-ideas)
- [🧪 Explored & deferred](#explored-deferred)
- [✅ Already shipped](#already-shipped)

</div>
</details>

<details class="docs-section" open>
<summary><h2>🎯 Project north star</h2></summary>
<div class="docs-section-body">

Two principles steer everything below.

1. **Accessibility for non-developers.** Tusk's Vault should be usable by
   someone who has never cloned a repository, run `npm`, or edited a config
   file. A setup step that needs CLI knowledge is a bug —
   [report it](https://github.com/KochiTusker/Tusks-Vault/issues).
2. **Cite-or-refuse, never invent.** Every claim Tusk makes has to be backed by
   something you wrote. A feature that lets the model make things up does not
   belong here.

</div>
</details>

<details class="docs-section" open>
<summary><h2>🔨 In progress</h2></summary>
<div class="docs-section-body">

*Nothing actively in progress — between releases.*

</div>
</details>

<details class="docs-section" open>
<summary><h2>🎯 Up next</h2></summary>
<div class="docs-section-body">

Roughly prioritised. Everything here is "real soon" rather than "someday".

### 🌐 Installation

Principle 1, made concrete.

- [ ] **Zero-clone Windows installer** — a signed `.exe` / `.msi` bundling Node
      and the app, so installing is opening one file.
- [ ] **macOS / Linux first-run installers** — `.pkg` / `.AppImage` equivalents.

### 💸 Cost efficiency

- [ ] **Chunked retrieval over full-corpus embedding** — embed once on ingest,
      retrieve only the top-K matching chunks per query, instead of stuffing
      every document into every prompt. See
      [Known issues](docs/troubleshooting/known-issues.md) for what that costs
      today.
- [ ] **Provider prompt-cache adoption** — structure the prompt
      (system → corpus → question) so OpenRouter and Gemini caching applies
      across calls.
- [ ] **Per-phase model routing** — Flash-tier for easy lookups, Pro/Opus only
      where it earns it.

### 📄 Knowledge ingestion

- [ ] **Multi-campaign support** — switch worlds without sharing one
      `Tusks-Lore/` folder.
- [ ] **In-PDF image OCR** — text is extracted today; images of text (scanned
      notes, labelled maps) are skipped.
- [ ] **PDF / DOCX parse timeout + size cap** — bound resource use on
      unfamiliar documents.

### 🔌 Integrations

- [ ] **Player-vs-GM lore scoping** — **the blocker on letting players use the
      Foundry integration.** Vault has no notion of what your table has already
      discovered, so whisper mode controls who *sees* an answer but not who can
      ask for one. Until it lands, the honest controls are GM-only mode and the
      `allowPlayers` ceiling —
      [Foundry VTT](docs/surfaces/foundry-vtt.md) explains both.
- [ ] **Live Tomes push integration** — accept a push when a chronicle
      finalises, instead of polling
      [Tusk's Tomes](docs/lore/tusks-tomes.md)' Sessions folder.

### 🧠 Model UX

- [ ] **Dynamic model dropdowns for OpenRouter / Ollama** — the same
      auto-discovery Gemini already has.

### 🛡️ Auth + LAN exposure

- [ ] **Setup-token + auth-middleware** — a one-time token pasted from another
      device to authorise the dashboard, making `HOST=0.0.0.0` safe.

### 📚 Documentation

- [ ] **Documentation site live** — the site is built and staged; it goes live
      when the repository is public and Pages is enabled. The Foundry module's
      manifest already points at it, so those links resolve to nothing until
      then.
- [ ] **Video walkthrough + screenshots** — visual onboarding for people who
      arrive from search.

### 🤝 Community

- [ ] **Community Discord, if there is interest** — shared with
      [Tusk's Tomes](https://github.com/KochiTusker/Tusks-Tomes). Deliberately
      not launched: an unstaffed server with three people in it is worse than no
      server, and a public invite is a permanent link between the project and
      whoever answers in it. It goes up when issue traffic suggests it would be
      used.

</div>
</details>

<details class="docs-section">
<summary><h2>💭 Wishlist & longer-term ideas</h2></summary>
<div class="docs-section-body">

Unscheduled. Open or comment on an issue if one of these matters to you.

- [ ] **Optional vector-store backend** — flat JSON is fine to a few thousand
      documents; `sqlite-vss` / `pgvector` / `chromadb` as an opt-in upgrade
      past that.
- [ ] **In-Discord slash commands** — `/lore-search`, `/clarify-this`,
      `/show-citations`, `/lore-gaps`, instead of everything going through
      `@mention`.
- [ ] **Roll20 chat-bar integration** — same idea as Foundry, but their API is
      gated behind Roll20 Pro, so it would activate only with a user-supplied
      key.
- [ ] **NPC voice profiles** — tag an NPC with a personality so
      `@Tusk speak as Ser Alric Vane about X` returns Alric-flavoured cited
      summaries.
- [ ] **Player-vs-DM document scopes** — which lore files a player query may
      see at all, beyond the answer-level scoping above.
- [ ] **Export to Obsidian / static site** — a hyperlinked bundle generated
      from the indexed corpus.
- [ ] **Frontend test harness** — fixtures-based, exercising the React panels
      without a real Discord token.
- [ ] **i18n** — strings extracted, community translations welcome.

</div>
</details>

<details class="docs-section">
<summary><h2>🧪 Explored & deferred</h2></summary>
<div class="docs-section-body">

Scoped or partly built, then set aside on purpose — recorded so nobody burns the
same time learning the same lesson.

### Lazy-downloaded add-on code

**Superseded.** The add-on layer this was built for no longer exists. The
reasoning below is what eventually killed the layer itself, and is worth reading
before anyone proposes a plugin system again.

**The ambition.** A fresh clone ships with zero add-on source. Install fetches a
tarball from a GitHub Release, verifies a sha256, extracts to a per-user dir,
runs postinstall, and `await import()`s the module at boot.

**What landed** (on a branch since deleted): the dynamic-loader
scaffolding — manifest, sha256 verification of tarball and extracted tree,
shape-validated dynamic import with a name cross-check, a route-registration
hook, and two-pass boot with `pendingReinstall` / `integrityFailures` sets.

**Why it stopped, before the install endpoint:**

- **Payoff was poor.** Both add-ons had zero unique dependencies and ~30 KB of
  source. That is not worth a fetch/verify/extract/sandbox/stream/migrate
  pipeline.
- **Offline install regressed.** Bundled add-ons need no network; lazy ones do.
- **Supply-chain surface grew.** Postinstall scripts from a downloaded tarball
  add risk even with sha256. The honest mitigation — GPG-signed manifests — is
  its own project.
- **Isolation was leaky.** The test plan alone needed an env var and tripped
  over PowerShell/cmd quoting. If maintainers fumble it, users will too.
- **No driving use case.** The architecture earns its keep only when a payload
  is genuinely heavy.

**What would unlock revisiting:** an add-on needing heavy native deps or a
Python sidecar; a signed-manifest design that does not mean juggling a release
key by hand; or tarballs shipped beside the clone but loaded only on Install,
which keeps the offline story.

</div>
</details>

<details class="docs-section">
<summary><h2>✅ Already shipped</h2></summary>
<div class="docs-section-body">

Receipts, not the focus of this page. Each links to where it is documented
properly.

| Area | What exists |
|---|---|
| **Providers** | [Four connections](docs/getting-started/choosing-a-provider.md) — OpenRouter, Gemini, Claude Code, Ollama — swappable without restart. Multi-key vault with Free/Paid tiers. Real one-token model probing, so the picker shows what a key can actually reach. `npm run grade` scores models on accuracy and citation discipline. |
| **Lore sources** | The `Tusks-Lore/` folder, and an [Obsidian vault](docs/lore/obsidian-vault.md) read strictly read-only, with an AI map so a large vault fits in a prompt without arbitrary truncation. [Tomes](docs/lore/tusks-tomes.md) chronicles are indexed with no import step. |
| **Surfaces** | [Discord](docs/surfaces/discord.md) with in-dashboard token setup, [Foundry VTT](docs/surfaces/foundry-vtt.md) via a companion module, and any MCP client. Personas — eight presets plus custom, from template, scratch, or AI-generated. |
| **Grounding** | The canonical seven-rule block is force-appended at prompt assembly, so a custom persona cannot disable citations. Unanswerable questions become lore gaps. Local MiniLM clarification matching, no cloud round-trip. |
| **Install & update** | Cross-platform launchers, one-time setup scripts, port auto-fallback, a first-run onboarding banner, and an [in-app updater](docs/getting-started/installation.md) that never runs `npm install` in-process. Optional tag-track pinning. |
| **Security** | Loopback bind by default, DNS-rebinding guard, defensive headers, atomic writes, path-traversal validation, env-file injection guard, log secret scrubbing, body-size limits, endpoint rate limiting. Full model: [SECURITY.md](SECURITY.md). |
| **Tests** | Vitest over the server, scripts and libs. No frontend harness yet — it is on the wishlist above. |

**Removed on purpose:** the add-on layer that once gated Personas and Ollama. It
turned out "installing" wrote a marker file and nothing else — no download, no
build, no code that was not already in the clone. Both are ordinary features now.

</div>
</details>

<details class="docs-section">
<summary><h2>See also</h2></summary>
<div class="docs-section-body">

- 📖 [Main README](README.md) — what Tusk's Vault is and how to install it
- 📚 [Documentation index](docs/README.md) — every page, grouped
- 🐛 [Known issues](docs/troubleshooting/known-issues.md) — current limits and by-design tradeoffs
- 🤝 [CONTRIBUTING.md](CONTRIBUTING.md) — how to ship code, and how to help without writing any
- 🔎 [Open issues](https://github.com/KochiTusker/Tusks-Vault/issues) — bugs and requests from the community

</div>
</details>
