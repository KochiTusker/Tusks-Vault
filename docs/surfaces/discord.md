# Discord — Tusk's Vault

Most campaign questions don't arrive at the table. They arrive on a Wednesday,
in a channel, three days after the thing happened — and they arrive addressed to
whoever runs the game. Putting Tusk's Vault in that channel means the answer
comes back cited, in front of everyone, so the same question doesn't get asked
another three times that week.

---

## What you'll need

- **Tusk's Vault installed and running.** If it isn't yet, start at
  [Setup](../getting-started/installation.md) and come back.
- **A Discord account** with permission to add a bot to the server you have in
  mind. On your own server that's automatic; on somebody else's you'll need
  Manage Server.
- **About five minutes.** Four of the steps are in Discord's developer portal,
  one is pasting the result into Vault, and the last is authorising the bot
  into your server.

> **The dashboard needs exactly one thing from you: the bot token.** Everything
> that can be derived from it is derived. The Application ID lives inside the
> token's first segment, so there is nothing else to copy across, and no second
> field to get wrong.

---

## Setting it up

Discord has no API for creating an application, so the first four steps happen
in their portal. There is no way around that — for anyone, not just for this
project, so treat anything claiming to automate them as driving a browser
session with your password. The rest is Vault's job.

1. Open the **[Discord Developer Portal](https://discord.com/developers/applications)**
   and sign in.
2. **New Application.** Name it whatever you want — this is the name your
   players will see in the server, so it's worth a moment's thought. "Tusk", the
   name of your setting's librarian, or something your table will find funny.
3. **Bot** in the sidebar → **Reset Token** → copy it. Discord shows a bot token
   **once**. If you lose it, reset it again and use the new one; nothing breaks.
4. Still on that page, scroll to **Privileged Gateway Intents** and enable
   **Message Content Intent**, then Save. Without this the bot connects
   successfully, sees every message as empty, and answers nothing — which is a
   confusing failure, so it is worth double-checking now.
5. Back in Vault: **Bot Status** card → paste the token. Four checks run as you
   paste, before anything touches disk:

   - **Valid?** Checked against Discord immediately, so a wrong string is caught
     here rather than surfacing later as an unexplained login failure.
   - **Which bot?** Vault names the bot the token belongs to, so you can confirm
     it is the one you meant.
   - **A user account?** Refused outright — automating a user account is against
     Discord's terms and gets the account banned.
   - **Invite URL.** On success Vault reads the Application ID out of the token
     and builds one with the right permissions already selected.
6. Click that invite URL, choose your campaign server, and Authorize.

The bot connects on save. There is no server restart, and re-pointing an
existing bot at a new token is the same single paste.

---

## Asking it something

Mention the bot in any channel it can see:

```text
@Tusk who was the merchant we met in Dunmar?
```

A direct message works too — the bot treats a DM as an invitation to answer,
with no mention needed.

The answer comes back in the channel with its citations attached — the file
each claim came from, so anyone can check rather than take it on trust. Tags
like `[chronicle.md]` and `[clarification: cl-42]` land after each claim.

That is on by default and is a display choice, not a grounding one. Turning
**Settings → Voice & retrieval → Show Source References** off strips the tags
before the reply reaches Discord; the model is still required to find a source
to answer at all.

Answers longer than Discord's 2000-character limit are split across several
replies rather than truncated.

If your notes don't cover the question, you get a refusal instead of an
invention, and the question is logged under **Home → Campaign Management →
Gaps**. Answer it once there and that answer is reused from then on, however
differently the next person phrases the question.

---

## What the bot can and can't see

- It acts on messages that **mention it**, and on direct messages sent to it.
  Everything else in a channel is discarded the moment it arrives — nothing is
  stored, and there is no transcript of your server being kept.
- If you attach a file to a message that mentions it, that file is downloaded
  and read so it can answer about it — images, PDFs, DOCX and plain text. Those
  bytes go to whichever model is answering, like the question itself.
- It answers from your lore and nothing else — the `Tusks-Lore/` folder, or
  your Obsidian vault if you have pointed it there instead. It has no memory of
  previous conversations beyond the rulings you record deliberately.
- It never sees the rest of your Discord — no other servers, no DMs it is not
  part of, no member list beyond what answering a mention requires.

Vault itself only ever reads the **count** of servers the bot is in, for the
status display. It does not read, log or store server names.

---

## Permissions, and why these ones

The generated invite URL asks for the `bot` scope and five permissions, and
nothing beyond that:

| Permission | Why |
|---|---|
| Send Messages | To answer at all |
| Read Message History | The bot answers *as a reply* to the message that asked, which Discord treats as reaching back into history |
| Embed Links | So a link the bot posts unfurls instead of arriving as bare text |
| Attach Files | Headroom. Long answers are split across replies today, not attached |
| Add Reactions | Headroom. While it is working you get Discord's typing indicator instead |

The last two are in the invite but unused by the current code. Granting them
costs nothing today and saves a re-authorise if that ever changes; if you would
rather grant fewer, dropping them changes nothing you can observe. Answers are
plain text — the bot sends no rich embeds — so Embed Links only matters for
link previews.

It does not ask for Administrator, Manage Server, Manage Messages, or anything
that could alter your server.

---

## If something isn't working

**The bot is offline in the member list.** The token is wrong or has been reset
since you pasted it. Reset it once more and paste the new one.

**It's online but ignores every mention.** Three causes produce identical
silence — no reply, no typing indicator, no LLM call — and the bot stays
connected through all of them:

- **Message Content Intent is off** (step 4). By far the most common, because a
  bot in this state looks completely healthy from the outside.
- **The Pause switch** on the Home tab reads "Bot is PAUSED".
- **The Discord row** of the Home tab's **Surfaces** card is switched off.

The last two are deliberate, and flipping either back is instant.

**It answers the first question then ignores a rapid follow-up.** There is a
three-second gap enforced per person, so one player holding down Enter cannot
occupy the queue. Ask again a moment later.

**It answers, but says it doesn't know anything.** Your lore folder is empty or
Vault is pointed at the wrong one. The dashboard's **Lore** tab shows what it
has actually indexed, and which folder or vault that came from.

More in the [FAQ](../troubleshooting/faq.md) and [known issues](../troubleshooting/known-issues.md).

---

## Related

- [Setup](../getting-started/installation.md) — installing Vault in the first place
- [Foundry VTT](foundry-vtt.md) — asking mid-session from the game's chat bar
- [Providers](../getting-started/choosing-a-provider.md) — choosing which model answers
- [Privacy](../security/privacy.md) — exactly what leaves your machine
