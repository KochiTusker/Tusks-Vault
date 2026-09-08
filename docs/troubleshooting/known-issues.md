# Known issues — Tusk's Vault

← Back to [README](../../README.md)

Honest list of what doesn't work yet, what's a limitation by design, and how to file a bug. If something here is blocking you, [file an issue](https://github.com/KochiTusker/Tusks-Vault/issues) — we prioritise what gets reported.

For the security threat model, see [SECURITY.md](../../SECURITY.md). For the planned-features list see [ROADMAP.md](../../ROADMAP.md).

---

<details class="docs-section" open>
<summary><h2>💻 Platform support</h2></summary>
<div class="docs-section-body">

The single most useful thing to know before you install. Full table with the
reasoning in [Installation](../getting-started/installation.md#which-machines-this-has-actually-been-run-on).

| Platform | State | Detail |
|---|---|---|
| **Windows 10 / 11 (x64)** | **Supported** | The developed-and-used-daily platform. A clean clone → `npm ci` → boot is verified, and the test suite runs on Windows in CI on every commit. |
| **Windows on ARM** | **Unverified** | Until v1.0.2 this could not start at all: `pdf-parse` depends on `@napi-rs/canvas`, whose pinned 0.1.80 ships no `win32-arm64` binary, and the failed load surfaced as `DOMMatrix is not defined` at boot. Fixed two ways — the canvas version is pinned forward via `overrides`, and PDF support now loads lazily so a missing binary costs you PDF ingest instead of the whole server. **Not yet run on real ARM hardware.** If it fails, install the **x64** Node build and it will run emulated. Reports very welcome. |
| **macOS** | **Untested** | `run.sh` exists and nothing in the code is Windows-only, but the app has never been started on a Mac. Expect any problems in the launcher scripts rather than the app. |
| **Linux** | **Partly tested** | The full suite runs on Linux in CI every commit, and since v1.0.2 CI also starts the real server on Linux and checks it answers. So the code boots; what is untested is the desktop experience — the launcher script, the browser auto-open, and a first run driven by a person rather than a script. |

> [!WARNING]
> Only 64-bit Windows is *supported* today. The rest are expected to work and
> have not been proven to. Please don't plan a session around an untested
> platform before you've watched it run.

**What "untested" does and doesn't mean.** The risk is that the program fails
to start or a launcher script misbehaves — not that anything on your machine is
harmed. Vault writes only to its own folder, its config directory, and the lore
folder you point it at.

</div>
</details>

---

<details class="docs-section" open>
<summary><h2>⚠️ Known limitations</h2></summary>
<div class="docs-section-body">

Things that work but have known edges. None of these block normal use.

| Limitation | What it costs you | Status |
|---|---|---|
| **The folder source re-parses on every question.** No cache, no per-question retrieval — the whole corpus goes into every prompt. | ~10–30 s and a full-corpus token bill at around 50 PDFs. | The [Obsidian source](../lore/obsidian-vault.md) already narrows once a vault outgrows the budget. Bringing that to the folder source is the biggest token reduction the architecture can deliver — on the [Roadmap](../../ROADMAP.md). |
| **`KB_CHAR_LIMIT` caps the folder corpus at 500,000 characters** (~200 pages). | Documents past the cap are dropped rather than retrieved. | It cuts on a document boundary, never mid-sentence, and the prompt names the files that did not fit and tells the model not to cite them — so you get "I don't have that document", not a fabrication. Same fix path as above. |
| **The stricter production CSP never activates.** It is selected by `NODE_ENV=production`, and nothing sets it — `npm start` is identical to `npm run dev`, and the launchers do not build. | Little, in practice. Scripts are limited to the app's own origin under both policies, so no third-party script can load either way; what the running policy additionally permits is inline scripts and `eval`, which Vite needs. Nothing renders lore, model output or user content as raw HTML, so there is no paired XSS sink. | A missing layer of defence in depth, not a live hole. Making the modes real means `npm start` would serve a build the documented install never produces, so it is a v1.0.1 change rather than a release-eve one. |
| **DOCX parsing has no timeout or size cap.** | A crafted DOCX could stall the parser. | Only ingest documents you trust. PDFs gained a 64 MB ceiling and a 60-second extraction timeout in v1.0.2; DOCX has neither yet. |
| **The refusal detector matches a substring** — `"i am unsure about this detail"`. | If a model paraphrases, the lore gap may not get logged. | It still refuses to invent; it just does not record the question. Rule 3 instructs the exact phrase, so this is rare. |
| **Discord replies over 2000 characters are sliced on a regex boundary.** | Occasionally cuts a citation marker across two messages. | Cosmetic. |
| **First boot downloads ~25 MB** of the MiniLM model from Hugging Face. | On an air-gapped machine you get `[embeddings] Failed to load model`. | The server still starts; everything except semantic clarification matching works. Copy `models/` from a networked machine. |
| **Foundry answers are not scoped to what your table has discovered.** | A player can pull a secret the party has not found. Whisper mode bounds who *sees* an answer, not what they can *ask for*. | `allowPlayers` is **off by default**, so a fresh install answers only the GM. The module's `isGM` flag is a claim Vault cannot verify — that ceiling is what makes forging it worthless. |
| **No automated frontend tests.** | The React dashboard is verified by manual smoke-testing. | The Vitest suite covers `src/server/**`, `src/lib/`, and `scripts/`. A frontend harness is on the [Roadmap](../../ROADMAP.md). |

A stale `.port-runtime` is harmless, incidentally — nothing in the launch path
reads it back. If auto-open lands on a refused connection, the server failed to
start; check the console.

</div>
</details>

<details class="docs-section">
<summary><h2>🔒 By-design tradeoffs</h2></summary>
<div class="docs-section-body">

Documented choices, not bugs. Listed so you can decide whether the tradeoff
fits your setup. Security reasoning for all of them:
[SECURITY.md](../../SECURITY.md).

| Choice | Why | What it means for you |
|---|---|---|
| **Keys are encrypted at rest but not from you.** | AES-256-GCM, key derived from a machine identity, salt beside the ciphertext. | It defeats a backup client or support bundle scooping up readable keys — not anything already running as you. Treat the config directory like a password-manager export. |
| **No auth on the local dashboard.** | The `127.0.0.1` bind is the access boundary — a machine boundary, not a user one. | `HOST=0.0.0.0` widens trust, not just reach. Under it the Updates card and Logs view stop working for LAN visitors, deliberately; `npm run update` on the host still updates. A setup-token story is on the [Roadmap](../../ROADMAP.md). |
| **The MCP bridge is a second inbound surface, and the only pre-auth one.** | Three exact paths accept cross-origin requests, because a GM's Foundry page is not served from loopback. | Approval is deliberately not one of them. Pairing needs a bearer token, an origin allow-list built one approval at a time, and a handshake code. A paired client can ask anything — read the list under **Surfaces** occasionally. |
| **Only one campaign per install.** | Single-user, single-collection model. | Multi-campaign is on the [Roadmap](../../ROADMAP.md). |
| **The updater needs Git.** | It calls `git pull --ff-only`. | ZIP installs update by re-downloading and overwriting; gitignored files survive. Auto-detected, with a clear message. |
| **`pdf-parse` and `mammoth` are unsandboxed.** | Best-in-class for Node; neither isolates documents. | The threat model assumes you only ingest documents you trust. |
| **Ollama must be on loopback.** | The SSRF guard in `routes/settings.ts` refuses anything else. | You cannot point Vault at a remote Ollama. Deliberate — it keeps the threat surface at "trust your own machine". |
| **Two `npm audit` high advisories have no fix.** | Both reach us through `@huggingface/transformers`, which runs the local embedding model: `sharp` (libvips image CVEs) and `adm-zip` via `onnxruntime-node`. | Neither path is reachable — Vault uses that package for text feature-extraction only, so it never decodes an image or opens a zip you supplied. CI accepts them by name, with a reason and a review date, and still fails on anything unlisted. |

</div>
</details>

<details class="docs-section">
<summary><h2>🐞 How to file an issue</h2></summary>
<div class="docs-section-body">

If you've hit something not in this list:

1. **[Open a GitHub issue](https://github.com/KochiTusker/Tusks-Vault/issues/new)**.
2. Include:
   - **What you expected** to happen, and **what actually happened.**
   - **Version** — the one on the About page, plus `git log -1 --oneline` if you cloned. The exact commit is far more useful than the release number.
   - **Your OS** (Windows / macOS / Linux + version).
   - **Which LLM provider** — Gemini, OpenRouter, Claude Code, or Ollama.
   - **The relevant lines** from the dashboard's **Logs** panel.

   **Easier: attach the diagnostic bundle.** Vault writes `.diagnose/latest.md` automatically whenever a Discord reply errors, and you can build one on demand:

   ```sh
   curl -X POST http://localhost:3000/api/diagnostics/bundle
   ```

   It holds settings, lore resolution, git position and a scrubbed log tail — keys reduced to 6-character fingerprints, no lore content.

   **Spot-check either one before pasting.** The secret-scrubber masks the documented key shapes automatically (Anthropic, OpenAI, Google, Discord, Slack, GitHub, AWS, Stripe, plus JWTs and PEM private-key armour), but it is a best-effort filter, not a guarantee.
3. If it's a security report, **don't post exploit details publicly** — follow the disclosure process in [SECURITY.md](../../SECURITY.md).

For questions, feature requests, or "is this normal?" type checks, [open an issue](https://github.com/KochiTusker/Tusks-Vault/issues/new/choose) — that is the fastest path today. A community Discord is on the [roadmap](../../ROADMAP.md).

</div>
</details>

---

## Next steps

- 🗺️ [Roadmap — what's planned next](../../ROADMAP.md)
- 🔐 [Privacy & security threat model](../../SECURITY.md) · [Privacy](../security/privacy.md)
- 📦 [Dependencies — what's installed and why](../about/dependencies.md)
- ❓ [FAQ — common questions](faq.md)
