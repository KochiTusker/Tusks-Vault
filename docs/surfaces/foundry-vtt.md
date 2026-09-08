# Foundry VTT — Tusk's Vault

Vault can answer questions typed into Foundry's chat bar. This document covers
how that works, what it costs, and — the part worth reading before you switch it
on — what a player can pull out of the archive.

The Foundry-facing half is a separate artifact in its own repository: the
**Tusk's Vault module**, installed through Foundry. This page is about the
Vault side; the wire contract between the two is in
[Foundry contract](../tooling/foundry-contract.md).

---

## The shape of it

```
  player types /tusk …
         │
         ▼
  their client posts a marked ChatMessage        (no network — Vault is not
         │                                        reachable from their machine)
         ▼
  the ACTIVE GM's client sees that document
         │
         ▼  MCP over HTTP, to 127.0.0.1
  Vault  ──► chat/ask.ts ──► the same corpus, persona and citation
         │                    discipline that answers a Discord mention
         ▼
  the GM's client posts the answer, whispered or public
```

Two facts decide that shape:

**Foundry has no server-side API.** A Foundry module is a `module.json` plus
JavaScript that runs in the *browser*. There is no REST endpoint and no
supported way for an outside process to inject a chat message, so the direction
of travel is fixed: the module dials out to Vault, never the reverse.

**A player's browser cannot reach Vault.** Vault listens on the GM's loopback
address. So the asker's client swallows the command and posts a question
document, and `game.users.activeGM` — which returns exactly one active GM —
elects the single client that relays it. Without that election, two connected
GMs would each relay and the table would get the answer twice, billed twice.

If no GM is connected, nothing can reach the archive. The module says so rather
than swallowing the question.

---

## Setting it up

1. **Switch the surface on.** Dashboard → **Home** → **Surfaces** → **Foundry VTT**. Off by default, as is the player ceiling below it.
2. **Install the module.** Vault answers in Foundry through a separate
   companion module. It runs in two modes, picked under *Module Settings →
   Where answers come from*: **Lite** answers from the journal entries in one
   Foundry folder and needs nothing else installed, and **Bridge** relays to
   Vault running on the GM's machine so the answers come from your whole
   archive instead. This page is about Bridge — for Lite, the module's own
   [README](https://github.com/KochiTusker/Tusks-Vault-Foundry) is the guide.

   In Foundry: **Setup → Add-on Modules → Install Module**, then search the
   package list for *Tusk's Vault*. It is
   [listed on the Foundry package registry](https://foundryvtt.com/packages/tusks-vault),
   so searching is the shortest route and updates arrive through Foundry's own
   update check.

   If you would rather paste a manifest, this is the URL:

   ```
   https://github.com/KochiTusker/Tusks-Vault-Foundry/releases/latest/download/module.json
   ```

   The module lives in its own repository,
   [Tusks-Vault-Foundry](https://github.com/KochiTusker/Tusks-Vault-Foundry),
   and versions independently of this app — a Vault release does not imply a
   module release, or the reverse.
3. **Enable it.** In your world: Settings sidebar → **Module Management** →
   tick **Tusk's Vault** → *Save Module Settings*. Foundry reloads every
   connected client when you do this, so pick a moment between scenes.
4. **Pair.** Settings sidebar → **Game Settings** → **Module Settings** →
   **Tusk's Vault** → *Connect to Tusk's Vault*. Foundry
   shows a six-digit code; the dashboard shows the same code beside
   **Allow** / **Deny**. Check they match, then Allow.

There is no token to copy. The code is what makes the approval *specific*:
without it, a page the GM happened to have open could fire its own pairing
request at the same moment and they would have no way to tell which prompt they
were approving. A hostile page can raise a prompt — it cannot make Foundry
display its code.

Requests expire after two minutes, only one may be outstanding at a time, and a
denial is remembered for an hour so a page cannot grind the GM into a mis-click.

---

## Who may ask, and who sees the answer

There are two controls and they are deliberately **not** copies of each other.

### The access policy — in Foundry, per world

Two controls, deliberately independent of each other. A single tri-state welded
them together, produced one combination nobody wanted (GM-only questions
answered publicly) and could not express the one tables kept asking for:
players may ask, but the GM reads the answer first.

**Who may ask** — a floor on the asker's Foundry role:

| Rank | Who it admits |
|---|---|
| `nobody` | Only the chosen askers below. |
| `gamemaster` | Full Gamemasters. *Not* Assistant GMs. |
| `gm` | Assistant GM and above — what Foundry's own `isGM` means. |
| `trusted` | Trusted Player and above. |
| `everyone` (default) | Anyone at the table. |

**Chosen askers** — a tick-list of named users, *added* to whatever the rank
allows. Additive on purpose: a deny list would need a precedence rule, and every
such rule is one more thing a GM must hold in their head to predict what their
own table can do. Set the rank to `nobody` and the list becomes the whole
policy.

**Who sees the answer** — `asker` (default; whispered to the asker and connected
GMs), `gm` (whispered to GMs only, and the asker is told where their answer
went), or `public`.

It lives in the module, world-scoped, for two reasons.

- **Vault cannot independently verify who asked.** Its only channel to Foundry
  *is* the module, so enforcing this in Vault would mean trusting an `isGM` flag
  the module sent — not enforcement, but a second copy of the same trust with
  the authoritative data one process further away.
- **Access mode is a property of the world.** A GM running two campaigns can
  want different answers for each, which a Vault-side setting cannot express.

The module derives the asker from the ChatMessage document's `author` —
Foundry's own server-side attribution — and never from anything in the message
payload. A player can set arbitrary flags on a message they create, so a flag
claiming `isGM: true` proves nothing.

### The ceiling — in Vault, per install

**Home → Surfaces → Foundry VTT → "Answer players, not just the GM."** Off by default.

One boolean, asking a different question: *may this install answer non-GMs at
all?* With it off, Vault refuses any question whose asker is not a GM, whatever
the module is set to.

This is not redundancy. Two copies of one tri-state is the classic "why isn't my
setting working" trap. This covers the exact residual risk in `isGM` being a
claim: forging GM authorship gets a player nothing they could not already get by
asking normally, unless the install has opted into answering players.

---

## The spoiler problem — read this before enabling player questions

Discord lets a DM put the bot in a channel players cannot read. **Foundry's
chat log is the table.**

Vault answers from the *whole* corpus and has no notion of what has been
revealed. The three access modes bound **who sees** an answer. They do not bound
**what a player can pull**: even in whisper mode, the player who asked receives
lore the GM has not disclosed. The whisper hides it from everyone else — not
from them.

So:

- Restricting **who may ask**, or leaving Vault's ceiling off, is what actually
  protects a mystery. Setting **who sees the answer** to `gm` protects one too,
  by a different route: the question is asked, and you decide what to say.
- Whispering is about keeping the chat log tidy and answers attributable. It is
  **not** a spoiler control, and this documentation will not imply it is.

Per-player lore scoping is the real fix. It is tracked in
[ROADMAP.md](../../ROADMAP.md) as the blocking follow-on for this feature rather
than a nicety.

---

## What it costs

Every question is a full answer through the normal pipeline: the corpus, the
active persona, the citation rules. It costs whatever your configured provider
charges, and a table asking casually will ask a lot.

Two mitigations are built in:

- **A queue, per surface.** Four players typing at once do not start four
  generations. Concurrency defaults to 1 on Claude Code — each answer is a
  spawned CLI process drawing on one shared subscription window, and two at once
  is measurably slower than two in sequence — and 2 elsewhere.
- **A per-asker cooldown** of a few seconds, so one person cannot occupy the
  queue by holding down Enter. Checked before any work, so a refused question
  costs nothing at all.

You can pin the Foundry surface to a different provider than the dashboard uses.
Pinning it to Claude Code answers on your subscription with no metered billing —
at 5–10 seconds per answer, one at a time. The dashboard says so where you make
the choice; it is a real trade and you should make it knowingly.

---

## Security notes

The MCP endpoint is a **pre-auth surface** — reachable in principle by any page
the GM has open. Three independent defences hold it, none decorative:

1. **A bearer token** minted at pairing, stored only as a hash, never logged.
2. **An origin allow-list**, narrowed to the origins that completed a pairing
   you approved by hand.
3. **A handshake code** you have to read off one screen and type into another.

Each defeats a different attacker, which is why all three are there. The full
analysis — how each is implemented, what it does and does not stop, and why
the approval route is deliberately *not* cross-origin exempt — is in
**[SECURITY.md](../../SECURITY.md)**.

Two things worth acting on rather than reading about:

- **Unpair anything you do not recognise**, under *Surfaces* in the dashboard.
  A paired client can ask the archive anything.
- **The token is `client`-scoped in Foundry, not world-scoped.** A world-scoped
  setting is one every player can read out of `game.settings` and use to query
  your campaign directly. The module's own test suite asserts that scope,
  because it is the sharpest trap in the integration and it fails silently.

## The same endpoint serves other MCP clients

Vault's MCP server was built for Foundry but is not specific to it. Anything
that speaks MCP — Claude Code, Claude Desktop — can query the same corpus
through the same three tools:

| Tool | What it does |
|---|---|
| `ask_lore` | A question in, a cited answer out. What Foundry calls. |
| `search_lore` | Which documents and clarifications match, without generating. Costs no model tokens. |
| `list_sources` | What the corpus contains. |

Switch **Home → Surfaces → Other MCP clients** on, then pair. For a client that expects
a stdio subprocess rather than HTTP, `scripts/mcp-stdio.mjs` is a shim — see the
comment at the top of that file for the configuration.

That surface has its own toggle and its own credential. A client paired as an
MCP client is governed by the MCP toggle and never inherits the Foundry
surface's policy, because the surface is fixed at pairing rather than claimed
per request.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Could not find Tusk's Vault" | Not running, or on a port outside 3000–3019. Set the address by hand under Game Settings → Module Settings. |
| "No GM is connected" | Nobody with GM rights is online, so nothing can relay. |
| "The archivist does not take questions from you" | The asker is below the world's **Who may ask** rank and is not a chosen asker. |
| A player is refused despite the rank allowing it | Vault's player ceiling is off. Both ends must allow it. |
| "This surface is switched off" | Dashboard → Surfaces → Foundry VTT is off. |
| Pairing prompt never appears | Another request is already outstanding, or this origin was denied within the last hour. |
| Answers take 10s+ | The surface is pinned to Claude Code. Expected — see *What it costs*. |
