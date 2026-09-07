# Tusk's Tomes — the companion chronicler

← Back to [README](../../README.md)

> Vault answers questions about your campaign. **[Tusk's Tomes](https://github.com/KochiTusker/Tusks-Tomes) records the sessions in the first place.** They're built to be paired — drop them next to each other on disk and they auto-detect; install one without the other and both still work.

---

<details class="docs-section" open>
<summary><h2>📜 Why you would want both</h2></summary>
<div class="docs-section-body">

Vault is only as good as what you feed it, and the hardest campaign material
to produce is a record of what actually happened at the table. Notes get
thinner every week; nobody writes up session fourteen.

Tomes is the other half: a locally-hosted chronicler that turns a session
recording into a written chronicle, saved straight into the folder Vault
already reads. Do that and the loop closes — you play, and by the morning the
session is a thing your players can ask questions about, cited, in Discord.

That is the whole pitch for the pair. **What Tomes is, what it costs, what it
needs and how to install it are all explained far better on its own site:**

> ### [Tusk's Tomes →](https://kochitusker.github.io/Tusks-Tomes/)

Same convictions as Vault: local-first, MIT, no account and no telemetry. Both
work perfectly well alone — Vault is happy with lore you wrote by hand, and
Tomes is happy writing chronicles wherever you point it. The pairing is a
convenience, not a dependency.

</div>
</details>

<details class="docs-section">
<summary><h2>🤝 The shared `Tusks-Lore/` folder</h2></summary>
<div class="docs-section-body">

Both projects read and write the same on-disk folder. Save a chronicle there from Tomes and Vault needs no import, no sync and no reindex to answer from it.

```
parent-dir/
├── Tusks-Tomes/        (the chronicler — optional)
├── Tusks-Vault/        (this repo — the answerer)
└── Tusks-Lore/         ← shared knowledge directory
    ├── tusks-lore.json (Tomes' consolidated glossary + speaker map)
    └── Sessions/
        └── <campaign>/
            ├── Session-01-2026-05-19-full.docx
            └── Session-01-2026-05-19-condensed.docx
```

- **Vault** walks `Tusks-Lore/` recursively on every question — files at any depth surface as lore. There is no cache: the folder is re-read each time, so a chronicle saved a minute ago is already citable. `.docx`, `.pdf`, `.md`, `.txt`, `.html` and a few more are all ingested; see `INGESTIBLE_EXTENSIONS` in [`loader.ts`](../../src/server/knowledge/loader.ts).
- **Tomes** writes its chronicle files into `Tusks-Lore/Sessions/<campaign>/` when you press *Save full .docx* (or *Save condensed .docx*) on a finished chronicle. That click is the only manual step in the loop.
- **A few filenames are skipped from generic ingestion**, matched on the basename at any depth: `tusks-lore.json`, `glossary.json`, `speakers.json`, the README, dotfiles, `_`-prefixed files, and Vault's own state files (`clarifications.json`, `lore_gaps.json`, `tusks-vault.log`). Tomes' JSON is structured metadata rather than prose; Vault's own state is worse — left unfiltered the bot reads its list of unanswered questions back as campaign canon and cites it.
- **You can use either project standalone.** Vault is happy with hand-uploaded lore and no Tomes. Tomes is happy writing chronicles wherever you point it; the pairing is an opt-in convenience, not a hard dependency.

Vault auto-detects the sibling folder via the resolution order documented in [How it's built](../about/how-its-built.md#-the-shared-tusks-lore-folder): `TUSKS_VAULT_LORE_PATH` in the environment, then a path set in `settings.json`, then a sibling `../Tusks-Lore/`, then repo-local `Lore/` as the fallback. The resolution happens once at boot, so moving the folder needs a restart.

</div>
</details>

<details class="docs-section">
<summary><h2>🔄 The capture loop</h2></summary>
<div class="docs-section-body">

```
   Play  →  Record  →  [ Tomes ]  →  Tusks-Lore/  →  [ Vault ]  →  Cited answer
                       transcribes     the shared      reads the      "@Tusk what
                       and writes      folder both     folder on      happened in
                       the chronicle   projects use    every question  session 5?"
```

**Saving the chronicle is the only manual step**, and it is one click on the
Tomes side. Nothing is imported, synced or reindexed afterwards: Vault re-reads
the shared folder on every question, so a chronicle saved a minute ago is
already citable, in Discord, in Foundry, or from an MCP client.

Play on Saturday, save on Sunday, and by the time someone asks *"wait, what
did we actually agree with the harbourmaster?"* the answer is there with the
chronicle cited next to it.

How Tomes gets from a recording to a chronicle — transcription, speaker
attribution, the writing pipeline, what it can run offline — is covered on
[its own site](https://kochitusker.github.io/Tusks-Tomes/).

</div>
</details>

---

## What adding Tomes changes

Both projects work alone. This is what the pairing is actually for:

| Capability | Vault standalone | Vault + Tomes |
|---|---|---|
| Ask your lore in Discord or Foundry | ✅ | ✅ |
| Cited, source-grounded answers | ✅ | ✅ |
| Reads a folder or an Obsidian vault | ✅ | ✅ |
| Turn a recorded session into a written chronicle | ❌ | ✅ |
| Those chronicles answerable the moment they are written | — | ✅ |

Everything above the line is Vault doing its ordinary job. Tomes adds one
thing — turning a recorded session into a written chronicle — and Vault then
reads that chronicle like any other document.

## Next steps

- 🔌 [Vault's providers →](../getting-started/choosing-a-provider.md)
- 🧠 [How Vault walks the shared lore folder →](../about/how-its-built.md)
- 🪶 [Tusk's Tomes — what it is and how to install it →](https://kochitusker.github.io/Tusks-Tomes/)
