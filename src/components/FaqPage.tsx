import React from "react";
import { motion } from "motion/react";
import { ExpandableCard } from "./ExpandableCard";
import { RuneDivider } from "./RuneDivider";

const Pill = ({ children, tone = "gold" }: { children: React.ReactNode; tone?: "gold" | "crimson" | "verdigris" }) => {
  const tones: Record<string, string> = {
    gold:      "bg-gold-500/20 text-gold-200 border-gold-400/40",
    crimson:   "bg-crimson-500/20 text-crimson-400 border-crimson-400/40",
    verdigris: "bg-verdigris-400/20 text-verdigris-400 border-verdigris-400/40",
  };
  return (
    <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${tones[tone]}`}>
      {children}
    </span>
  );
};

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <li className="flex gap-3 mb-2">
    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gold-500/25 text-gold-200 text-xs font-bold flex items-center justify-center font-serif">{n}</span>
    <div className="flex-1">{children}</div>
  </li>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="font-mono text-[13px] bg-ink-900/70 text-gold-200 px-1.5 py-0.5 rounded border border-gold-400/20">
    {children}
  </code>
);

const Link = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="text-gold-300 underline underline-offset-2 decoration-gold-400/40 hover:decoration-gold-300">
    {children}
  </a>
);

export function FaqPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-3"
    >
      <header className="mb-6">
        <h2 className="font-display text-4xl font-bold text-gold-300 tracking-wide mb-2">Frequently Asked Questions</h2>
        <p className="font-serif text-parchment-100/60 italic">Click any question to unfurl the answer.</p>
        <RuneDivider />
      </header>

      <h3 className="font-display text-xl text-gold-300/80 mt-6 mb-2">Getting your API keys</h3>

      <ExpandableCard
        icon="🔑"
        title="How do I get an OpenRouter API key?"
        pill={<Pill tone="crimson">Paid</Pill>}
        defaultOpen
      >
        <p className="mb-3">
          One key reaches Claude, GPT and around 400 other models on a single bill, which is why
          there are no longer separate Anthropic and OpenAI slots. Pay-as-you-go; expect roughly
          $0.01–0.10 per query depending on the model you route to.
        </p>
        <ol className="list-none">
          <Step n={1}>Open <Link href="https://openrouter.ai/keys">openrouter.ai/keys</Link> and sign in.</Step>
          <Step n={2}>Add credit under <strong>Credits</strong>. It is prepaid, so the balance is its own spending cap — there is no bill to be surprised by.</Step>
          <Step n={3}>Click <strong>Create Key</strong> and name it something meaningful (e.g. "Tusk's Vault").</Step>
          <Step n={4}>Copy the key — it starts with <Code>sk-or-...</Code> and is shown only once.</Step>
          <Step n={5}>In Tusk's Vault: Settings → Key Vault → <strong>Add Key</strong>, choose <strong>OpenRouter</strong>, paste it.</Step>
        </ol>
        <p className="mt-3">
          Every OpenRouter request from Vault pins a zero-data-retention routing floor, because your
          lore travels with each question. That is also why most <Code>:free</Code> model variants
          are unavailable — they run on hosts that keep prompts.
        </p>
      </ExpandableCard>

      <ExpandableCard
        icon="🤖"
        title="Can I use a Claude subscription instead of an API key?"
        pill={<Pill tone="gold">No key</Pill>}
      >
        <p className="mb-3">
          Yes, and it costs nothing extra. The Claude Code connection runs the CLI on your own
          machine against a Claude Pro or Max plan you already pay for, so there is no API key and
          no per-question charge.
        </p>
        <ol className="list-none">
          <Step n={1}>Install Claude Code and sign in to it once, following Anthropic's own instructions.</Step>
          <Step n={2}>In Tusk's Vault: Settings → pick <strong>Claude Code</strong> as the connection. There is nothing to paste.</Step>
          <Step n={3}>Ask a question. The first answer is slower — it spawns a process — and after that it is warm.</Step>
        </ol>
        <p className="mt-3">
          Do not also set <Code>ANTHROPIC_API_KEY</Code> in <Code>.env.local</Code>. Vault strips it
          from the CLI's environment on purpose: left in place it takes precedence inside the CLI
          and bills the API instead of the subscription you are already paying for.
        </p>
      </ExpandableCard>

      <ExpandableCard
        icon="🔑"
        title="How do I get a Google Gemini API key (free tier available!)"
        pill={<Pill tone="gold">Free tier</Pill>}
        defaultOpen
      >
        <p className="mb-3">
          Gemini is the only provider with a real free tier. Perfect to start with — the Flash models cost nothing and are plenty smart for most lore questions.
        </p>
        <ol className="list-none">
          <Step n={1}>Open <Link href="https://aistudio.google.com/app/apikey">aistudio.google.com/app/apikey</Link> and sign in with your Google account.</Step>
          <Step n={2}>Click <strong>Create API key</strong>. If asked, pick or create a Google Cloud project — "Generative Language Client" is the default.</Step>
          <Step n={3}>Copy the key — it starts with <Code>AIza...</Code>.</Step>
          <Step n={4}>
            In Tusk's Vault, Settings → Key Vault → <strong>Add Key</strong>.
            Provider <strong>Google Gemini</strong>, tier <strong>Free</strong> (if you haven't enabled billing) or <strong>Paid</strong> (if you have).
            Paste the key.
          </Step>
          <Step n={5}>
            <strong>If you want the Pro models too</strong>: enable billing on that Google Cloud project at <Link href="https://console.cloud.google.com/billing">console.cloud.google.com/billing</Link>. Your key automatically gains access to <Code>gemini-*-pro</Code> models. Tusk's Vault picks them up on next page refresh.
          </Step>
        </ol>
      </ExpandableCard>

      <ExpandableCard
        icon="💻"
        title="How do I run Ollama locally (zero cost, fully offline)?"
        pill={<Pill tone="verdigris">Free, local</Pill>}
      >
        <ol className="list-none">
          <Step n={1}>Download Ollama for your OS from <Link href="https://ollama.com/download">ollama.com/download</Link> and install.</Step>
          <Step n={2}>On Windows, Ollama runs as a background service after install. On macOS / Linux run <Code>ollama serve</Code> in a terminal.</Step>
          <Step n={3}>Pull a model from a terminal: <Code>ollama pull llama3.1:8b</Code> (about 4.7 GB).</Step>
          <Step n={4}>In Tusk's Vault, use the <strong>Active Channel</strong> picker on the Home page and select <strong>Ollama (local)</strong>.</Step>
          <Step n={5}>In Settings, set <strong>Pro Model</strong> and <strong>Flash Model</strong> to model IDs you've pulled (e.g. <Code>llama3.1:8b</Code>).</Step>
        </ol>
        <p className="mt-3 text-parchment-100/70">
          ⚠️ <strong>Quality caveat:</strong> local models under ~15B parameters give noticeably weaker, less coherent answers than Claude / GPT-4 / Gemini Pro. Fine for offline play and tinkering; expect a quality gap.
        </p>
      </ExpandableCard>

      <h3 className="font-display text-xl text-gold-300/80 mt-8 mb-2">Using the bot</h3>

      <ExpandableCard
        icon="📂"
        title="What document formats can I upload as lore?"
      >
        <p className="mb-3">
          Drop them on the <strong>Lore</strong> tab or copy them into the <Code>Tusks-Lore/</Code> folder. Supported out of the box:
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><strong>PDF</strong> — text is extracted; images inside PDFs aren't parsed yet (roadmap).</li>
          <li><strong>Word (.docx)</strong> — full text extraction.</li>
          <li><strong>Plain text</strong> (.txt) and <strong>Markdown</strong> (.md, .markdown).</li>
          <li><strong>JSON</strong>, <strong>YAML</strong> (.yaml/.yml), <strong>CSV/TSV</strong>.</li>
          <li><strong>HTML</strong> (.html/.htm) — tags are stripped, text kept.</li>
          <li><strong>RTF</strong> — control words stripped, text kept.</li>
        </ul>
        <p className="mt-3">
          <strong>Google Docs</strong> aren't a file format on disk. Use <em>File → Download → Microsoft Word (.docx)</em> or <em>Plain Text (.txt)</em> from Drive, then upload the exported file.
        </p>
      </ExpandableCard>

      <ExpandableCard
        icon="📜"
        title="How does the bot decide what to cite?"
      >
        <p className="mb-3">
          Every factual claim has to end with a citation marker:
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><Code>[filename]</Code> — claim came from one of your uploaded lore documents.</li>
          <li><Code>[clarification: ID]</Code> — claim came from a DM clarification you've recorded.</li>
          <li><Code>[D&D 5e]</Code> — claim is a generic D&D rules fact, not setting-specific.</li>
          <li><Code>[speculation]</Code> — only when Speculative Mode is on; a creative hypothetical anchored in character personality.</li>
        </ul>
        <p className="mt-3">
          If the bot can't cite a source, it emits the exact phrase <em>"I am unsure about this detail. I have recorded this as a lore gap for the DM to clarify."</em> — and you'll see the question appear in the Lore Gaps tab so you can answer it once and have the answer remembered forever.
        </p>
      </ExpandableCard>

      <ExpandableCard
        icon="✍️"
        title="How do I correct a wrong answer?"
      >
        <p className="mb-3">
          Open the <strong>Clarifications</strong> tab on Home and click <strong>Add Clarification</strong>. Type the question (as the player might ask it) and the canonical answer. Save.
        </p>
        <p>
          Tusk's Vault embeds the clarification locally (no cloud) and reuses it automatically on future paraphrases of the same question. So <em>"Where do the Crimson Court rule from?"</em> will match a stored clarification phrased as <em>"What is the capital of Aldermarch?"</em> if the answer mentions the Court.
        </p>
      </ExpandableCard>

      <ExpandableCard
        icon="🎲"
        title="What's Speculative Mode for?"
      >
        <p>
          By default, the bot refuses to answer questions that aren't grounded in your sources. Toggle <strong>Speculative Mode</strong> on (Settings page) to let it answer hypotheticals — <em>"Who would order a glass of milk at Starbucks?"</em>, <em>"Who's most likely to lose a duel to a chicken?"</em> — by reasoning about characters' established personalities. Speculative answers are clearly tagged <Code>[speculation]</Code> and cite which trait or past event led to the pick.
        </p>
      </ExpandableCard>

      <h3 className="font-display text-xl text-gold-300/80 mt-8 mb-2">What's in the repo (and what isn't)</h3>

      <ExpandableCard
        icon="📦"
        title="What files do I get when I clone the repo? Are any credentials shared?"
      >
        <p className="mb-3">
          <strong>No credentials, lore, or personal data ever travel with the repo.</strong> Tusk's Vault uses a strict <Code>.gitignore</Code> so the only thing you get from a fresh clone is source code and configuration <em>templates</em>.
        </p>
        <p className="mb-3"><strong>What IS in the repo (~77 files):</strong></p>
        <ul className="list-disc list-inside space-y-1 ml-2 mb-3">
          <li>Source code — <Code>src/</Code>, <Code>server.ts</Code>, etc.</li>
          <li>Setup + launcher scripts — <Code>setup.bat</Code>, <Code>setup.sh</Code>, <Code>run.bat</Code>, <Code>run.sh</Code></li>
          <li>The updater script — <Code>scripts/update.mjs</Code></li>
          <li><Code>.env.example</Code> — a template showing what env vars to set (no actual values)</li>
          <li>A <Code>Lore/</Code> folder containing only a README — the legacy in-repo location, kept so older installs keep working</li>
          <li>The favicon, project metadata, license, this README, package files</li>
        </ul>
        <p className="mb-3"><strong>What is NOT in the repo (created at runtime on your machine):</strong></p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><Code>.env.local</Code> — created when you save your Discord token from the dashboard</li>
          <li><Code>keys.enc</Code> in your config directory — created, encrypted, when you add your first LLM key</li>
          <li><Code>settings.json</Code> — created when you save settings</li>
          <li><Code>clarifications.json</Code>, <Code>clarifications.embeddings.json</Code>, <Code>lore_gaps.json</Code> — created as you use the bot</li>
          <li><Code>node_modules/</Code> — created by <Code>npm install</Code></li>
          <li><Code>models/</Code> — local embedding model cache, downloaded on first server boot</li>
          <li><Code>.port-runtime</Code>, <Code>run.log</Code> — runtime-only</li>
          <li>Anything in <Code>Tusks-Lore/</Code>, or dropped into <Code>Lore/</Code> beyond the README — gitignored either way</li>
        </ul>
        <p className="mt-3">
          So when you clone, you get everything you need to <strong>run</strong> the app, and nothing of mine. The first launch creates the missing pieces with empty/default state automatically — no manual file creation needed.
        </p>
      </ExpandableCard>

      <h3 className="font-display text-xl text-gold-300/80 mt-8 mb-2">Installing & updating</h3>

      <ExpandableCard
        icon="⚙️"
        title="How do I install Tusk's Vault from scratch?"
      >
        <p className="mb-3">
          The single requirement is <strong>Node.js 20+</strong>. Once that's installed, you have three roads:
        </p>
        <ul className="list-disc list-inside space-y-2 ml-2">
          <li>
            <strong>Windows, click-only:</strong> download the repo as a ZIP from <Link href="https://github.com/KochiTusker/Tusks-Vault">GitHub</Link>, unzip it, double-click <Code>run.bat</Code>. The launcher checks Node, installs dependencies on first run (~1 minute), starts the server, opens your browser. There's also an optional <Code>setup.bat</Code> if you want to do the install step separately first.
          </li>
          <li>
            <strong>macOS / Linux, terminal:</strong> <Code>git clone</Code> the repo, then <Code>./setup.sh</Code> once (checks prereqs + installs deps) followed by <Code>./run.sh</Code> any time you want to launch. <Code>setup.sh</Code> is optional; <Code>run.sh</Code> handles the install on first launch by itself.
          </li>
          <li>
            <strong>Anywhere, with a terminal:</strong> <Code>git clone</Code>, <Code>npm install</Code>, <Code>npm start</Code>. Same thing under the hood.
          </li>
        </ul>
        <p className="mt-3 text-parchment-100/70">
          <strong>Git is recommended</strong> alongside Node. You don't strictly need it to <em>run</em> Tusk's Vault, but the in-app "Check for updates" button does, so it saves you re-downloading the ZIP every time there's a new release.
        </p>
      </ExpandableCard>

      <ExpandableCard
        icon="🔄"
        title="How do I update Tusk's Vault to the latest version?"
        pill={<Pill tone="verdigris">One-click</Pill>}
      >
        <p className="mb-3">
          Three ways, all of them safe — your lore, API keys, Discord token, settings, and clarifications are all gitignored and untouched by the update process.
        </p>
        <ol className="list-none">
          <Step n={1}>
            <strong>From the dashboard (recommended):</strong> open the <strong>About</strong> page (war-elephant icon in the rail) → scroll to the <strong>Updates</strong> card. Click <strong>Check</strong>. If you're behind origin/main, click <strong>Update now</strong>. The script fetches the latest code, re-runs <Code>npm install</Code>, and tells you when to restart.
          </Step>
          <Step n={2}>
            <strong>From a terminal:</strong> in the project folder, run <Code>npm run update</Code>. Same script the dashboard uses.
          </Step>
          <Step n={3}>
            <strong>Manual git:</strong> <Code>git pull</Code> followed by <Code>npm install</Code>. If you didn't clone with Git (downloaded the ZIP instead), re-download the latest ZIP from GitHub and overwrite the unzipped folder; your gitignored files stay where they are.
          </Step>
        </ol>
        <p className="mt-3 text-parchment-100/70">
          Updates are free, optional, and never required. If a release breaks something for you, just don't update yet — the version you have keeps working.
        </p>
      </ExpandableCard>

      <h3 className="font-display text-xl text-gold-300/80 mt-8 mb-2">Other chat surfaces</h3>

      <ExpandableCard
        icon="🎲"
        title="Can I use Tusk's Vault from Foundry VTT instead of Discord?"
        pill={<Pill tone="gold">Shipped</Pill>}
      >
        <p className="mb-3">
          Yes. A companion Foundry module adds a <Code>/tusk &lt;question&gt;</Code> command to the
          chat bar, and the answer posts into the chat log with the same citations players get in
          Discord. It pairs with your running Vault in one click — you approve the pairing from the
          dashboard, so a page cannot connect itself.
        </p>
        <ul className="list-disc list-inside space-y-2 ml-2">
          <li>
            <strong>Per-world access mode.</strong> You decide whether players may ask at all, and
            whether an answer is whispered to the asker or posted for the table. Not every answer is
            one the party should have.
          </li>
          <li>
            <strong>The module is a separate install.</strong> It lives in its own repository and is
            installed through Foundry, because Foundry's registry serves whichever release is newest
            and a shared repo would tangle the two projects' updates together.
          </li>
        </ul>
        <p className="mt-3 text-parchment-100/70">
          Setup, access modes and the spoiler trade-off are in the Foundry VTT doc.
        </p>
      </ExpandableCard>

      <ExpandableCard
        icon="🔌"
        title="Can other tools query my lore?"
        pill={<Pill tone="gold">Shipped</Pill>}
      >
        <p className="mb-3">
          Yes — Vault speaks MCP (Model Context Protocol) over HTTP, so any MCP client can ask your
          campaign questions. There are three tools and no more: <Code>ask_lore</Code>,{" "}
          <Code>search_lore</Code> and <Code>list_sources</Code>. A tool surface that grows to mirror
          the whole dashboard becomes a second, worse dashboard.
        </p>
        <p className="mb-3">
          Every client pairs explicitly and is bound to the origin it paired from, and its access
          level is fixed at pairing time rather than claimed per request — otherwise a caller could
          simply ask for more than you granted it.
        </p>
        <p className="mt-3 text-parchment-100/70">
          Roll20 is <em>not</em> supported: its API is gated behind a Pro subscription, so it would
          only work for paying subscribers. If you want it,{" "}
          <Link href="https://github.com/KochiTusker/Tusks-Vault/issues">open an issue</Link> and say
          how you'd use it.
        </p>
      </ExpandableCard>

      <h3 className="font-display text-xl text-gold-300/80 mt-8 mb-2">Pairing with Tusk's Tomes</h3>

      <ExpandableCard
        icon="📜"
        title="How do I use Tusk's Vault together with Tusk's Tomes?"
        pill={<Pill tone="verdigris">Companion project</Pill>}
      >
        <p className="mb-3">
          <Link href="https://github.com/KochiTusker/Tusks-Tomes">Tusk's Tomes</Link> is the companion project — it records your Discord voice sessions, transcribes them offline with Whisper, then produces a polished narrative chronicle of each session. Vault is the librarian; Tomes is the chronicler. Together they form a complete loop: <strong>play → record → transcribe → chronicle → ingest as lore → query in Discord</strong>.
        </p>
        <p className="mb-3">
          <strong>Recommended setup:</strong>
        </p>
        <ol className="list-none">
          <Step n={1}>Clone both repos as siblings in the same parent folder, e.g.<br /><Code>~/projects/Tusks-Vault</Code> and <Code>~/projects/Tusks-Tomes</Code>.</Step>
          <Step n={2}>Set up Tomes per its own README (Node 20+, Python venv for Whisper).</Step>
          <Step n={3}>Record a session in Tomes. When the chronicle is finished, Tomes saves a Markdown file under <Code>Tusks-Tomes/Sessions/&lt;campaign&gt;/</Code>. Vault picks up any <Code>.md</Code> in that tree, whatever Tomes names it.</Step>
          <Step n={4}>In Vault's <strong>Lore</strong> tab, you'll see a "Paired with Tusk's Tomes" card. It auto-detects the adjacent install and lists every chronicle on disk.</Step>
          <Step n={5}>Click <strong>Sync N new</strong>. Vault copies the chronicles into its own <Code>Lore/</Code> folder, embedded for retrieval. From the next Discord message onward, "what happened in session 5?" will cite the actual chronicle.</Step>
        </ol>
        <p className="mt-3">
          <strong>Different folder?</strong> Set the absolute path in Settings → <em>Tusk's Tomes Sessions Path</em>. Default candidates: <Code>../Tusks-Tomes/Sessions</Code>, <Code>../tusks-tomes/Sessions</Code>, <Code>../Tomes/Sessions</Code>.
        </p>
        <p className="mt-3 text-parchment-100/70">
          Sync is one-way (Tomes → Vault) and copies — it doesn't move the files, so Tomes' Sessions folder stays intact. Re-syncing only imports new chronicles; existing ones are skipped.
        </p>
      </ExpandableCard>

      <h3 className="font-display text-xl text-gold-300/80 mt-8 mb-2">Privacy & data</h3>

      <ExpandableCard
        icon="🔐"
        title="Where is my data stored? Does anything go to the cloud?"
      >
        <p className="mb-3">Everything lives in this folder on your machine. The files are all gitignored — they never get pushed.</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><Code>Tusks-Lore/</Code> — your campaign documents. It sits beside the app folder rather than inside it, so a clean reinstall cannot take your lore with it.</li>
          <li><Code>keys.enc</Code> + <Code>keys.salt</Code>, in the app's per-user config directory — your API keys, encrypted (AES-256-GCM) and tied to this machine. Masked in the UI, and never returned unmasked.</li>
          <li><Code>.env.local</Code> — your Discord bot token + App ID, optional env-style provider keys.</li>
          <li><Code>clarifications.json</Code> + <Code>clarifications.embeddings.json</Code> — DM clarifications + their semantic vectors.</li>
          <li><Code>lore_gaps.json</Code> — questions the bot couldn't answer.</li>
          <li><Code>settings.json</Code> — bot persona, retrieval thresholds, etc.</li>
          <li><Code>models/</Code> — cached local embedding model (~25 MB).</li>
        </ul>
        <p className="mt-3">
          Outbound network calls are exactly two: Discord's gateway (so the bot can chat), and your chosen LLM provider's API (per query). No telemetry, no analytics, no phone-home.
        </p>
      </ExpandableCard>

      <ExpandableCard
        icon="🛡️"
        title="Can other people on my network see my dashboard?"
      >
        <p>
          No — the dashboard binds to <Code>127.0.0.1</Code> by default, which is reachable only from this machine. To deliberately expose it on your LAN (e.g. running on a NAS), open <Code>.env.local</Code> and add <Code>HOST=0.0.0.0</Code>. Only do that if you trust everyone on your network — the API has no authentication.
        </p>
      </ExpandableCard>
    </motion.div>
  );
}
