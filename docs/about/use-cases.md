# Use cases — Tusk's Vault

← Back to [README](../../README.md)

**For TTRPG Game Masters and players who want to keep track of what goes on during sessions.** What people actually ask the bot, who it's built for, and the workflows that show up most often in active campaigns.

---

<details class="docs-section" open>
<summary><h2>👥 Who it's for</h2></summary>
<div class="docs-section-body">

### 🎭 Game Masters

- **Mid-session recall** without scrubbing through six Google Docs while four players wait.
- **Worldbuilding consistency check** — query your own setting like an outsider would, and surface contradictions before players do.
- **Convert hallway-DM-conversations into canon** — record the answer to "wait, is that elf the king's brother or his cousin?" once via Clarifications, and it stays remembered forever (even when future players paraphrase the question).
- **Player-onboarding co-pilot** — new player joining a 30-session campaign? Tell them to ask Tusk what they want to know about the world, instead of writing them a primer.

### 🛡️ Players

- **Catch up after missing a session** without bothering the DM at 1am.
- **Verify what you actually agreed to** ("did we tell the merchant we'd come back, or was that the other one?") with a citation, so debates stay short.
- **Lookup your own character's backstory** during a roleplay moment without breaking out of the game.

### 📜 Worldbuilders

- **Stress-test new lore against existing canon** — drop a draft document into `Tusks-Lore/`, ask the bot about it. Inconsistencies surface as contradictions because every claim is cited.
- **Find what you forgot you wrote** — a 200-page worldbuilding bible becomes searchable for the first time.

### 🎮 Streamers + actual-play creators

- **Answer chat questions live** without breaking immersion. "Who's the duke again?" gets a one-line answer in your campaign Discord — or in Foundry's chat bar, if that's where you run — while you stay in the scene.
- **Episode recap generator** — ask Tusk to summarise the last three sessions for your YouTube description.

</div>
</details>

<details class="docs-section">
<summary><h2>🎲 What people actually ask</h2></summary>
<div class="docs-section-body">

The examples below are written as Discord mentions because that is the oldest
surface. The same questions work verbatim in Foundry VTT's chat bar as
`/tusk who is Ser Alric Vane?` (see [Foundry VTT](../surfaces/foundry-vtt.md)), and as an
`ask_lore` call from any MCP client — one pipeline answers all three, so the
persona, the corpus and the citations are identical whichever you use.

| Someone in your server asks... | Tusk's reply... |
|---|---|
| `@Tusk who is Ser Alric Vane?` | Cited recall from session-3 notes plus any DM clarifications about him. |
| `@Tusk what happened in session 7?` | A summary citing the session-7 chronicle file (or the [Tusk's Tomes](../lore/tusks-tomes.md) chronicle, if you saved one into the shared folder). |
| `@Tusk what factions are at war right now?` | Faction-by-faction breakdown citing your worldbuilding docs. |
| `@Tusk what's our cleric's god's domain?` | Character recall from the party-sheet doc. |
| `@Tusk what did we agree to last session about the cursed amulet?` | Pulls the agreement out of the session log so the DM doesn't have to scroll back. |
| `@Tusk who would most likely walk into a tavern and try to start a bar fight?` | *(Speculative Mode only)* A reasoned guess based on character personalities, tagged `[speculation]`. |
| `@Tusk what's the capital of France?` | *"I am unsure about this detail. I have recorded this as a lore gap for the DM to clarify."* — and the question lands in the dashboard's Lore Gaps tab. |
| `@Tusk how does grappling work?` | A 5e rules answer, tagged `[D&D 5e]`. |
| `@Tusk does Lady Ismet Corrin know about the cult?` | Honest "the chronicles don't say" if it's not in the lore, plus a flagged gap. |

</div>
</details>

<details class="docs-section">
<summary><h2>🔄 Common workflows</h2></summary>
<div class="docs-section-body">

### 1. Drop-in lore reference

1. Drag a session journal into your lore folder — the sibling `Tusks-Lore/` next to the Vault repo, or `<repo>/Lore/` if you have not made one.
2. Ask `@Tusk` about it in Discord.
3. Done.

The bot walks `Tusks-Lore/` recursively on every query, so updates are instant — no rebuild, no reindex. Sub-folders are fine; the file's relative path becomes its citation marker.

### 2. Resolving a lore gap

1. Someone asks something the bot doesn't know. Bot replies: *"I am unsure about this detail. I have recorded this as a lore gap for the DM to clarify."*
2. The DM opens the dashboard → **Home** → the campaign card's **Lore Gaps** tab.
3. Type the canonical answer.
4. The clarification is embedded locally (via MiniLM on CPU) and stored as `clarifications.json` + `clarifications.embeddings.json` **inside your `Tusks-Lore/` folder** — so it follows your campaign and survives a clean reinstall of the app.
5. The next time anyone asks anything semantically similar — even if they phrase it differently — the answer surfaces automatically. You only teach Tusk a fact once.

A clarification outranks the knowledge base when the two disagree (rule 4 of the canonical rules block), which is what makes this the way to correct the archive rather than editing a document.

### 3. Tomes → Vault session loop (with the optional companion installed)

The full **[Tusk's Tomes](../lore/tusks-tomes.md)** + Vault workflow:

1. **Play** your session.
2. **Record** the audio (Craig multitrack, OBS, phone — whatever you have).
3. **Transcribe** with Tomes' optional Audio Transcription module (offline Whisper), or paste in a transcript you produced yourself.
4. **Chronicle** via Tomes' six-phase LLM pipeline — produces a polished narrative chronicle.
5. **Save it into the shared folder.** On the finished chronicle in Tomes, *Save full .docx* writes it to `Tusks-Lore/Sessions/<campaign>/`. One click, and nothing to import on the Vault side.
6. **Query.** From that moment on, "what happened in session 5?" cites the chronicle Tomes produced that morning — no rebuild, no reindex.

Each step is independent — you can do steps 3-5 by hand without Tomes and the rest still works.

### 4. Switching LLM mid-campaign

1. Hit Gemini's free-tier rate limit during a busy session?
2. Open the dashboard → **Home** → **Active Provider** picker → switch to another key, to Claude Code, or to Ollama.
3. Next message uses the new provider. No restart, no config file edit.

A rate limit is a statement about the *key*, not the model — the retry layer holds the whole provider for the backoff, so swapping model within the same provider will not escape a 429. Switch provider, or wait.

### 5. Reading lore from your Obsidian vault instead

1. **Lore → Lore source** in the dashboard.
2. Paste the vault's folder path and press **Check**. Vault reports what it found — notes, folders, frontmatter fields — so you can confirm it is the right one.
3. Press **Use this vault**.
4. For a large vault, press **Build map**: Vault reads every note once and reduces each to a line, so later questions carry the whole map plus only the notes they need.

Vault never writes to your vault. Switch back to the folder at any time — nothing is moved or changed. See [Obsidian vault](../lore/obsidian-vault.md).

### 6. Asking from inside Foundry VTT

1. Dashboard → **Home** → **Surfaces** → switch **Foundry VTT** on.
2. In Foundry, enable the **Tusk's Vault** module, then *Connect to Tusk's Vault* from its settings. Both ends show the same six-digit code; check they match and click **Allow**. There is no token to copy.
3. Anyone the world's **Who may ask** setting admits types `/tusk who runs the harbour?` in the chat bar. The answer comes back cited, whispered to the asker and GMs by default.

Two things to decide before you let players use it.

- **Who may ask** is set per world, in Foundry. Vault holds a separate
  per-install ceiling (*Answer players, not just the GM*) that is **off** by
  default, so both ends must allow it.
- **Vault answers from the whole corpus**, with no notion of what you have
  revealed. A whisper hides an answer from the rest of the table, not from the
  player who asked.

[Foundry VTT](../surfaces/foundry-vtt.md) covers both properly.

</div>
</details>

---

## Next steps

- 🚀 [Setup → run your first query in 5 minutes](../getting-started/installation.md)
- 🎯 [Foundry VTT — `/tusk` at the virtual table](../surfaces/foundry-vtt.md)
- 🧠 [Architecture — how citations actually work](how-its-built.md)
- 🔌 [Providers — OpenRouter, Gemini, Claude Code, Ollama](../getting-started/choosing-a-provider.md)
- 📚 [Obsidian vault as a lore source](../lore/obsidian-vault.md)
- 🆚 [Comparison — why this beats raw ChatGPT for campaigns](comparison.md)
- ❓ [FAQ — costs, privacy, troubleshooting](../troubleshooting/faq.md)
