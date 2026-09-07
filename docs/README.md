# Documentation — Tusk's Vault

Tusk's Vault is a local-first lore assistant for tabletop campaigns. You point
it at the notes you already keep, and it answers questions about them from
Discord, from Foundry VTT's chat bar, or from any MCP client — citing the file
each claim came from, and refusing when your notes don't cover it.

These pages are the same ones the app shows under its **Help** tab, so you can
read them offline once Vault is installed.

## Getting started

- **[Installation](getting-started/installation.md)** — clone to first cited
  answer, including what to do when a step stalls.
- **[Choosing a provider](getting-started/choosing-a-provider.md)** —
  OpenRouter, Gemini, Claude Code or Ollama: what each costs, what it sees,
  and which to start with.
- **[Uninstalling](getting-started/uninstalling.md)** — what the uninstaller
  removes, what it deliberately keeps, and the four things you must finish
  yourself.

## Asking from your table

- **[Discord](surfaces/discord.md)** — four steps in Discord's developer
  portal, then one paste into Vault.
- **[Foundry VTT](surfaces/foundry-vtt.md)** — `/tusk` in the chat bar
  mid-session, and the two separate controls over who may ask.

## Your lore

- **[Obsidian vault](lore/obsidian-vault.md)** — point Vault at a vault you
  already keep. Read-only, enforced by a test that scans for writes.
- **[Tusk's Tomes](lore/tusks-tomes.md)** — the companion that records
  sessions and writes the chronicles Vault then answers from.

## Privacy & safety

- **[Privacy](security/privacy.md)** — what stays on disk, what reaches a
  provider, and what is never sent. Written to be checkable, not reassuring.
- **[Security policy](../SECURITY.md)** — what counts as a vulnerability here
  and how to report one.

## Help

- **[FAQ](troubleshooting/faq.md)** — the questions that come up first.
- **[Known issues](troubleshooting/known-issues.md)** — what is broken or
  missing today, stated plainly.

## About the project

- **[How it's built](about/how-its-built.md)** — retrieval, prompt assembly,
  and where every outbound call goes.
- **[Use cases](about/use-cases.md)** — six workflows end to end.
- **[What it costs](about/what-it-costs.md)** — per-session estimates for every
  provider, the one lever that moves the bill, and where to set a cap.
- **[Comparison](about/comparison.md)** — against hosted bots, wiki SaaS, and
  pasting your notes into a chatbot.
- **[Dependencies](about/dependencies.md)** — every library and why it earns
  its place.
- **[Roadmap](../ROADMAP.md)** — shipped, next, and deliberately not planned.
- **[Contributing](../CONTRIBUTING.md)** — how to file an issue or send a
  change.

---

Vault is MIT-licensed and runs entirely on your own machine. There is no
account, no subscription, and no telemetry.
