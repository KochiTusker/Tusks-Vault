# `Lore/` — your campaign documents live here

This folder is the **fallback** location for your campaign lore — Tusk's
Vault will still read documents you drop here if no other lore folder
is configured. The **recommended** layout uses a sibling `../Tusks-Lore/`
folder instead, which the dashboard's Lore tab can create for you
in one click. See [docs/Architecture.md → The shared Tusks-Lore folder](../docs/about/how-its-built.md#-the-shared-tusks-lore-folder)
for the resolution order Vault uses at boot.

Whichever location you use, anything you drop into it is indexed for
retrieval the next time someone asks the bot a question.

## Supported file formats

| Format         | Extension                       | Notes |
|----------------|----------------------------------|-------|
| PDF            | `.pdf`                          | Text is extracted. Images inside PDFs aren't read yet (on the roadmap). |
| Word           | `.docx`                         | Full text. |
| Plain text     | `.txt`                          | UTF-8. |
| Markdown       | `.md`, `.markdown`              | UTF-8. |
| JSON / YAML    | `.json`, `.yaml`, `.yml`        | Treated as raw text. |
| CSV / TSV      | `.csv`, `.tsv`                  | Treated as raw text. |
| HTML           | `.html`, `.htm`                 | Tags stripped, text kept. |
| RTF            | `.rtf`                          | Control words stripped, text kept. |
| **Google Docs**| download as `.docx` or `.txt`   | Then drop the exported file here. |

## Three ways to add files

1. **Drag-and-drop** into this folder while the server is running.
   Tusk's Vault re-reads the folder on every Discord query, so it
   picks up new files immediately.
2. **Upload via the dashboard** — open Tusk's Vault in your browser
   and use the *Lore* tab. Files land in whichever lore folder is currently resolved — the sibling folder if you made one, otherwise this one.
3. **Sync from [Tusk's Tomes](https://github.com/KochiTusker/Tusks-Tomes)**
   — if you have the companion project installed alongside this one,
   the dashboard's "Paired with Tusk's Tomes" card will offer to
   one-click import every session chronicle as lore.

## Privacy

This entire folder is in `.gitignore` (except for *this* README). Your
campaign documents stay on your machine — they're never pushed to
GitHub. Tusk's Vault makes exactly two outbound network calls per
query: the LLM connection of your choice (Gemini, OpenRouter, Claude
Code or a local Ollama) and Discord, if you've set up the bot.

## This README is safe

Tusk's Vault's knowledge loader specifically **ignores** `README.md`
files inside `Lore/`, so this placeholder won't pollute the answers
your players see. Anything else you drop here gets indexed normally.
