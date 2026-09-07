import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check } from "lucide-react";
import { ExpandableCard } from "./ExpandableCard";
import { RuneDivider } from "./RuneDivider";

type StepStatus = "done" | "current" | "pending";

interface StepProps {
  n: number;
  title: React.ReactNode;
  status: StepStatus;
  delay: number;
  children: React.ReactNode;
}

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="font-mono text-[13px] bg-ink-900/70 text-gold-200 px-1.5 py-0.5 rounded border border-gold-400/20">
    {children}
  </code>
);

function StepMedallion({ status, n }: { status: StepStatus; n: number }) {
  if (status === "done") {
    return (
      <div
        className="w-14 h-14 rounded-full border-2 border-success/70 bg-gradient-to-br from-success/40 to-primary/25 flex items-center justify-center shadow-glow-success-md"
        aria-label={`Step ${n}: complete`}
      >
        <Check size={28} className="text-emerald-100" strokeWidth={3} />
      </div>
    );
  }
  if (status === "pending") {
    return (
      <div className="w-14 h-14 rounded-full border-2 border-border/20 bg-surface-elevated/40 flex items-center justify-center opacity-60">
        <span className="font-display text-2xl font-bold text-foreground-strong/50">{n}</span>
      </div>
    );
  }
  return (
    <div className="w-14 h-14 rounded-full border-2 border-primary/60 bg-gradient-to-br from-primary/40 to-danger/30 flex items-center justify-center shadow-glow-md">
      <span className="font-display text-2xl font-bold text-foreground-strong">{n}</span>
    </div>
  );
}

function Step({ n, title, status, delay, children }: StepProps) {
  return (
    <motion.section
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: status === "pending" ? 0.7 : 1, x: 0 }}
      transition={{ delay, duration: 0.5, ease: "easeOut" }}
      className="relative flex gap-5"
    >
      <div className="flex-shrink-0 flex flex-col items-center">
        <StepMedallion status={status} n={n} />
        <div
          className={`w-px flex-1 mt-2 ${
            status === "done"
              ? "bg-gradient-to-b from-success/40 to-transparent"
              : "bg-gradient-to-b from-primary/40 to-transparent"
          }`}
        />
      </div>
      <div className="flex-1 pb-10">
        <h3 className="font-display text-2xl font-bold text-primary-hover mb-2">{title}</h3>
        <div className="font-serif text-foreground/85 leading-relaxed text-[15px] space-y-3">
          {children}
        </div>
      </div>
    </motion.section>
  );
}

interface SetupState {
  hasKey: boolean;
  discordConnected: boolean;
  hasLore: boolean;
  loaded: boolean;
}

function useSetupProgress(): SetupState {
  const [state, setState] = useState<SetupState>({
    hasKey: false,
    discordConnected: false,
    hasLore: false,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const [keysR, statusR, knowR] = await Promise.all([
          fetch("/api/keys").then(r => (r.ok ? r.json() : null)),
          fetch("/api/status").then(r => (r.ok ? r.json() : null)),
          fetch("/api/knowledge").then(r => (r.ok ? r.json() : null)),
        ]);
        if (cancelled) return;
        const hasKey = Array.isArray(keysR?.keys) && keysR.keys.length > 0;
        const discordConnected = statusR?.status === "Online";
        const hasLore = Array.isArray(knowR) ? knowR.length > 0 : Array.isArray(knowR?.files) ? knowR.files.length > 0 : false;
        setState({ hasKey, discordConnected, hasLore, loaded: true });
      } catch {
        if (!cancelled) setState(s => ({ ...s, loaded: true }));
      }
    }
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return state;
}

// The five actionable setup checkpoints. Steps 1 + 2 are implicitly done by
// virtue of the user seeing this page; the other three are live-detected.
const TOTAL_CHECKPOINTS = 5;

function ProgressBar({ completed }: { completed: number }) {
  return (
    <div className="flex flex-col gap-2 mb-1">
      <div className="flex items-baseline justify-between">
        <p className="font-display text-sm tracking-[0.18em] uppercase text-primary-hover/80">
          Setup progress
        </p>
        <p className="font-serif italic text-foreground/70 text-sm">
          {completed} of {TOTAL_CHECKPOINTS} steps complete
          {completed === TOTAL_CHECKPOINTS && " — ready to play"}
        </p>
      </div>
      <div className="flex gap-1.5 h-2.5">
        {Array.from({ length: TOTAL_CHECKPOINTS }, (_, i) => i).map(i => (
          <motion.div
            key={i}
            initial={false}
            animate={{
              // Completed = emerald success; pending = faint ember (matches
              // Vault's warm primary).
              backgroundColor: i < completed ? "rgb(52 211 153 / 0.75)" : "oklch(0.72 0.19 55 / 0.20)",
            }}
            transition={{ duration: 0.4 }}
            className={`flex-1 rounded-sm ${i < completed ? "shadow-glow-success-sm" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

function RequiredChip() {
  return (
    <span className="ml-2 inline-flex items-center align-middle px-2 py-0.5 rounded-full text-[11px] font-display tracking-[0.14em] uppercase bg-danger/20 text-crimson-200 border border-danger/50">
      Required
    </span>
  );
}

export function BeginnerGuidePage() {
  const { hasKey, discordConnected, hasLore } = useSetupProgress();

  // Steps 1 + 2 are by definition done — you can't see this page otherwise.
  const nodeDone = true;
  const launchDone = true;

  const completed =
    (nodeDone ? 1 : 0) +
    (launchDone ? 1 : 0) +
    (hasKey ? 1 : 0) +
    (discordConnected ? 1 : 0) +
    (hasLore ? 1 : 0);

  // The "current" step is the first incomplete one in the actionable sequence.
  // Steps 6 + 7 are informational sign-off; they don't take "current" focus.
  function statusOf(stepN: number): StepStatus {
    const done = [nodeDone, launchDone, hasKey, discordConnected, hasLore][stepN - 1];
    if (done) return "done";
    // First incomplete step is "current"; later actionable steps are "pending".
    const firstIncomplete = [nodeDone, launchDone, hasKey, discordConnected, hasLore].findIndex(d => !d) + 1;
    return stepN === firstIncomplete ? "current" : "pending";
  }

  // Test-it / That's-it: light up "current" once all five real checkpoints are done.
  const testStatus: StepStatus = completed === TOTAL_CHECKPOINTS ? "current" : "pending";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="mb-8">
        <h2 className="font-display text-4xl font-bold text-gold-300 tracking-wide mb-2">A Beginner's Guide</h2>
        <p className="font-serif text-parchment-100/60 italic mb-5">
          You've never used GitHub, the command line, or an AI bot before. That's fine. This takes about five minutes — and you've already done the first two steps just by getting here.
        </p>
        <ProgressBar completed={completed} />
        <RuneDivider />
      </header>

      <div className="space-y-0">
        <Step n={1} title="Install Node.js" status={statusOf(1)} delay={0.1}>
          <p className="text-emerald-200/90">
            <strong>Done.</strong> If you weren't running Node, this dashboard wouldn't be open in your browser — so this step is already complete. The notes below are here for reference.
          </p>
          <p>
            Tusk's Vault runs on Node — the same runtime that powers most modern web apps. You only need to install it once.
          </p>
          <ol className="list-disc list-inside space-y-1 ml-2 text-parchment-100/70">
            <li>Go to <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer" className="text-gold-300 underline">nodejs.org</a>.</li>
            <li>Click the big green <strong>LTS</strong> button (it stands for "Long-Term Support" — the stable version).</li>
            <li>Run the installer. Defaults are fine — click Next through everything.</li>
            <li>If it asks to restart, restart.</li>
          </ol>
          <p className="text-parchment-100/60 text-sm">
            On macOS or Linux? Use Homebrew (<Code>brew install node</Code>) or your distro's package manager.
          </p>
        </Step>

        <Step n={2} title="Launch Tusk's Vault" status={statusOf(2)} delay={0.15}>
          <p className="text-emerald-200/90">
            <strong>Done.</strong> The fact that this dashboard is loaded in your browser means <Code>run.bat</Code> (or <Code>./run.sh</Code>) is doing its job — the server is up, the port is bound, and the bot is ready to be configured.
          </p>
          <p className="text-parchment-100/70">
            For reference: double-click <Code>run.bat</Code> any time you want to start the bot. The first launch installs dependencies (~1 minute); subsequent launches are instant. <strong>Keep the black window open</strong> — closing it stops Tusk's Vault.
          </p>
        </Step>

        <Step n={3} title="Add an LLM API key" status={statusOf(3)} delay={0.2}>
          {hasKey ? (
            <p className="text-emerald-200/90">
              <strong>Done.</strong> An LLM key is configured — your bot has a brain to think with. You can add more keys later (one per provider, multiple per provider for different tiers) under <strong>Settings → Key Vault</strong>.
            </p>
          ) : (
            <>
              <p>
                The bot needs to talk to an AI model. You have four options:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Google Gemini</strong> — has a free tier. <span className="text-gold-300">Recommended if you're just starting.</span></li>
                <li><strong>OpenRouter</strong> — paid. One key reaches Claude, GPT and ~400 other models on one bill.</li>
                <li><strong>Claude Code</strong> — no key at all if you already pay for Claude Pro or Max.</li>
                <li><strong>Ollama</strong> — free, fully local, lower quality.</li>
              </ul>
              <p>
                Detailed step-by-step instructions for each are in the <strong>FAQ</strong> (tome icon in the sidebar). Once you have a key:
              </p>
              <ol className="list-disc list-inside space-y-1 ml-2">
                <li>Click the <strong>quill icon</strong> in the sidebar to open Settings.</li>
                <li>Find the <strong>Key Vault</strong> section.</li>
                <li>Click <strong>Add Key</strong>, pick your provider, label it (e.g. "Personal Free"), pick the tier, paste the key.</li>
              </ol>
            </>
          )}
        </Step>

        <Step
          n={4}
          title={<>Connect your Discord bot<RequiredChip /></>}
          status={statusOf(4)}
          delay={0.25}
        >
          {discordConnected ? (
            <p className="text-emerald-200/90">
              <strong>Done.</strong> Your bot is logged in and listening for <Code>@</Code>-mentions in any Discord server you've invited it to. You can swap the token any time from the Bot Status card on the Home page.
            </p>
          ) : (
            <>
              <p>
                Tusk's Vault is a <strong>Discord bot</strong> — the dashboard is for configuring it, but the actual conversations happen in your campaign server. <strong>You need to set this up.</strong> Without a Discord token, the bot can't answer anyone.
              </p>
              <p className="text-parchment-100/70">
                The fast path: click the <strong>Bot Status</strong> card on the Home page — it walks you through the four clicks. Or expand the card below for a click-by-click breakdown.
              </p>
              <div className="mt-4">
                <ExpandableCard
                  icon="🤖"
                  title="Show Discord bot setup steps (click to expand)"
                  defaultOpen={false}
                >
                  <ol className="list-decimal list-inside space-y-2 ml-1">
                    <li>
                      Open the <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="text-gold-300 underline">Discord Developer Portal</a> and sign in with your Discord account.
                    </li>
                    <li>
                      Click <strong>New Application</strong>. Name it whatever you want — this is what shows up in your server (e.g. "Tusk", "Lorekeeper", "BookwormBot").
                    </li>
                    <li>
                      Click <strong>Bot</strong> in the sidebar, then <strong>Reset Token</strong>, and copy the token. <em>Discord shows it once — if you lose it, reset again and use the new one.</em>
                    </li>
                    <li>
                      Still on that page, scroll to <strong>Privileged Gateway Intents</strong> and <strong>enable Message Content Intent</strong>. Click Save Changes. Without it the bot connects, sees every message as empty, and answers nothing.
                    </li>
                    <li>
                      Back in Tusk's Vault: <strong>Bot Status</strong> card on the Home page — paste the token. Vault checks it against Discord as you paste and names the bot it belongs to, so you can confirm it is the one you meant. The token is the only thing it needs: the application id lives inside the token, so there is no second field to get wrong.
                    </li>
                    <li>
                      Vault builds the <strong>invite URL</strong> with the right permissions already selected (Send Messages, Read Message History, Embed Links, Attach Files, Add Reactions). Click it, pick your campaign server, and Authorize. The bot connects on save — no server restart.
                    </li>
                  </ol>
                  <p className="mt-4 text-parchment-100/70 text-sm">
                    <strong>Troubleshooting:</strong> if the status stays red after pasting, check you copied the <em>bot</em> token and not something else — Vault refuses a user-account token outright, because automating a user account gets the account banned. If the bot goes green but ignores every mention, Message Content Intent is off (step 4). The FAQ has more diagnostic steps.
                  </p>
                </ExpandableCard>
              </div>
            </>
          )}
        </Step>

        <Step n={5} title="Upload your lore documents" status={statusOf(5)} delay={0.3}>
          {hasLore ? (
            <p className="text-emerald-200/90">
              <strong>Done.</strong> Your lore folder has at least one document indexed. Add more any time — drop files into the folder, or use the <strong>Lore</strong> tab's Bulk Upload. The bot re-reads the folder on every query, so updates are instant.
            </p>
          ) : (
            <>
              <p>
                Open the <strong>Lore</strong> tab and click <strong>Bulk Upload</strong>, then select your campaign PDFs, Word docs, session logs, etc.
              </p>
              <p className="text-parchment-100/70 text-sm">
                For Google Docs: download them as Word or plain text first (<em>File → Download → Microsoft Word</em>).
              </p>
            </>
          )}
        </Step>

        <Step n={6} title="Test it" status={testStatus} delay={0.35}>
          <p>
            In your Discord server, type <Code>@&lt;your bot name&gt; who is &lt;a character from your notes&gt;?</Code>
          </p>
          <p>
            You should get an answer cited back to your document. If the bot can't find an answer, it'll say so — and you'll see the question appear in the <strong>Lore Gaps</strong> tab. Click it, type the answer, save — and the bot remembers it forever.
          </p>
        </Step>

        <Step n={7} title="That's it" status="pending" delay={0.4}>
          <p>
            Run.bat starts and stops Tusk's Vault. Your keys, lore, and Discord token persist between launches — you only set them up once.
          </p>
          <p>
            From here:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>The <strong>FAQ</strong> (tome icon) has detailed answers to common questions.</li>
            <li>The <strong>About</strong> page (elephant icon) explains the philosophy and how to support development.</li>
            <li>The <strong>Settings</strong> page (quill icon) lets you tune Speculative Mode, change the bot's name, adjust the clarification threshold, and more.</li>
          </ul>
        </Step>
      </div>
    </motion.div>
  );
}
