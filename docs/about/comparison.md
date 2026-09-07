# Comparison — Tusk's Vault vs the alternatives

← Back to [README](../../README.md)

Honest comparison to the tools TTRPG groups actually use today. Every claim here is verified against the current code — citations link to the source file that backs them. Each tool listed is good at what it's built for; this page is about helping you pick the right one for *your* table, not picking fights.

---

<details class="docs-section" open>
<summary><h2>🆚 At a glance</h2></summary>
<div class="docs-section-body">

| Tool | Local-first | Free forever | Source-grounded AI | Discord-native | Voice → chronicle | Open source | No terminal needed | Answers while your machine sleeps |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Tusk's Vault** | ✅ | ✅ | ✅ cited | ✅ | ✅ via [Tomes](../lore/tusks-tomes.md) | ✅ MIT | ❌ Node + Git | ❌ must be running |
| **NotebookLM** (Google) | ❌ cloud | ✅ (with Google account) | ✅ cited | ❌ | ❌ | ❌ | ✅ | ✅ |
| **World Anvil** | ❌ cloud | Free tier; full features paid | ❌ no AI | ❌ | ❌ | ❌ | ✅ | ✅ |
| **LegendKeeper** | ❌ cloud | Subscription | ❌ no AI | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Kanka.io** | ❌ cloud | Free tier; subscription for advanced | ❌ no AI | ❌ | ❌ | ✅ self-host option | ✅ | ✅ |
| **Obsidian + AI plugins** | ✅ | Variable | Plugin-dependent | ❌ | ❌ | Plugin-dependent | ✅ | Sync add-on |
| **ChatGPT / Claude.ai direct** | ❌ cloud | Limited free tier | ❌ hallucinates | ❌ | ❌ | ❌ | ✅ | ✅ |
| **D&D Beyond** | ❌ cloud | Free for character sheets; paid for content | ❌ no AI | ❌ | ❌ | ❌ | ✅ | ✅ |

✅ = strong / built-in. ❌ = absent or significantly worse. The table compresses tradeoffs — the collapsible sections below have the nuance.

**Read the last two columns first.** Every other column here is one this
project was built to win, which is exactly what makes a row of ticks worth
nothing on its own. What it loses:

- **Setup.** It wants Node, Git and a terminal before it will do anything.
- **Always available.** It answers from the machine it runs on, so a sleeping
  PC is a silent bot. (You can still ask from a phone via Discord — as long as
  that machine is awake.)
- **Corpus size.** The folder source stops including documents past roughly 200
  pages ([known issues](../troubleshooting/known-issues.md)).
- **Support.** There is no team behind it and nobody to escalate to.

Discord is Vault's oldest surface, not its only one: the same answer pipeline
also serves **Foundry VTT** (via a companion module, `/tusk <question>` in the
chat bar) and **any MCP client** — Claude Code, Claude Desktop, anything that
speaks the protocol. See [Foundry VTT](../surfaces/foundry-vtt.md). "Free forever" means the
software; you still pay whichever LLM provider you point it at, or nothing at
all on Ollama.

</div>
</details>

<details class="docs-section">
<summary><h2>🔍 Vault's claims — verified against the code</h2></summary>
<div class="docs-section-body">

Every row of the Vault column is backed by code that exists in this repo:

| Claim | Where it's enforced |
|---|---|
| **Local-first** | Default bind is `127.0.0.1` — see [`host-origin-guard.ts`](../../src/server/util/host-origin-guard.ts), which refuses requests whose `Host` is not a loopback literal. |
| **Source-grounded** | Canonical seven-rule block in [`prompt/system.ts → CANONICAL_RULES_BLOCK`](../../src/server/prompt/system.ts) is force-appended whenever the chosen system prompt doesn't already contain it — citation discipline is structurally guaranteed, not configurable away. |
| **Off-corpus refusal** | Rule 3 requires the bot to emit the canonical refusal phrase verbatim; the lore-gap detector picks it up via [`LORE_GAP_TRIGGER_FRAGMENT`](../../src/server/prompt/system.ts) and routes the question to the dashboard's Lore Gaps tab. |
| **Discord-native** | Bot client in [`src/server/discord/`](../../src/server/discord), message handling in [`src/server/surfaces/discord.ts`](../../src/server/surfaces/discord.ts). |
| **Three ask surfaces, one pipeline** | `SurfaceId` is `discord \| foundry \| mcp` ([`chat/types.ts`](../../src/server/chat/types.ts)); all three call the same [`chat/ask.ts`](../../src/server/chat/ask.ts), so persona, corpus and citation discipline are identical wherever the question came from. |
| **Encrypted keys** | AES-256-GCM, machine-bound, in the platform config dir — see [`keys/crypto.ts`](../../src/server/keys/crypto.ts). Never plaintext on disk. |
| **MIT open-source** | [LICENSE](../../LICENSE). |
| **One outbound network call per answer** | The LLM adapter — [`openrouter.ts`](../../src/server/llm/openrouter.ts) or [`gemini.ts`](../../src/server/llm/gemini.ts), Ollama over loopback, or a local Claude Code process that talks to Anthropic on your behalf. Discord adds its gateway connection when that surface is on; Foundry and MCP add none. No telemetry, no analytics, no phone-home. |
| **Nothing to install inside the app** | Local models and personas are ordinary features, not modules. There is no plugin system to learn and nothing to enable. |

</div>
</details>

<details class="docs-section">
<summary><h2>⚰️ What happens if this project dies</h2></summary>
<div class="docs-section-body">

Worth asking of anything you are about to trust with years of worldbuilding,
and it is the fair question to put to a project maintained by one person.

**Your source material is untouched.** Vault reads the folder you pointed it
at. It does not convert your documents, import them into a database, or move
them — there is no database, and `Tusks-Lore/` after a year of use contains
the same files you put there. Delete Vault and the folder is exactly what it
was.

**There is no export step, because nothing was captured.** Everything Vault
adds sits beside your documents as plain, pretty-printed JSON you can open in
any editor:

| File | What it holds |
|---|---|
| `clarifications.json` | The rulings you recorded, question and answer as text |
| `lore_gaps.json` | Questions your notes did not cover |
| `clarifications.embeddings.json` | Base64 vectors used for matching — derived data, regenerable |

An export button exists in hosted tools because the tool is holding something
of yours. Nothing here is holding anything.

**Nothing switches off, because nothing is running anywhere else.** There are
no servers, no account, no licence check and no phone-home, so there is no
lever anyone can pull to stop an install that already works. It keeps working
whether or not the project does.

**The code is MIT.** Fork it, patch it, hand it to whoever wants to keep it
going, or lift the one part you liked. [LICENSE](../../LICENSE).

### What you would actually lose

Not nothing, and the honest version matters more than the reassuring one:

- **Fixes stop.** Bugs on the [known issues](../troubleshooting/known-issues.md)
  list stay there.
- **Nothing adapts around it.** If Discord changes its gateway, or a provider
  changes its API or retires a model, an unmaintained Vault breaks at that
  surface and stays broken until someone patches it. This is the realistic
  way it dies — not deletion, but drift.
- **Dependencies rot.** The security advisories that ship in any Node project
  stop being triaged.

So the risk is real, but it is bounded, and it is a different shape from the
one hosted tools carry. There, the failure mode is your material becoming
inaccessible on somebody else's schedule. Here, the failure mode is a tool
that stops improving next to a folder of files that never depended on it.

</div>
</details>

<details class="docs-section">
<summary><h2>🧭 Tool-by-tool — the nuance</h2></summary>
<div class="docs-section-body">

One caveat before the list: everything said about Vault below is checked against this repository's code, but everything said about the *other* tools is a snapshot of products that are actively developed and priced by other people. Several of them are adding AI features. Check the current state of anything you are about to pay for rather than taking this page's word for it.

### NotebookLM (Google)

This is the closest comparison, so it gets the longest entry — and the concession first.

**What it's great at, and better at than this:** cloud-hosted retrieval over
documents you upload, with exact source citations and a genuinely excellent
interface. Free with a Google account, nothing to install, and built by a large
team with a budget — it will keep improving faster than a one-person project
can.

If what you want is to interrogate a pile of documents carefully and on your
own, use NotebookLM. This is not trying to beat it at that.

**What it does not attempt.** The distinction worth drawing is not quality, it is
purpose. NotebookLM is built for a reader alone with their sources. Almost everything
below is something a research notebook has no reason to have an opinion about:

- **It is a tab you visit, not a place answers appear.** Vault answers in your campaign
  Discord and in Foundry's chat bar, where the argument is already happening and
  everyone at the table sees the reply. That is the difference between settling a
  question and looking one up. (A per-world access mode decides whether players may ask
  at all, and whether answers are whispered or posted — see
  [Foundry VTT](../surfaces/foundry-vtt.md).)
- **It has one voice.** Vault ships eight personas, from a scholarly archivist to a
  foul-mouthed sellsword, and the citation rules survive all of them. A table's tone is
  half of why anyone enjoys asking.
- **It will not speculate, deliberately.** "Who is most likely to start a tavern fight"
  has no answer in anybody's notes. Vault's Speculative Mode reasons from established
  character traits, cites the evidence it used, and tags the conclusion `[speculation]`
  so a guess is never mistaken later for something the GM wrote. NotebookLM's grounding
  is a design commitment, and a correct one for research; it just rules out the
  questions a table most enjoys.
- **It sanitises grim material.** Campaign fiction inherits its genre — war, cruelty,
  horror, grief. Vault's prompt states plainly what the corpus is (authored fiction, the
  asker is one of its authors, the task is recitation) and recounts a scene as written.
  A summariser that softens the author's own writing back to them is failing at the job.
- **A GM ruling is not a first-class thing.** Vault's clarifications persist, embed, and
  get re-applied to differently-worded questions later, outranking the documents when
  they disagree. NotebookLM has no concept of "the GM overrides the source".
- **Your documents leave your machine.** Uploads live on Google's infrastructure. Vault
  keeps the corpus and the index local, sends only matched passages to the model you
  chose, and can run entirely offline against a local model.
- **You cannot change it.** Vault is MIT, forkable, and lets you pick the model — or
  swap it mid-campaign.

**Pick NotebookLM if** you want a polished cloud research notebook, you are mostly
working alone, and you are content for Google to hold your campaign.

**Pick Vault if** the answer needs to land where your group can see it, in a voice they
picked, about material a cloud summariser would flinch at — and you would rather the
whole thing ran on your own machine.

**Honestly: both.** They are not substitutes. Nothing stops you researching a setting in
NotebookLM and running Vault at the table.

### World Anvil

**What it's great at:** worldbuilding as a hypertext wiki. Beautiful presentation. Excellent for setting publication.

**Where Vault fits a different niche:**
- World Anvil is for *building* worlds and *presenting* them. Vault is for *querying* them at the table. Complementary, not competitive.
- World Anvil is a wiki, not a question-answering system. Mid-session lookups still mean searching and clicking through articles by hand.
- The free tier is a real, usable worldbuilding tier — you can write and publish articles on it. Presentation, privacy and organisational features are what the paid tiers add.
- You can export World Anvil articles and drop them into `Tusks-Lore/` — they come out as Markdown or HTML, both of which Vault's loader ingests (see `INGESTIBLE_EXTENSIONS` in [`loader.ts`](../../src/server/knowledge/loader.ts)).

**Pick World Anvil if** you want a beautiful public-facing wiki for your setting.
**Pick Vault if** you want to query an already-written setting from inside Discord during play.

### LegendKeeper

**What it's great at:** tree-structured world wikis with timelines, maps, relationship graphs. Solid private-campaign UX.

**Where Vault fits a different niche:**
- Subscription. Vault is free forever (MIT).
- LegendKeeper is a destination — players have to navigate to it. Vault is invoked where the conversation already is.
- No AI. No Discord. No voice integration.

**Pick LegendKeeper if** you love a structured private wiki and you want first-party tools for relationships/timelines.
**Pick Vault if** you want zero subscription and you live in Discord during play.

### Kanka.io

**What it's great at:** open-source campaign management with entities, relationships, calendars, journals. Self-host option exists. Generous free tier.

**Where Vault fits a different niche:**
- Kanka is a structured CRM-for-campaigns. Great if you want forms and fields. Vault is unstructured — drop any document in `Tusks-Lore/` and the bot reads it.
- No AI retrieval, no Discord-native answer flow.
- Players have to open another tab to use Kanka. Vault is right where they already are.

**Pick Kanka if** you love structured entity tracking and a campaign-management UI.
**Pick Vault if** your campaign already has 200 pages of free-form notes and you'd rather query them than re-enter them.

### Obsidian + AI plugins (Smart Connections, etc.)

**What it's great at:** local-first markdown vault. Massive plugin ecosystem. Best-in-class personal knowledge management.

**Where Vault fits a different niche:**
- Obsidian is for *you, the DM*, at your desk. Vault is for *everyone in your Discord*, during play.
- AI plugins for Obsidian vary widely in quality, citation behaviour, and refusal handling. Vault is purpose-built around "never invent campaign lore" with a Lore Gaps log when it doesn't know.
- No Discord integration in Obsidian.
- You can use both: keep your Obsidian vault as your DM workspace, then symlink or export the relevant notes into `Tusks-Lore/` for player-facing answers.

**Pick Obsidian if** you want a personal markdown brain.
**Pick Vault if** you want a player-facing campaign brain.

### ChatGPT / Claude.ai direct

**What it's great at:** general-purpose AI conversation. Huge capabilities. Free tiers exist. Both have a Projects feature that keeps uploaded files attached across chats, so "no memory of your campaign" is no longer a fair charge.

**Where Vault fits a different niche:**
- **Ungrounded, they will invent your campaign.** Asked "who is Ser Alric Vane?" with nothing attached, both will confidently produce a Ser Alric Vane. Vault is built not to: the canonical seven-rule block is appended to every prompt whatever persona is active ([`prompt/system.ts`](../../src/server/prompt/system.ts)), and an unanswerable question returns the refusal phrase, which Vault logs as a lore gap for you to fill. No prompt makes a model incapable of slipping — the difference is that here a slip breaks a stated rule, and leaves a citation you can go and check.
- Attaching files to a Project is a manual upload you keep re-doing as the campaign grows. Vault reads a folder or an Obsidian vault in place, re-walked on every question, so a note you edited two minutes ago is already current.
- Neither reaches your table. There is no Discord bot and nothing that answers in Foundry's chat bar.
- Whatever you attach lives on OpenAI's or Anthropic's servers. With Vault your documents stay on disk; only the question and the matched snippets travel to the provider you picked — or nothing leaves at all on Ollama.

**Pick raw ChatGPT/Claude if** you want general AI conversation, and you don't mind managing the uploads and re-checking the citations yourself.
**Pick Vault if** you want answers tied to your actual campaign notes, cited by filename, delivered where your table already is.

### D&D Beyond

**Different category.** D&D Beyond is for the *rules* and *characters*; Vault is for the *campaign-specific lore*. They don't overlap. Use both.

### Roll20 / Foundry VTT chat

**Different category, and for Foundry, a shipped integration.** These are virtual tabletops with chat as a side feature — they host the game, they don't answer questions about it.

For **Foundry VTT** the two are already joined. A companion module (its own repository, installed through Foundry) puts `/tusk <question>` in the chat bar, and the answer comes back cited — whispered or public — from the same corpus Discord queries. Pairing is a matching-code handshake, who may ask is set per world, and Vault keeps a separate per-install ceiling on answering non-GMs.

Read [Foundry VTT](../surfaces/foundry-vtt.md) before switching it on: Foundry's chat log *is* the table, so a whispered answer still hands the asker lore you have not revealed.

**Roll20** has no equivalent yet — it is on the [roadmap](../../ROADMAP.md) wishlist, gated behind their Pro-only API.

</div>
</details>

## Next steps

- 🎲 [Use cases — what players and DMs actually ask](use-cases.md)
- 🚀 [Setup — get answering in 5 minutes](../getting-started/installation.md)
- 🎯 [Foundry VTT — `/tusk` in the chat bar, and who may use it](../surfaces/foundry-vtt.md)
- 🪶 [Tomes companion project →](../lore/tusks-tomes.md)
- ❓ [FAQ — including honest costs](../troubleshooting/faq.md)
