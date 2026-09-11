<div align="center">

# Tusk's Vault

### Ask your D&D, Pathfinder, or TTRPG campaign anything — accurate, source-cited answers from your own lore documents, in Discord, Foundry VTT, or any MCP client.

**Local-first AI lore assistant. Open source. MIT-licensed. Free forever.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/Node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-14-5865F2?logo=discord&logoColor=white)](https://discord.js.org/)
[![GitHub last commit](https://img.shields.io/github/last-commit/KochiTusker/Tusks-Vault?color=8B6F2C)](https://github.com/KochiTusker/Tusks-Vault/commits/main)

*Like NotebookLM for Dungeons & Dragons — except it runs on your machine, and it refuses to make things up.*

**[What it is, in one page →](https://kochitusker.github.io/Tusks-Vault/)**
&nbsp;·&nbsp;
[See real cited answers](https://kochitusker.github.io/Tusks-Vault/examples/)
&nbsp;·&nbsp;
[Setup walkthrough](docs/getting-started/installation.md)
&nbsp;·&nbsp;
[Foundry VTT](docs/surfaces/foundry-vtt.md)
&nbsp;·&nbsp;
[How it compares](docs/about/comparison.md)

<p>
  <a href="https://buymeacoffee.com/kochitusker" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-violet.png" alt="Buy Me a Coffee" height="50" /></a>
</p>

</div>

## Why this exists

My campaign notes were spread across six documents, two of which contradicted
the other four. Players asked me the same questions between sessions — who was
that merchant, what did we agree to, whose brother is the king — and I answered
from memory, badly, and sometimes differently than last time.

The obvious fix is to ask an AI. That fails in a specific and infuriating way:
a general chatbot given your setting will answer *every* question confidently,
including the ones your documents say nothing about. It invents a plausible
duke. It gives your NPC a motive you never wrote. And because the invented
answer reads exactly like the real one, you only find out at the table, in
front of everyone.

So the whole design of this project is one idea: **the bot may only tell you
what your documents say, and it must show you where it got it.** Every answer
carries a citation. When the answer is not in your sources, it says so in a
fixed phrase — and logs the question so you can answer it once, properly, and
have that answer reused forever after.

It runs on your machine. Your campaign documents never leave it; only the
question and the matched snippets go to whichever model you pick — Gemini,
~400 models via OpenRouter, a Claude subscription you already pay for, or fully
offline through Ollama.

### You'll probably get on with this if…

- You're a **GM** who has answered "wait, who was that again?" more times than you'd like, and would rather your players asked something that has actually read the notes.
- You want to **check your own worldbuilding for contradictions** — query your setting like an outsider and see what surfaces.
- You have a **player joining a 30-session campaign** and would rather point them at a bot than write them a primer.
- You're a **player** who missed a session and doesn't want to DM the GM at 1am.
- You **play on Foundry VTT** and want answers in the chat bar mid-session, with per-world control over what players can pull out of the archive.
- You **stream or make actual-play content** and want to answer chat questions without breaking the scene.
- You are **not willing to upload your campaign to somebody's cloud** to get this. Nothing here leaves your machine except the question and the snippets that answer it.
- You'd **rather own the tool than rent it** — a free Gemini tier covers most home games, and a local model costs nothing at all.

**A fair warning:** this is one person's project. It expects you to be
comfortable installing Node.js and running a script. [Known issues](docs/troubleshooting/known-issues.md)
lists the known limitations and the trade-offs that are deliberate.

### Who this is for — and who it isn't

Tusk's Vault assumes **you know and trust whoever can ask it questions**: a
small private Discord, or a Foundry table of trusted players. It is not built
for a public server, an open community, or a convention table of strangers.

The reason is worth stating plainly rather than burying, because it is a
property of how the thing works rather than a bug waiting to be fixed:

- **Anyone allowed to ask can reach the whole corpus.** Retrieval is steered by
  the question, so a player asking about a mystery pulls the notes about that
  mystery. Per-player lore scoping is [on the roadmap](ROADMAP.md); it is not
  here yet.
- **A player can talk the bot into reciting its context.** People try it, and it
  works often enough to plan around. What comes out is *your own lore* — the
  material you deliberately handed it — not your API keys, your files, or
  anything else on the machine. The archivist has no filesystem, no shell and no
  network of its own, and that is [tested rather than assumed](SECURITY.md). The
  failure mode is **spoilers, not a breach**.
- **A refusal still tells them something.** "I won't say who the traitor is"
  confirms there is a traitor.

Which is why player questions are **off by default** on Foundry, and why on
Discord the bot only reads the channels you put it in. Those two switches are
the access model. [What a prompt injection can and cannot do](SECURITY.md) is
the exact version.

---

## What Tusk's Vault does

**It is the assistant that has read every word of your campaign — and *only*
those words.** Drop your lore into a shared `Tusks-Lore/` folder, then ask from
wherever you already are: `@`-mention it in Discord, type `/tusk` in Foundry's
chat bar, or use the dashboard.

Answers come back with one of three citation flavours — `[filename]`,
`[clarification: ID]`, `[D&D 5e]` — so you can always see whether a claim came
from your canon, from a ruling you made earlier, or from the rules.

**It never invents campaign lore.** A canonical seven-rule block is appended to
every prompt at assembly time, so citation discipline and the no-invention
contract are structurally guaranteed rather than configured — you cannot turn
them off by editing a system prompt.

When the answer genuinely isn't in your sources, the bot emits a fixed refusal
phrase and the question lands in the dashboard's **Lore Gaps** tab. Answer it
once and it is remembered forever, including when a future player phrases the
question completely differently.

> [!NOTE]
> Answers are only as good as your documents. Vault makes your notes
> searchable and honest about their limits — it does not write your setting for
> you. For that, see [Tusk's Tomes](https://github.com/KochiTusker/Tusks-Tomes).

---

## How Tusk's Vault compares

| | Runs locally | Cost | Cites sources | Refuses off-corpus | Open source |
|---|---|---|---|---|---|
| **Tusk's Vault** | ✅ | Free (bring a key) | ✅ cited | ✅ | ✅ MIT |
| **NotebookLM** (Google) | ❌ cloud | Free w/ Google account | ✅ cited | ❌ | ❌ |
| **ChatGPT / Claude.ai direct** | ❌ cloud | Limited free tier | ❌ hallucinates | ❌ | ❌ |
| **World Anvil** | ❌ cloud | Free tier; paid features | ❌ no AI | — | ❌ |
| **LegendKeeper** | ❌ cloud | Subscription | ❌ no AI | — | ❌ |
| **Kanka.io** | ❌ cloud | Free tier; paid advanced | ❌ no AI | — | ✅ self-host |
| **Obsidian + AI plugins** | ✅ | Variable | Plugin-dependent | ❌ | Plugin-dependent |

The column that matters is the fourth. Most tools will answer anything you ask;
the useful behaviour is knowing when to stop.

The fifth matters for a different reason. This is one person's project, so it
is fair to ask what happens if it stops. Local-first and MIT bound the answer:

- **Your campaign** stays the folder of files it always was. Vault never
  converted or imported anything, so there is no export step.
- **Your install** keeps working. Nothing runs on anyone else's server, so
  there is no switch for anyone to flip.
- **The code** is yours to fork — MIT.
- **What you would lose is upkeep**, not material.

The full version, including what genuinely breaks, is under *What happens if
this project dies* in the [Comparison](docs/about/comparison.md).

**Full, honest breakdown — including where the alternatives are better:** [Comparison](docs/about/comparison.md)

---

## Prerequisites

- **Node.js 20 or newer** — [download from nodejs.org](https://nodejs.org/). The LTS build is fine.
- **Git** — [download from git-scm.com](https://git-scm.com/). Required for the in-app updater.

You **don't** need Python, Docker, a database, admin rights, or a paid LLM key.

> [!WARNING]
> **Supported today: 64-bit Windows 10 / 11.** That is the platform this is
> built and used on daily, and the only one where a clean install has been run
> end to end. **Windows on ARM, macOS and Linux are expected to work but are
> unverified** — the code has no Windows-only calls and the test suite runs on
> Linux in CI, but nobody has booted the app on a Mac, a Linux desktop, or an
> ARM machine. Nothing will harm your computer; the realistic failure is that
> the server doesn't start. Please
> [tell us what happened](https://github.com/KochiTusker/Tusks-Vault/issues) if
> you try one — that's how these move to supported. Details:
> [Platform support](docs/troubleshooting/known-issues.md).

## Quick start

**Mac / Linux**

```sh
git clone https://github.com/KochiTusker/Tusks-Vault.git
cd Tusks-Vault && ./run.sh
```

**Windows** — clone the repo, open the folder, and double-click `run.bat`. Or
download `install-tusks-vault.bat` and run that instead; it prints the whole
plan and confirms before it touches anything.

The launcher checks your Node version and installs dependencies against the
committed lockfile (~1 minute, no global tools, no admin rights), then starts
the server and opens <http://localhost:3000> automatically. If port 3000 is
busy it walks up to 3019 and opens whichever it got.

> [!TIP]
> New to GitHub or terminals? The full walkthrough, with a collapsible section
> for every step, is in **[Installation](docs/getting-started/installation.md)**.

---

## Cost

**Vault itself is free, forever, MIT-licensed.** No subscription, no account,
no telemetry, no paywalled features. The only money involved is the **LLM key**
of whichever connection you pick:

- **Google Gemini** — a generous free tier that comfortably covers most home games. Kept as a direct connection because it is cheaper called directly than through an aggregator.
- **OpenRouter** — pay-as-you-go, typically $0.60–$4 per three-hour session, and one key reaches Claude, GPT and ~400 other models.
- **Claude Code** — no API key at all; answers through a Claude Pro or Max subscription you already pay for.
- **Ollama** — zero ongoing cost. Runs on your machine, fully offline once a model is pulled.

Per-session breakdown, the work going into bringing costs down, and how to set
spending caps: [docs/FAQ.md → Costs](docs/troubleshooting/faq.md).

> [!WARNING]
> Provider pricing is set by the providers and can change without notice. The
> code in this repo will always remain free.

---

## Where the answers come from

**Four connections, and only two of them take a key.**

| Connection | Key needed | Notes |
|---|---|---|
| **Google Gemini** | Yes | Free tier covers most home games |
| **OpenRouter** | Yes | ~400 models on one key and one bill, pinned to zero-data-retention hosts |
| **Claude Code** | No | Runs the CLI locally against your existing subscription |
| **Ollama** | No | Local inference; nothing leaves the machine |

Vault probes which models a key can *actually* call — catalogues advertise
models that a given key or privacy policy will refuse — and marks the picker
accordingly, so you find out before a session rather than during one.

**Where you can ask from:** Discord, Foundry VTT's chat bar, and any MCP
client. The dashboard is where you configure and inspect Vault; questions are
asked from the surfaces your table already uses.

> [!IMPORTANT]
> **Foundry needs a second install**, and it is worth knowing what you get for
> it. The chat-bar integration is a separate companion module, from the
> [Foundry package registry](https://foundryvtt.com/packages/tusks-vault)
> (search *Tusk's Vault* in Foundry's own **Install Module** browser) or from
> [Tusks-Vault-Foundry](https://github.com/KochiTusker/Tusks-Vault-Foundry).
> It runs two ways:
>
> - **Lite** needs nothing else installed. It answers from the journal entries
>   in one Foundry folder, cites the entry it used, and respects your journal
>   permissions. A two-minute trial with no download of Vault at all.
> - **Bridge** points the module at Vault running on the GM's machine. The
>   answers then come from everything you keep — Word, PDF, Markdown, an
>   Obsidian vault — rather than one journal folder, with your choice of model
>   and your API key never held in a browser.
>
> Lite is the trial; Bridge is the archive. The module versions on its own
> schedule, so a Vault release does not imply a module release. Full
> walkthrough: [Foundry VTT](docs/surfaces/foundry-vtt.md).

**Personas** swap the bot's voice without weakening citation discipline — seven
presets, or author your own from a template or a description.

**Full guide:** [Choosing a provider](docs/getting-started/choosing-a-provider.md) · [Foundry VTT](docs/surfaces/foundry-vtt.md)

---

## The Tusk's trio — Vault, Tomes, and Lore

| Tusk's Vault (this repo) | Tusk's Tomes | Tusk's Lore |
|---|---|---|
| Indexes the campaign and answers questions about it | Records → transcribes → chronicles each session | Shared on-disk archive both projects read |
| "`@Tusk` who is Vellichor the Pale?" | "Write me a recap of Session 17" | "Keep chronicles where both can find them" |
| [github.com/KochiTusker/Tusks-Vault](https://github.com/KochiTusker/Tusks-Vault) | [github.com/KochiTusker/Tusks-Tomes](https://github.com/KochiTusker/Tusks-Tomes) | A folder, not a repo |

Drop them side-by-side on disk and they find each other automatically: Tomes
writes chronicles into `Tusks-Lore/`, Vault answers questions about them. Each
works perfectly on its own.

> [!TIP]
> **Got a free-tier Gemini key?** Vault is the better home for it. One
> retrieval-augmented query per turn uses far fewer tokens than Tomes'
> six-phase generation pipeline, so a free quota carries Vault comfortably.

**Pairing details:** [Tusk's Tomes](docs/lore/tusks-tomes.md)

---

## Documentation

The full docs live under [`docs/`](docs/) so this page stays readable. They are
also published, with search-friendly pages and an index, at
**[kochitusker.github.io/Tusks-Vault/docs/](https://kochitusker.github.io/Tusks-Vault/docs/)**.

| Getting started | Using it | Reference |
|---|---|---|
| [Setup walkthrough](docs/getting-started/installation.md) | [Use cases](docs/about/use-cases.md) | [Architecture](docs/about/how-its-built.md) |
| [LLM providers](docs/getting-started/choosing-a-provider.md) | [Foundry VTT](docs/surfaces/foundry-vtt.md) | [Privacy](docs/security/privacy.md) |
| [Obsidian vault as a source](docs/lore/obsidian-vault.md) | [Tomes pairing](docs/lore/tusks-tomes.md) | [Security](SECURITY.md) |
| [FAQ](docs/troubleshooting/faq.md) | [Comparison to alternatives](docs/about/comparison.md) | [Dependencies](docs/about/dependencies.md) |
| | | [Known issues](docs/troubleshooting/known-issues.md) |

Project meta: [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [License](LICENSE)

---

## Community & feedback

A dedicated **Discord community** for Tusk's Vault and [Tusk's Tomes](https://github.com/KochiTusker/Tusks-Tomes)
is on the [roadmap](ROADMAP.md) — if there's enough interest, a server will be
spun up for setup help, feature ideas, campaign showcases, and dev talk. For
now, **[GitHub issues](https://github.com/KochiTusker/Tusks-Vault/issues)** are
the fastest way to ask a question, report a bug, request a feature, or signal
that you'd like to see a community Discord exist.

> [!NOTE]
> **Early days.** What gets reported now genuinely shapes what this becomes —
> and how big the community channel needs to be if it launches.

Security issues go through [private vulnerability reporting](https://github.com/KochiTusker/Tusks-Vault/security/advisories/new), not public issues.

---

## Tech stack

- **TypeScript end-to-end**, ESM-only, Node 20+.
- **One HTTP socket** — Express 4 and Vite middleware share it. No separate
  frontend dev server, no build step in development.
- **React 19 + Tailwind 4** on the dashboard.
- **discord.js 14** for Discord; a hand-rolled Streamable HTTP MCP server for
  Foundry and other clients, bearer tokens stored only as SHA-256 hashes.
- **MiniLM-L6-v2 on CPU** via `@huggingface/transformers` for clarification
  matching — no embedding text is ever sent anywhere.
- **AES-256-GCM key store** with a machine-bound scrypt key.
- **No database** — JSON on disk, split by what should survive a reinstall.

**Full architectural breakdown:** [How it's built](docs/about/how-its-built.md)

---

## Support the project

**Free (30 seconds):** [star the repo](https://github.com/KochiTusker/Tusks-Vault) · tell another GM · [open an issue](https://github.com/KochiTusker/Tusks-Vault/issues/new/choose) with what you'd want it to do.

**Free (a bit more):** file bug reports · send PRs · vote on roadmap items.

**With money:** [buy me a coffee](https://buymeacoffee.com/kochitusker).

Tusk's Vault is MIT-licensed and free forever. **Nothing here is paywalled, ever.**

---

## License

[**MIT**](LICENSE) — fully open source, [OSI-approved](https://opensource.org/license/mit/).
Use it, fork it, modify it, redistribute it, ship it inside your own product,
sell support around it. The only requirement is that the original copyright
notice and licence text travel with the code.

Just don't blame me if your party ends up in Avernus.

---

<div align="center">

**What problems does this solve?** "How do I search my D&D campaign notes" · "AI that won't make up lore" · "Self-hosted NotebookLM alternative for TTRPG" · "Discord bot that answers questions about my campaign" · "How to stop my players asking me the same question twice" · "Foundry VTT lore assistant" · "Local AI for Dungeon Masters" · "Cited answers from my own worldbuilding documents"

</div>
