# FAQ — Tusk's Vault

← Back to [README](../../README.md)

Short answers. Where a question has a page of its own, this points at it
rather than repeating it — two copies of an answer is one copy that goes
stale.

---

<details class="docs-section" open>
<summary><h2>🚀 Getting started</h2></summary>
<div class="docs-section-body">

### What do I need installed?

**Node.js 20+** and **Git**. Nothing else — no Python, no Docker, no database,
no admin rights, no paid key. Full walkthrough in
[Installation](../getting-started/installation.md).

### What is the fastest path to a working bot?

```sh
git clone https://github.com/KochiTusker/Tusks-Vault.git
cd Tusks-Vault
bash run.sh    # or double-click run.bat on Windows
```

`bash run.sh` rather than `./run.sh`: the script is not checked in executable,
so the bare form reports "Permission denied" on a fresh clone.

The launcher checks Node, installs dependencies, starts the server and opens
<http://localhost:3000>. Add a free Gemini key, paste a Discord token, drop in
a document — about five minutes.

### Do I have to use Discord?

No. There are three places to ask: **Discord**, **Foundry VTT** (a companion
module that pairs in one click), and **any MCP client** such as Claude Code or
Claude Desktop. Each is switched on independently in the **Surfaces** card.
Foundry and MCP ship off; Discord is on but does nothing without a token.

The dashboard is where you *manage* the archive — upload lore, record
clarifications, resolve gaps. There is no chat box in it; asking happens on one
of the three surfaces.

</div>
</details>

<details class="docs-section">
<summary><h2>💸 Money and keys</h2></summary>
<div class="docs-section-body">

### What does it cost?

Vault is free. You pay only your chosen model's tokens, and a free Gemini tier
covers most home games. Full breakdown, per-session estimates and how to cap
spending: [What it costs](../about/what-it-costs.md).

### Where do I put my Claude or OpenAI key?

There are no direct Anthropic or OpenAI slots. **OpenRouter** reaches the same
models on one key and one bill, and Gemini keeps a direct slot because it is
cheaper called directly. See
[Choosing a provider](../getting-started/choosing-a-provider.md).

### Where do my keys live?

Encrypted at rest (AES-256-GCM, bound to the machine) in your platform config
directory — never in the repo, never in git. Details and the honest limits of
that in [Privacy](../security/privacy.md).

</div>
</details>

<details class="docs-section">
<summary><h2>🔐 Privacy</h2></summary>
<div class="docs-section-body">

### What leaves my machine when I ask a question?

Two calls: **Discord's gateway** (to read the mention and post the reply), and
**your chosen provider's API** — which receives your question, the system
prompt, matched clarifications, and your lore.

Be clear about that last part: with the default folder source there is no
per-question retrieval, so the **entire parsed corpus** goes with every
question, capped at 500,000 characters. The
[Obsidian source](../lore/obsidian-vault.md) is the only one that narrows, and
only once a vault outgrows the prompt budget.

Full accounting, including what is never sent:
[Privacy](../security/privacy.md).

### Why does it download a model on first launch?

~25 MB of MiniLM, once, from Hugging Face — the local embedding model that
matches your clarifications to differently-worded questions. It runs on your
CPU and never leaves the machine. The download is not awaited, so an offline
first boot still starts; only semantic clarification matching is unavailable.

</div>
</details>

<details class="docs-section">
<summary><h2>📜 Tusk's Tomes</h2></summary>
<div class="docs-section-body">

### Do I need Tomes to use Vault?

No. Vault is fully usable alone. [Tomes](../lore/tusks-tomes.md) is a separate
optional companion that records sessions and writes chronicle documents, which
Vault then reads like any other lore. They pair well; neither depends on the
other.

### Can Tomes use the same lore folder?

Yes — that is the point of the pairing. Put both projects side by side and they
share the sibling `Tusks-Lore/` folder. Tomes writes into
`Tusks-Lore/Sessions/<campaign>/`; Vault walks the tree recursively and
surfaces them on the next question. No sync step.

</div>
</details>

<details class="docs-section">
<summary><h2>🐞 Something is wrong</h2></summary>
<div class="docs-section-body">

**Install-time problems** — wrong Node version, port 3000 taken, PowerShell
execution policy, `ERR_MODULE_NOT_FOUND` after a pull, the MiniLM download
failing — are answered where they happen, in
[Installation → Common setup issues](../getting-started/installation.md#common-setup-issues).

### The Discord bot joined but never replies

Four things, in order:

1. **Message Content Intent** — Developer Portal → your app → Bot → *Privileged
   Gateway Intents*. Without it the bot cannot read messages.
2. **A working connection** — Settings → Key Vault. At least one key present and
   not flagged invalid. (Claude Code and Ollama need no key, but do need the CLI
   signed in / the server running.)
3. **The Active Channel picker** — not pointing at Ollama with nothing running,
   or a provider with a dead key.
4. **Pause and Surfaces** — either silences it completely and deliberately: no
   typing indicator, no reply, no spend, one line in the log saying why.

### "I am unsure about this detail. I have recorded this as a lore gap…"

That is the canonical refusal — nothing in your documents or clarifications
answered it. The question is now in the **Lore Gaps** tab. Answer it once and
that answer is reused for any semantically similar question afterwards.

### Where do I get help?

[Open an issue](https://github.com/KochiTusker/Tusks-Vault/issues/new/choose)
with your OS, Node version, the command, and the error. Don't paste API keys.
Known problems are listed in [Known issues](known-issues.md).

</div>
</details>

<details class="docs-section">
<summary><h2>🗑️ Getting rid of it</h2></summary>
<div class="docs-section-body">

An uninstaller ships with the repo and removes everything Vault created
without touching your campaign documents — plus the four things it cannot
reach, which you have to finish yourself.

**[Uninstalling →](../getting-started/uninstalling.md)**

</div>
</details>

---

## Next steps

- [Installation](../getting-started/installation.md)
- [What it costs](../about/what-it-costs.md)
- [Known issues](known-issues.md) — what is broken or missing today
