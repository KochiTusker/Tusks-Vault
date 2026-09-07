# Uninstalling

← Back to [README](../../README.md)

Vault ships an uninstaller that removes everything it created **without
touching your campaign documents**. This page is what it does, what it
deliberately leaves, and the four things it cannot reach.

---

## What goes, what stays

| Removed | Kept |
|---|---|
| `node_modules/`, `dist/` | `Tusks-Lore/` and every document in it |
| The MiniLM model cache (`models/`) | A repo-local `Lore/` folder |
| `api-keys.json`, `settings.json`, `.env.local` | Any custom lore folder set in `settings.json` |
| `run.log`, `.port-runtime` | The repo itself — deleting it is your call |
| Every per-user `tusks-vault` directory (data, config, cache, log, temp) | `clarifications.json`, `lore_gaps.json` and `logs/` inside your lore folder |

Those last two are deliberate. The repo is left because deleting its own
working directory is not the script's decision to make; the state files inside
your lore folder are left because the script refuses to touch *anything* in a
folder you may have written to yourself. Both are printed in the summary with
the exact command to finish them off if you want a complete scrub.

---

## Run it

**Windows** — double-click `uninstall.bat` in the repo root. It wraps
`uninstall.ps1`, so you do not have to change your execution policy.

**macOS / Linux** — from the repo root:

```sh
./uninstall.sh
```

Preview without changing anything:

```sh
./uninstall.sh --dry-run          # macOS / Linux
pwsh ./uninstall.ps1 -DryRun      # Windows
```

It asks twice before deleting. First for the phrase
`I understand and accept the risk` — the acknowledgement that you are running
it from the repo root with the server stopped. Then for `yes`, against the
specific list of paths. **Anything else at either prompt** — Enter, `no`,
Ctrl+C — exits with no changes.

---

## By hand instead

```sh
pwsh ./uninstall.ps1 -Manual        # Windows
./uninstall.sh --manual             # macOS / Linux
```

Prints a seven-step guide with copy-pasteable commands for your platform and
exits without touching anything. It works even if you have already deleted the
repo, because the instructions do not require being inside a clone.

---

## Four things it cannot reach

These live off your disk. The script prints all four at the end of its run.

- **Your Discord bot registration** — delete the application at
  [discord.com/developers/applications](https://discord.com/developers/applications).
  The bot stops responding the moment Vault is gone, but the registration
  lingers.
- **Your API keys** — Vault deleted its local copy, but the key is still
  **live at the provider** and usable by anyone holding it. Revoke at
  [Google](https://aistudio.google.com/app/apikey) or
  [OpenRouter](https://openrouter.ai/keys).
- **Browser state for `localhost:3000`** — localStorage, cookies and cached
  dashboard assets stay until you clear that origin's site settings.
- **Ollama**, if you installed it. Vault never installed it; use Ollama's own
  uninstaller.

---

## If it fails partway

Deletion fails on any file a running process holds open, usually inside
`node_modules/`. Stop the server — close the `run.bat` / `run.sh` window, or
Ctrl+C — and re-run.

---

## How you can tell it is safe

Three layers of guard: the script must be inside a Vault repo, system roots
are refused outright, and any path overlapping a preserved folder is skipped.
Plus the two prompts and the dry run above.

It has its own test harness, and you can run it before trusting the script:

```sh
npm run test:uninstall
```

23 tests — 18 against the Bash script and 5 PowerShell mirrors, skipped when
no `pwsh` is on PATH. They build fake Vault clones in a sandbox and include
**real destructive runs** that verify the lore folders and repo source survive
while Vault's own state is removed.

---

## Next steps

- [Installation](installation.md) — if you are reinstalling rather than leaving.
- [Privacy](../security/privacy.md) — what was on your disk in the first place.
