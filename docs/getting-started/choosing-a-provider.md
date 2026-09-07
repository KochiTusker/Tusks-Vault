# Choosing a provider — Tusk's Vault

Tusk's Vault talks to four kinds of model. You pick one from the Home tab and
can change it whenever you like; nothing needs a restart.

| Connection | Needs a key? | What it costs | Good for |
|---|---|---|---|
| **OpenRouter** | Yes, one | Per token, billed by OpenRouter in USD | Almost everything. One key reaches Claude, GPT, Llama, Qwen and roughly four hundred others. |
| **Google Gemini** | Yes, one per project | Per token, billed by Google in USD. A free tier exists. | Getting started for nothing, and staying cheap afterwards. |
| **Claude Code** | No | Nothing extra — it draws on a Claude subscription you already pay for | Anyone who already has Claude Pro or Max. |
| **Ollama** | No | Nothing. Runs on your own machine. | Keeping the whole campaign offline. |

Every price Vault shows you is in **USD** — both of the metered connections
bill in dollars, and the dashboard never converts.

---

## Where do I put my Claude or OpenAI key?

You don't — an OpenRouter key reaches both. Claude, GPT and around four
hundred other models answer through that one key on one bill, so Vault has no
per-lab slots: three credentials to talk to two labs is three things to
rotate, three bills to reconcile, and no capability the single key doesn't
already have.

If what you have is a Claude *subscription* rather than an API key, that is
the **Claude Code** connection instead. It runs the CLI you are already
signed into and adds nothing to a bill.

Gemini keeps its own slot deliberately. It is cheaper called directly than the
same model through an aggregator, so routing it through OpenRouter would
charge you more for identical output.

---

## OpenRouter

One key, one bill, and a catalogue of roughly four hundred models from every
major lab. Get one at [openrouter.ai/keys](https://openrouter.ai/keys).

**Every request pins a privacy floor.** Vault asks OpenRouter to route only to
providers that do not retain prompts and do not train on them
(`zdr: true`, `data_collection: deny`). Your campaign corpus goes out with
every question, so that is the default on every single request and there is no
global switch that turns it off.

The trade-off is honest: a model whose only hosts retain prompts is
unreachable under that floor, and reports exactly that — *"No zero-retention
host serves it, so Vault's privacy floor excludes it"* — rather than failing
mysteriously. This is most of the `:free` variants, which are free precisely
*because* their hosts keep prompts.

There is one way past it, and it is deliberately narrow. Picking a zero-priced
model from the **Home-tab model picker** asks you first, names what you are
giving up, and records the consent — with three limits:

- **Per model id.** Choosing a different model later does not carry the consent
  with it.
- **Not a global flag.** Every other model still routes under the floor.
- **Home tab only.** The Settings model browser's **Use** button offers no such
  prompt, so a free model selected there keeps erroring until you pick it from
  the Home-tab picker.

The **model browser** (Settings → API keys) shows the live catalogue before you
have pasted any key at all — OpenRouter publishes it without auth. Per row: USD
price per million input and output tokens, context window, whether the model's
hosts moderate prompts, whether they retain or train on them, and Vault's own
measured accuracy and mature-content grades. Prices come from OpenRouter
itself, cached for 24 hours.

---

## Google Gemini

Two slots, labelled **Free** and **Paid** in the picker, because a no-billing
Google project and a billing-enabled one are different keys with genuinely
different reach — and plenty of people have both. Get a key at
[aistudio.google.com](https://aistudio.google.com/apikey).

The free tier is genuinely free and genuinely usable. The catch is that
Google advertises the same model list to both kinds of key and only refuses at
the moment you ask a question — as a 429 with `limit: 0` — which is why Vault
can test them for you (see below).

Each slot is tested with the key stored *in that slot*, not with whichever
Gemini key happens to be first, so two keys give you two honest answers rather
than the same one twice.

---

## Claude Code

If you already pay for Claude Pro or Max, Vault can answer through the
`claude` command-line tool you are already signed into. No API key, no
per-token bill; it draws on your plan's usage window like any other Claude
Code session.

**Setup**: install the Claude Code CLI, run `claude login`, and the option
appears in the Active Provider picker. Vault never handles your login — it
only invokes a binary you have already authenticated.

**What Vault does with the environment**: it strips `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` from the child process,
case-insensitively. A stray key in your environment otherwise takes
precedence inside the CLI and quietly bills the API instead of your
subscription — the opposite of why anyone picks this option.

**Limits worth knowing**:

- Text only. The CLI has no binary channel: PDFs are extracted to text
  first, and an attached image is announced in the prompt — *"An image was
  attached… switch to OpenRouter or Gemini for image questions"* — rather than
  silently dropped.
- Answers are slower than a direct API call — 5–10 seconds of process
  startup on every question, and they run one at a time. Two at once is
  measurably slower than two in sequence, because both draw on the same
  subscription window, so further questions queue instead.
- When your usage window runs out you get a clear message saying so. It
  resets on a rolling schedule.
- The endpoint that runs the CLI only accepts requests from the machine
  running Vault, even if you have opened the dashboard to your LAN. Reading
  lore over the network is fine; starting a process on the host is not.
- The CLI is spawned in an empty temp directory rather than the repo, so a
  prompt-injected tool call — the question and the lore around it are both
  untrusted text — finds an empty sandbox instead of your source tree,
  `.git`, or `.env.local`.

---

## Ollama

Local models on your own hardware, at no cost and with nothing leaving the
machine. Install [Ollama](https://ollama.com), `ollama pull` a model, and the
option appears once Vault can see the server.

There is nothing to install inside Vault and nothing to enable. Ollama is
either answering on its port or it is not, and the picker asks that question
rather than making you flip a switch.

Set the base URL under Settings → Integrations if you have moved it from the
default. It must be a loopback address — a remote URL would turn the
dashboard into a way to make requests to your internal network.

---

## Testing which models actually work

A catalogue is an advertisement, not a promise.

- Google returns the same model list to a free key and a paid one. The refusal
  arrives later, as a quota error, the first time you ask a real question.
- OpenRouter's catalogue lists every model on the platform, including ones
  that no zero-retention host serves — which Vault's privacy floor excludes.

Both leave you with a model in the dropdown that cannot answer. So Vault can
test them: **Test which work**, on the Home tab under the Active Provider
picker, asks each connection the question that actually settles it and
remembers the answer.

What that means per connection, because they are not the same question:

- **Gemini** — lists the models, then makes a real one-token call to each text
  model on the list.
- **OpenRouter** — probes a *shortlist*: what you have configured now, plus
  whatever you are considering in the model browser. Probing four hundred
  models would take minutes and spend real money to answer a question nobody
  asked. Crucially the probe carries the same privacy-floor routing a real
  question does; probing without it would report a model reachable and then
  fail every actual question.
- **Claude Code** — the three aliases (`sonnet`, `opus`, `haiku`); the question
  is whether the CLI answers at all.
- **Ollama** — asks the server what you have pulled. That list *is* the answer,
  so nothing is generated and nothing is spent.

Afterwards the picker marks each model:

| Mark | Meaning |
|---|---|
| ✓ | Tested, and it answered. |
| 🔒 | A Gemini Pro model sitting in front of a key filed under the free slot. Google removed Pro from the API free tier, so its quota there is zero. Shown but not selectable, with the fix on the row — this one needs no test to know. A probe that *does* reach the model overrides it, because "free slot" is a label you chose, not an entitlement Google issued. |
| *(nothing)* | Not tested. It may well work — nobody has checked. |
| ✕ | Tested, and it refused. The reason is on the row and the option is greyed out. |

The untested state is deliberate. Hiding untested models would hide working
ones; marking them as verified would promise something nobody tested.

Models a probe has *proven* this key cannot call are **dropped from the list**,
not greyed out. An unfiltered Gemini list on a free key is mostly paid-only
entries, and reading as "these are your options" when they are not is worse
than a shorter list. The count line below the dropdown says how many were
hidden and why.

**The one exception is the model you currently have selected** — which is the
usual place you'll see a ✕. If that is the one that stopped working, removing
it silently would hide both your choice and the reason it now fails.

The test costs one token of output per model on the metered connections, so it
never runs on its own. Results are remembered until the key behind them
changes, at which point they are discarded — an answer about a key you no
longer have is worse than no answer.

---

## Retries and rate limits

Every cloud call goes through a shared retry layer that backs off on 429s and
transient 5xx errors.

A 429 is treated as a statement about the **key**, not the model: the backoff
applies to every model on that provider, so switching model does not escape
the wait. That is the truth of how rate limits work, and pretending otherwise
would just produce a second failure.

## Per-surface providers

Each of the three chat surfaces — Discord, Foundry, MCP — can pin its own
provider and model, independently of what the dashboard uses for its own work
(vault-map builds, persona generation). Resolution is surface override → global
setting; a surface with no override just follows the global one.

This is what makes "answer on a subscription" practical: point the Foundry and
Discord surfaces at **Claude Code** and questions from the table cost nothing at
the margin, while the dashboard keeps using whatever metered key you selected.

The trade is real, and the Surfaces card spells it out on the Foundry and MCP
rows whenever they resolve to Claude Code: **5–10 seconds per answer, one at a
time.** Each answer spawns a CLI process drawing on one shared subscription
window, so questions queue rather than run together.

**There is no dashboard control for the override yet.** The setting exists, the
API accepts it and the resolution works, but the Surfaces card only shows you
the consequence — it has no per-surface provider dropdown. Until it does, the
override is set by `POST`ing to `/api/settings` (send
`{"surfaces":{"foundry":{"provider":"claudeCode"}}}`; an empty string clears it
back to "follow the global setting"). If you have not done that, every surface
uses the connection selected on the Home tab.

The same MCP endpoint the Foundry module uses also lets **Claude Code or Claude
Desktop query your corpus** — the campaign becomes something you can ask about
from an agent session, not just from chat. Switch *Surfaces → Other MCP clients*
on and pair. See [Foundry VTT](../surfaces/foundry-vtt.md#the-same-endpoint-serves-other-mcp-clients).

---

- 🏗 [Architecture — how it all fits together →](../about/how-its-built.md)
- 📚 [Lore sources — the folder and the Obsidian vault →](../lore/obsidian-vault.md)
- 🎲 [Foundry VTT — asking from the game chat bar →](../surfaces/foundry-vtt.md)
- 🔒 [Privacy — what leaves your machine →](../security/privacy.md)
- 🚀 [Setup →](installation.md)
