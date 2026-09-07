# Obsidian vault — Tusk's Vault

Vault reads your campaign from one of two places:

- the **Tusks-Lore folder** — documents you upload through the dashboard: PDFs,
  Word files, Markdown, plain text. This is the default and needs no setup.
- an **Obsidian vault** — the notes you already keep, read where they already
  live.

They are alternatives, not a blend. An answer drawn from two
differently-organised corpora produces citations you cannot trace back to one
place, so you pick one and Vault reads that.

Switch under **Lore → Lore source**.

---

## Vault never writes to your vault

This is the part worth being explicit about. Your Obsidian vault is a folder
you edit by hand, in another application, holding work that may exist nowhere
else. Tusk's Vault reads it and does nothing else to it — no writes, no
renames, no deletions, no "tidying" of your frontmatter, no index file
dropped beside your notes.

That is enforced rather than intended: `readonly-guard.test.ts` scans the
vault-reading module's own source for filesystem-mutating calls and fails the
suite if one appears. Everything Vault derives from your vault — the map and
the embeddings it is searched by — is stored with Vault's own settings, in
your platform's config directory.

---

## Pointing Vault at a vault

Under **Lore → Lore source**, press **Browse…** and navigate to the folder
your notes live in — folders that are Obsidian vaults are marked as you go. Or
paste the vault's full path (it must be absolute, not relative) and press
**Check**. Either way Vault reports what it found: how many notes, which
folders, which frontmatter fields you use, and how many notes carry aliases.
If that looks like your campaign, press **Use this vault**.

To find the path by hand: right-click the vault name in Obsidian and choose
*Reveal in file explorer* (or *Show in Finder*).

A folder without a `.obsidian` directory works fine. Vault says so rather than
refusing — a plain folder of Markdown notes is a perfectly reasonable thing to
point at.

Inspection reads frontmatter fences only, never note bodies — enough to answer
"is this the right folder?" without loading a corpus into memory. And the
whole `/api/obsidian/*` surface is loopback-only: choosing which directory
Vault reads is a file-disclosure primitive, so it is refused to anything but
the machine Vault runs on, even when you have deliberately bound the dashboard
to your LAN.

### What gets read

Every `.md` file, except:

- `_system/`, `Templates/` (either capitalisation), `_MOCs/`, `.obsidian/`,
  `.trash/`, `graphify-out/`
- `README.md`, `README.txt`, `CLAUDE.md`, `LICENSE`, `LICENSE.md`,
  `CONTRIBUTING.md` — matched on the filename, so they are skipped at any
  depth, not only at the vault root
- anything beginning with a dot

Template notes are excluded because indexing them invents entities your
campaign has never heard of — an NPC called "NPC Template" with a blank stat
block.

Two ceilings exist so a vault accidentally pointed at a home directory
degrades instead of walking forever: 5,000 notes, and 12 directory levels.
Neither is reachable by a real campaign vault.

### What Vault understands

| In your note | What Vault does with it |
|---|---|
| The filename | The entity's name. Obsidian's own convention. |
| `aliases:` (or `alias:`) | Alternate names. A question using a nickname finds the note. |
| `type:` | Kept as you wrote it — `npc`, `faction`, `plot-thread`, whatever your vault uses. Not squeezed into a fixed list. |
| `affiliations:`, `related:`, `patron:`, `allied-with:`, `enemies-with:`, `origin:`, `part-of:`, `location:` | Relationships, so the model can follow your vault's graph. Read from top-level keys only — an indented `key:` belongs to a nested mapping and is left alone. |
| `[[Wikilinks]]` in the body | Flattened to readable text. `[[NPCs/Ser Alric\|the knight]]` becomes "the knight". |
| `![[Embedded note]]` | Becomes `(see: Embedded note)`. The note is indexed in its own right, so pasting its title inline would misrepresent what is actually in the prompt. |
| `![[image.png]]` | Removed. Vault cannot read a PNG, and leaving the filename in the prose reads to a model as a fact about your world. |
| `> [!note]` callouts | Reduced to plain quotes. |

Aliases are the single highest-value thing you can add. If a note lists the
names your table actually says out loud, questions using those names find it.

---

## The vault map

A folder of a dozen session write-ups fits in a prompt. A vault of four
hundred notes does not — and when a corpus overflows, the part that gets cut
is whatever sorted last. Notes stop existing as far as the model is
concerned, silently, with no indication that anything is missing.

The map fixes that. Vault reads your vault once and reduces each note to a
single line describing what it covers. Then:

- **every** line goes into every prompt, so the model always knows what exists
  in your campaign, and
- only the notes relevant to the actual question are included in full.

The model gets the whole map plus the right pages, instead of an arbitrary
prefix of everything.

The split is also what makes prompt caching worth anything: the map is
identical between questions and goes in the cacheable part of the prompt,
while the per-question selection deliberately sits outside it. Folding the
selection into the cached block would invalidate the cache on every question
and re-bill the entire vault each time — the exact cost the map exists to
avoid.

Each digest is capped at 240 characters, so the map's cost per note is
bounded no matter how long the note is.

### Building it

Under **Lore → Lore source → Vault map**, press **Build map**. Progress is
shown as it goes; a few hundred notes takes a couple of minutes the first
time.

It uses whichever model you have configured, summarising twelve notes per
call from the first 600 characters of each. If no model is configured it
still builds — the summary falls back to the note's first line of real prose,
skipping headings, list markers, images and bare transclusion pointers. That
works less well but works. The card tells you which you got.

**Updating is cheap.** Each note's summary is keyed to its contents, so
pressing **Update map** after editing three notes re-reads three notes.
**Rebuild from scratch** forces the lot.

The card shows how many notes are mapped, which model wrote the summaries,
when it was built, and how many notes have been added or removed since — so
you know when an update is worth running.

### How the right notes get chosen

Each digest is turned into a vector by the same local MiniLM model Vault
already uses for clarifications — on your CPU, offline, at no cost. The
embedded text includes the title, type, aliases and relations as well as the
summary, so a question using a nickname matches even when the summary never
spells it that way. Your question is turned into a vector too, and the notes
closest to it are included in full.

A note is kept when it scores **at least 45% of the best match's score** — a
relative floor, not a fixed one.

- **Why relative.** The right cut depends on the question. *"Who is the Grey
  Knight"* has one strong answer and a long tail of noise; *"what happened at
  the siege"* legitimately touches a dozen notes. One fixed threshold is wrong
  for one of them.
- **Why 0.45 and not tighter.** At 0.6, measured on a fixture vault, *"which
  faction is hunting this character?"* kept the character's own note and cut
  the session note recording the bounty — which is where the answer was.
- **Why not tighter still.** A question spanning two notes is normal in a
  campaign, and a floor admitting only the single best match cannot answer
  one.

Two backstops sit behind the floor: at most 40 notes, and at most 120 KB of
note bodies. They are backstops, not the mechanism — filling the budget with
whatever ranks highest sounds free, but a prompt padded with notes that merely
mention the same place makes the model's job harder and its citation likelier
to name a note that was only adjacent to the answer.

**Questions about *when* are handled separately.** "What happened last
session" names no subject, so similarity ranks every session note about
equally and returns an arbitrary handful. Vault resolves the actual sessions
from their titles first and pins them ahead of anything similarity picks, then
adds a few neighbouring notes for context rather than forty. The prompt header
names only the sessions that actually fit, so the model is never told it is
holding a session it cannot see.

### When the map is skipped

- **Your vault fits in a prompt anyway.** Under 120 KB of notes in total,
  Vault simply includes everything — mapped mode costs a map header *and* a
  selection, so below that size it produces a bigger prompt carrying less
  content.
- **No map has been built yet.** Vault sends the whole vault and says so.
- **The map has no usable embeddings.** Same fallback, same notice.

All three are reported rather than silent.

### Turning it off

Uncheck **Use the map when answering** to send the whole vault every time.
Reasonable for a small vault. Expensive, and eventually lossy, for a large
one.

---

## Citations

Answers cite notes by their vault-relative path — `[NPCs/Ser Alric.md]` — so
you can open the exact note the claim came from. That is the same contract the
folder source uses.

When the map is on and the answer needs a note that was not included in full,
the model is told to say which note it would need rather than guess at its
contents.

---

## Things it will not do

- **It will not write to your vault.** No generated index, no CLAUDE.md, no
  frontmatter normalisation. If you want a navigation guide for your own AI
  tools, that is a job for a tool that asks first.
- **It will not read images or PDFs inside the vault.** Only `.md` notes.
- **It will not merge with the Tusks-Lore folder.** One source at a time.
- **It will not notice edits on its own.** Vault re-reads the vault on every
  question, so note *content* is always current — but the *map* is a snapshot.
  Press Update after a writing session.

---

- 🏗 [Architecture →](../about/how-its-built.md)
- 🔌 [Providers — which model builds the map →](../getting-started/choosing-a-provider.md)
- 🔒 [Privacy — what leaves your machine →](../security/privacy.md)
