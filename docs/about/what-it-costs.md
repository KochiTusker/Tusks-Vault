# What it costs

← Back to [README](../../README.md)

**Vault itself is free.** MIT-licensed, no subscription, no account, no
telemetry, no paywalled features. The only money involved is whatever your
chosen model charges for tokens, paid to the provider — never to this project.

> **Prices are set by the providers, not here.** They have trended down, but a
> provider can raise a price, retire a model or change a free tier at any time.
> The code stays free; the cost of running questions through it is whatever the
> provider charges that week.

---

## Per session

A 3–4 hour session, 30–50 questions, against a campaign of roughly 100 KB of
documents. Quoted in USD, because every one of these bills in dollars.

| Provider | Tier | Typical session | Notes |
|---|---|---|---|
| **Gemini** | Free | **$0** | Per-minute and daily quotas cover most home games. Pace yourself during big info-dumps. |
| **Gemini** | Paid (Pro 2.5) | ~$0.60–$2.50 | Pay-as-you-go; spend matches what you asked. |
| **OpenRouter** | Mid-tier (e.g. Sonnet) | ~$0.60–$4.00 | One key, one bill, ~400 models. Live per-model pricing in the model browser. |
| **OpenRouter** | Frontier (e.g. Opus) | ~$4.00–$12.00 | Overkill for most questions; reserve for hard consistency problems. |
| **Claude Code** | Your existing plan | **$0** extra | Answers through the subscription you already pay for. No API key, no metered bill. |
| **Ollama** | Local | **$0** ongoing | Hardware you already own. Quality lags cloud frontier below ~15B params. |

---

## The one lever that matters

**How much lore goes into each prompt.** With the folder source, Vault
re-reads and re-sends every file under `Tusks-Lore/` on every question,
stopping at the last whole document that fits under `KB_CHAR_LIMIT`
(500,000 characters). A 30-PDF campaign costs noticeably more per question
than a 5-PDF one.

Pointing Vault at an [Obsidian vault](../lore/obsidian-vault.md) is the one
shipped way to pay for a handful of relevant notes instead of the whole shelf
— and it only starts narrowing once the vault outgrows the prompt budget,
because below that, sending everything is both cheaper and better.

---

## Capping it

Set limits **at the provider**, not in Vault:

- **OpenRouter** → *Settings → Credits*. It is prepaid, so the balance is the cap.
- **Google AI Studio** → *Billing → Budget alerts*.

That is where the card lives, so that is where the kill switch belongs. Vault
cannot enforce a limit on a bill it never sees.

---

## What is being done to bring it down

- **Chunked retrieval for the folder source** — bring to it what the Obsidian
  vault map already does: embed once, then retrieve only matching notes per
  question. The single biggest token reduction the architecture can deliver.
- **Prompt caching** — partly shipped. Assembly already marks the lore corpus
  as the cacheable prefix and the OpenRouter adapter sets the `cache_control`
  breakpoint on it, keeping per-question parts outside. Instrumenting the
  saving so you can *see* it is what remains.
- **Per-tier routing** — easy lookups to Flash-class models, Pro/Opus reserved
  for questions that need them.

[Ollama](../getting-started/choosing-a-provider.md) stays the zero-marginal-cost
escape hatch, and Claude Code costs nothing extra on a plan you already have.

See the [Roadmap](../../ROADMAP.md) for where these sit.

---

## Next steps

- [Choosing a provider](../getting-started/choosing-a-provider.md) — what each
  one sees, costs and needs.
- [How it's built](how-its-built.md) — why the corpus travels with every question.
