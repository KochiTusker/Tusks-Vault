# Installation — Tusk's Vault

← Back to [README](../../README.md)

This guide takes you from "nothing installed" to **"the bot is answering in Discord"**. Pick the section that matches you — every collapsible block starts closed so the page stays scannable. Open the ones you need.

---

## Which machines this has actually been run on

Tusk's Vault is a Node application and nothing in it is Windows-specific, so it
*should* run anywhere Node 20 does. But "should" is not "has been", and this is
a one-maintainer project — so here is the honest state, before you spend time
cloning it.

| Platform | State | What that means for you |
|---|---|---|
| **Windows 10 / 11, 64-bit (x64)** | **Supported.** Developed and used here daily; a clean clone → install → boot is verified. | Use it. `setup.bat` and `run.bat` are the tested path. |
| **Windows on ARM** (Snapdragon X, Surface Pro 11, Copilot+ PCs) | **Unverified.** The dependency that used to make it fail at startup is fixed, but nobody has run it on real ARM hardware. | It may work. If it doesn't, installing the **x64** build of Node instead of the arm64 one will run it under emulation. Please [open an issue](https://github.com/KochiTusker/Tusks-Vault/issues) either way — a report from an ARM machine is genuinely useful. |
| **macOS** | **Untested.** `run.sh` exists and the code has no Windows-only calls, but the app has never been started on a Mac. | Expect rough edges in the launcher scripts rather than in the app. Reports welcome. |
| **Linux** | **Partly tested.** The full suite runs on Linux in CI on every commit, and CI also boots the real server there and checks it answers. | The code is exercised. What is not: the launcher script, the browser auto-open, and a first run driven by a person on a desktop. |

> [!WARNING]
> Only 64-bit Windows is a *supported* platform today. Everything else is
> expected to work and has not been proven to. Nothing here will damage your
> machine — the worst case is that the server fails to start and you delete the
> folder — but please don't plan a session around an untested platform until
> you have seen it run.

**Before you clone, read [Known issues → Platform support](../troubleshooting/known-issues.md).**
It carries the same table plus what specifically went wrong on each platform and
what was done about it — worth two minutes if you are not on 64-bit Windows.
Windows-on-ARM and macOS support are both tracked on the [Roadmap](../../ROADMAP.md).

---

## ⚡ Quick start (the 3-line version)

If you've used Git and Node before:

**Mac / Linux**

```sh
git clone https://github.com/KochiTusker/Tusks-Vault.git
cd Tusks-Vault && bash run.sh
```

**Windows** — clone or [download the ZIP](https://github.com/KochiTusker/Tusks-Vault), open the folder, double-click `run.bat`.

Either platform can instead use the one-file installer — `install-tusks-vault.sh` / `install-tusks-vault.bat` at the repo root. It clones (never a tarball, because the in-app updater needs a git checkout), prints every location it will touch, and asks once before changing anything.

Your browser opens to <http://localhost:3000> — or to whichever port the server actually bound, if 3000 was busy. Add an LLM key + Discord token from the dashboard — no config files to edit.

If anything above made you pause, expand **🧙 First time on GitHub?** below.

---

<details class="docs-section">
<summary><h2>📋 Prerequisites</h2></summary>
<div class="docs-section-body">

You need two things installed on your computer **before** Tusk's Vault will run.

### Node.js 20 or newer (required)

- Go to <https://nodejs.org>
- Click the **LTS** button (LTS = Long-Term Support; the stable version).
- Run the installer. Defaults are fine — click Next, Next, Install.
- Restart your computer if it asks you to.

**To check it worked:** open a terminal and type `node --version`. You should see something like `v20.11.1` or higher.

### Git (strongly recommended)

You can run Tusk's Vault from a ZIP download without Git, but the **in-app updater needs Git installed**. Without Git, updating means re-downloading the ZIP by hand.

- Go to <https://git-scm.com>
- Download for your OS. Defaults are fine throughout the installer.

**To check it worked:** open a terminal and type `git --version`. You should see something like `git version 2.43.0`.

### What you do NOT need

- ❌ Python
- ❌ Docker
- ❌ A database
- ❌ Admin / root privileges
- ❌ A paid LLM key (Google Gemini's free tier works fine)
- ❌ A cloud account of any kind

</div>
</details>

<details class="docs-section">
<summary><h2>🧙 First time on GitHub? — a 5-minute walkthrough</h2></summary>
<div class="docs-section-body">

If you've never cloned a repo or used a terminal, follow these steps. Total time: about 5 minutes.

### Step 1 — Install the prerequisites above

Open the **📋 Prerequisites** section above this one. Install Node and Git. Then come back here.

### Step 2 — Get the code onto your machine

Pick the option that matches you.

#### Option A — Download a ZIP (easiest, no Git knowledge required)

1. Go to <https://github.com/KochiTusker/Tusks-Vault>.
2. Click the big green **`< > Code`** button at the top, then **Download ZIP** at the bottom of the dropdown.
3. Open your Downloads folder. **Right-click → Extract All...** Pick a folder you'll remember — e.g. `Documents\TusksVault`.

#### Option B — Clone with Git (one-click updates later)

1. Open a terminal in the folder where you want Tusk's Vault to live (right-click in any folder → **Open in Terminal** on Windows 11, or `cd` from Command Prompt).
2. Type and press Enter:
   ```sh
   git clone https://github.com/KochiTusker/Tusks-Vault.git
   ```
3. A `Tusks-Vault` subfolder is created. `cd Tusks-Vault` to enter it.

### Step 3 — Launch

- **Windows:** open the `Tusks-Vault` folder in Explorer, double-click **`run.bat`**. A console window opens. If you have Windows Terminal — standard on Windows 11 — it opens as a tab in a shared "tusks" window instead, so Vault and Tomes sit side by side; set `TUSKS_NO_WT=1` if you would rather have a plain `cmd` window.
- **Mac / Linux:** in a terminal in the `Tusks-Vault` folder, type `bash run.sh` and press Enter. (`run.sh` is not checked in with the executable bit set, so plain `./run.sh` reports "Permission denied" on a fresh clone until you `chmod +x run.sh`. `bash run.sh` always works.)

The launcher:
1. Checks the folder is writable, so a clone into Program Files or a syncing OneDrive folder fails with an explanation rather than a cryptic npm error.
2. Checks you have Node 20+ (refuses to start if not).
3. Refuses to run as root on macOS / Linux (keeps `node_modules` user-owned).
4. Installs dependencies when they're missing or `package-lock.json` has changed since the last successful install (`npm ci` on a truly fresh clone, `npm install` otherwise — both `--no-audit --no-fund`, and it warns you it takes about a minute).
5. Starts the server.
6. **Opens your browser** automatically, at the port the server actually bound.

**Keep the launcher window open.** Closing it stops Tusk's Vault.

### Step 4 — Configure from the dashboard

The Welcome banner walks you through three steps:

1. **Add an LLM API key** — click the Add-key card; pick a connection; paste the key. Gemini has a free tier and is the recommended first choice.
2. **Connect Discord** — click the Bot Status card. Paste your bot token — nothing else. The dashboard verifies it against Discord, reads the Application ID out of it, and generates an invite URL with the right permissions.
3. **Upload lore** — the **Lore** tab; drag your campaign documents in (PDF, DOCX, MD, etc.) or click **Bulk Upload**.

### Step 5 — Test it

In your Discord server, type `@<your bot name> who is <a character from your notes>?`

You should get a cited answer. If you get *"I am unsure about this detail. I have recorded this as a lore gap for the DM to clarify."*, that's normal — the bot only answers from your documents. The question lands under **Home → Campaign Management → Gaps** so you can answer it once and have it remembered.

### Stopping / starting later

- **Stop:** close the black launcher window (or `Ctrl+C` in the terminal).
- **Start again:** double-click `run.bat` (or `bash run.sh`). Your keys, lore, and Discord token are all saved — you only set them up once.

</div>
</details>

<details class="docs-section">
<summary><h2>🍎 macOS / 🐧 Linux — terminal equivalents</h2></summary>
<div class="docs-section-body">

```sh
# 1. Install Node 20+
# macOS:  brew install node
# Debian: sudo apt install nodejs npm
# Fedora: sudo dnf install nodejs npm
# Arch:   sudo pacman -S nodejs npm

# 2. Clone
git clone https://github.com/KochiTusker/Tusks-Vault.git
cd Tusks-Vault

# 3. Run (handles npm install on first launch automatically)
bash run.sh
```

`run.sh` sets `TUSKS_VAULT_OPEN_BROWSER=1`, which is what tells the server to open your browser once it has bound a port. Without that variable — `npm start` on its own, say — the server starts silently and you open the URL it prints yourself.

**To stop:** `Ctrl+C` in the terminal, or close the window.

**Important — never `sudo` the launcher.** `run.sh` refuses to start as root (or under `sudo`) so `node_modules/` stays user-owned and future updates don't break with permission errors. `setup.sh` refuses for the same reason.

</div>
</details>

<details class="docs-section">
<summary><h2>🔄 Updating after a `git pull`</h2></summary>
<div class="docs-section-body">

There are two equivalent ways to update — pick whichever you prefer.

### Path A — In-app (one click)

The dashboard's **Settings → Maintenance → Updates** card runs the updater for you:

1. Click **Check for updates**. The card shows you the remote HEAD (commit SHA + message) and every commit you're behind by.
2. Click **Apply update** and confirm. The updater streams `git pull` output live; the running server stays on the old code throughout. One of two things then happens:
   - **No dependency change** — the card says "Update applied." and offers a **Restart now** button.
   - **Dependency change** — the card surfaces a copy-pasteable `npm install` command with a Copy button.

   The updater **never runs `npm install` while the server is alive**: that would collide with file handles the live process holds in `node_modules/` (Vite's file watcher, mainly).
3. Restart Tusk's Vault via the **Restart now** button (or close the launcher window and re-run it). If you launched via `run.bat` / `run.sh`, the launcher catches the restart, refreshes dependencies if the lockfile changed, and relaunches on its own.

### Path B — From a terminal

```sh
cd path/to/Tusks-Vault
git pull
npm install --no-audit --no-fund   # only if package-lock.json changed
npm start
```

Vault's launcher also re-runs `npm install` automatically on next launch when `package-lock.json` differs from the copy it snapshotted after the last successful install (`node_modules/.tv-lockfile-snapshot`) — so `bash run.sh` / `run.bat` on its own is usually enough.

### Safety guarantees

- The updater refuses to update if you have **uncommitted local edits** on tracked files (so your debugging changes aren't clobbered). It does not stash them for you — it stops and tells you to commit or stash first, which is why nothing of yours can be lost in a stash you forget about.
- The updater is **fast-forward-only** — if your local main has diverged from the remote, it tells you how to recover instead of overwriting silently.
- The updater runs whatever git and npm you already have; it never downloads and executes a script. It inherits the server's user, and the launcher refuses to start as root, so in the normal flow it is never running as root either.
- Apply must echo back the exact remote SHA the card just showed you, so a tab left open overnight can't apply a different update than the one you read. There is also a five-minute wall-clock ceiling on the whole operation.

Source: [scripts/update.mjs](../../scripts/update.mjs) + [src/server/util/updater.ts](../../src/server/util/updater.ts).

</div>
</details>

<details class="docs-section">
<summary><h2>🎛️ Configuring from the dashboard</h2></summary>
<div class="docs-section-body">

Four things, in this order. Only the first is required to get an answer out of
it.

**1 — A connection.** *Settings → API keys.* Four connections, and only two
take a key: **[Gemini](https://aistudio.google.com/app/apikey)** (free tier,
the recommended start) and
**[OpenRouter](https://openrouter.ai/keys)** (pay-as-you-go, ~400 models on one
bill). **Claude Code** answers through a Claude subscription you already have,
and **Ollama** runs locally — neither needs anything pasted. Pick which one
answers from the **Active Provider** picker on Home; you can flip between them
without restarting.

Keys are stored encrypted (AES-256-GCM, machine-bound) in your platform config
folder, never in the repo.

> **There is no Anthropic or OpenAI key slot**, and do not put
> `ANTHROPIC_API_KEY` in `.env.local` — nothing reads it, and the Claude Code
> connection strips it from the CLI's environment on purpose, because a stray
> key there bills the API instead of your subscription.

→ Which to choose, what each sees, and what each costs:
**[Choosing a provider](choosing-a-provider.md)**.

**2 — Somewhere to ask from.** Discord needs a bot token — four steps in
Discord's developer portal, then one paste. Foundry and MCP ship **off** and
stay off until you enable them and approve a pairing.

→ **[Discord](../surfaces/discord.md)** · **[Foundry VTT](../surfaces/foundry-vtt.md)**

**3 — Your lore.** Drop documents into the `Tusks-Lore/` folder — PDF, DOCX,
Markdown, plain text and more — or point Vault at an Obsidian vault you already
keep, which it reads strictly read-only.

→ **[Obsidian vault](../lore/obsidian-vault.md)**

**4 — Optional: a voice.** *Settings → Personas.* Eight presets — the default
Chronicler plus seven characters — and any you write or generate yourself. The
citation rules survive every one of them.

---

</div>
</details>

<details class="docs-section">
<summary><h2>🔌 Local models and Claude Code</h2></summary>
<div class="docs-section-body">

Neither needs anything installed inside Vault, and there is nothing to enable. Both appear in the Active Provider picker as soon as Vault can see them.

- **🦙 Ollama** — local inference on your own machine. Install Ollama, `ollama pull` a model, and the picker finds it. Its base URL lives under **Settings → Integrations**, and must be a loopback address.
- **🤖 Claude Code** — answers through a Claude subscription you already pay for. Install the Claude Code CLI and run `claude login`; Vault never handles the login, it only invokes a binary you have already authenticated.

Personas are an ordinary feature too, under **Settings → Personas**: eight presets — the default Chronicler voice plus seven characters — and any you write or generate yourself.

Full guide, including the trade-offs of each: **[Choosing a provider](choosing-a-provider.md)**.

</div>
</details>

<details class="docs-section">
<summary><h2>🐞 Common setup issues</h2></summary>
<div class="docs-section-body">

### "Node version too low"

The launcher refuses to start on Node < 20. Run `node --version` to confirm what's installed; install the latest LTS from <https://nodejs.org/> if needed. On Windows, after a Node install you may need to close and re-open your terminal so the new version takes over the `PATH`.

### Port 3000 already in use

Vault auto-falls-back to 3001, 3002, and so on — twenty attempts in total, so 3000–3019. It opens your browser at whichever port it actually bound and prints that URL in the launcher window, so the fallback is normally invisible. If all twenty are taken it stops with an error naming the range; set `PORT=3500` (or anything free) in `.env.local` and re-launch.

The bound port is also written to `.port-runtime` at the repo root. That file is written for other tools to read — nothing in the launch path consults it, so deleting it changes nothing about where your browser opens.

### Windows: "running scripts is disabled on this system" (PowerShell)

This is PowerShell's default Restricted execution policy blocking a `.ps1` script. It does **not** affect `run.bat` — batch files aren't governed by the execution policy, so double-clicking it, or running it from Command Prompt or PowerShell, works either way. What it does block is running `npm` directly inside PowerShell, because npm ships a `npm.ps1` shim. Two fixes:
- Use the regular Command Prompt for `npm` commands — or call `npm.cmd` explicitly from PowerShell.
- Or run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` once. `-Scope CurrentUser` does not need Administrator.

### First-boot MiniLM download fails

Vault downloads ~25 MB of MiniLM embedding weights from Hugging Face on first launch, caching them into `models/` at the repo root. The download starts at boot, not at the first question, so if your network blocks `huggingface.co` you'll see `[embeddings] Failed to load model:` in the launcher window and in the dashboard's **Home → Campaign Management → Logs** tab. Unblock the network access (or use a VPN once to grab the model), then restart.

### After `git pull`: `ERR_MODULE_NOT_FOUND`

Dependencies changed in the last update. The launcher normally catches this itself by comparing `package-lock.json` to its snapshot — if it didn't, run `npm install --no-audit --no-fund` from a terminal in the repo root and re-launch. To force the launcher to re-install on its own, delete `node_modules/.tv-lockfile-snapshot`; the missing snapshot triggers a fresh install on the next start.

More entries: see **[FAQ → Troubleshooting](../troubleshooting/faq.md)**. If the
server will not start at all, check **[Known issues → Platform support](../troubleshooting/known-issues.md)**
first — the cause may be that your platform has never been verified.

</div>
</details>

---

## Next steps

- 🧠 [How retrieval actually works → Architecture.md](../about/how-its-built.md)
- 🎲 [What people actually ask → UseCases.md](../about/use-cases.md)
- 🔌 [Providers → Providers.md](choosing-a-provider.md)
- 💬 [Discord, in more detail → Discord.md](../surfaces/discord.md)
- 🐉 [Foundry VTT — asking from the game chat bar → Foundry.md](../surfaces/foundry-vtt.md)
- 📚 [Obsidian vault as a lore source → ObsidianVault.md](../lore/obsidian-vault.md)
- 🪶 [The Tomes companion → tomes.md](../lore/tusks-tomes.md)
- ❓ [FAQ — including realistic costs → FAQ.md](../troubleshooting/faq.md)
- 🐞 [Known issues — including which platforms are supported](../troubleshooting/known-issues.md)
