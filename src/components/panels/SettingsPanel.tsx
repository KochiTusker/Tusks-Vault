// Settings — grouped into collapsible PageSections with a sticky jump rail
// and a search that filters sections and force-opens matches. The section
// model replaces one flat scroll of always-open cards: Settings is a place
// you return to for ONE specific thing, and the groups + rail make that
// thing reachable in a click. Section order is frequency-of-use — keys
// first, maintenance last (update warnings shouldn't be the greeting).
import { useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  Settings as SettingsIcon,
  Save,
  CheckCircle2,
  KeyRound,
  Drama,
  Feather,
  Cable,
  Wrench,
  Search,
  Zap as ZapIcon,
  Drama as DramaIcon,
} from "lucide-react";
import { FlameLoader } from "../FlameLoader";
import { SparkleBurst } from "../SparkleBurst";
import { CardCorners } from "../TtrpgIcons";
import { PageSection, PageSectionNav, type PageSectionDef } from "../PageSection";
import { UpdatesCard } from "../UpdatesCard";
import type { PersonaRow } from "../../hooks/usePersonas";

const SECTIONS: PageSectionDef[] = [
  {
    id: "keys",
    title: "API keys",
    blurb: "Provider credentials — add, test, and pick the active one.",
    icon: <KeyRound className="h-4 w-4" />,
    defaultOpen: true,
  },
  {
    id: "personas",
    title: "Personas",
    blurb: "The voices the scribe can answer in — presets and your own.",
    icon: <Drama className="h-4 w-4" />,
  },
  {
    id: "voice",
    title: "Voice & retrieval",
    blurb: "The bot's name, its system prompt, retrieval tuning, and reply toggles.",
    icon: <Feather className="h-4 w-4" />,
  },
  {
    id: "integrations",
    title: "Integrations",
    blurb: "Ollama endpoint and the Tusk's Tomes sessions path.",
    icon: <Cable className="h-4 w-4" />,
  },
  {
    id: "maintenance",
    title: "Maintenance",
    blurb: "Updates and developer tools.",
    icon: <Wrench className="h-4 w-4" />,
  },
];

// What the settings search matches, per section — title and blurb always
// count; these are the extra words people actually type.
const SECTION_KEYWORDS: Record<string, string> = {
  keys: "api key gemini claude openai openrouter token secret test active channel provider model browser catalogue price context moderated claude code subscription cli",
  personas: "persona voice narrator character preset generate author",
  voice:
    "name bot system prompt instruction retrieval clarification threshold topk similarity prefill " +
    "speculative references citation guardrails temperature",
  integrations: "ollama url base local llm tomes sessions path integration sibling",
  maintenance: "update updater version dev mode restart git pull",
};

interface Props {
  // Slots — the existing standalone panels render inside sections.
  keyVault: ReactNode;
  /** Rendered inside the keys section, after the vault — the OpenRouter
   *  catalogue browser. */
  modelBrowser?: ReactNode;
  personasPanel: ReactNode;
  // Voice & retrieval state.
  botName: string;
  setBotName: (v: string) => void;
  clarificationThreshold: number;
  setClarificationThreshold: (v: number) => void;
  clarificationTopK: number;
  setClarificationTopK: (v: number) => void;
  speculativeMode: boolean;
  /** Instant-save, like the references toggle. Not a plain setter: this flag
   *  changes what the bot does on its very next reply, and a version of it
   *  that only persisted via the bulk Save button spent a long time reading
   *  as on while the server held off. */
  onToggleSpeculativeMode: () => void;
  togglingSpeculativeMode: boolean;
  /** Set when the save did not stick. */
  speculativeError: string | null;
  includeReferences: boolean;
  togglingIncludeReferences: boolean;
  onToggleIncludeReferences: () => void;
  systemInstruction: string;
  setSystemInstruction: (v: string) => void;
  activePersona: PersonaRow | undefined;
  // Integrations.
  ollamaBaseUrl: string;
  setOllamaBaseUrl: (v: string) => void;
  tomesSessionsPath: string;
  setTomesSessionsPath: (v: string) => void;
  // Save.
  savingSettings: boolean;
  saveSuccess: boolean;
  onSave: () => void;
  devModeUnlocked: boolean;
}

export function SettingsPanel(props: Props) {
  const [query, setQuery] = useState("");

  const visibleSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(s =>
      `${s.title} ${s.blurb} ${SECTION_KEYWORDS[s.id] ?? ""}`.toLowerCase().includes(q)
    );
  }, [query]);
  const filtering = query.trim().length > 0;

  const body: Record<string, ReactNode> = {
    keys: (
      <>
        {props.keyVault}
        {props.modelBrowser}
      </>
    ),
    personas: props.personasPanel,
    voice: <VoiceSection {...props} />,
    integrations: <IntegrationsSection {...props} />,
    maintenance: <UpdatesCard devModeUnlocked={props.devModeUnlocked} />,
  };

  return (
    <section id="settings-section" className="scriptorium-card relative rounded-2xl p-6 md:p-8 mb-4 parchment">
      <CardCorners />
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gold-500/20 flex items-center justify-center text-gold-400">
            <SettingsIcon size={24} />
          </div>
          <div>
            <h2 className="font-display text-3xl font-bold tracking-wide text-gold-300">Settings</h2>
            <p className="text-white/40 text-sm">
              Keys, surfaces, retrieval tuning, and the scribe's voice. Connection + model selection live on the Home tab.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search settings…"
              className="bg-black/40 border border-white/10 rounded-xl pl-8 pr-3 py-2.5 text-sm text-white w-44 focus:outline-none focus:border-gold-400/60"
            />
          </div>
          <div className="relative">
            <SparkleBurst active={props.saveSuccess} />
            <button
              onClick={props.onSave}
              disabled={props.savingSettings}
              data-slot="primary-cta"
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all ${props.saveSuccess ? "bg-green-600" : "bg-gold-500 hover:bg-gold-400 text-ink-950"}`}
            >
              {props.savingSettings ? <FlameLoader size={20} /> : props.saveSuccess ? <CheckCircle2 size={20} /> : <Save size={20} />}
              <span>{props.savingSettings ? "Saving..." : props.saveSuccess ? "Saved!" : "Save Settings"}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        <PageSectionNav sections={visibleSections} />
        <div className="min-w-0 flex-1 space-y-3">
          {visibleSections.length === 0 && (
            <p className="py-8 text-center text-sm text-white/40">
              Nothing matches "{query}". The search covers section names and their contents' keywords.
            </p>
          )}
          {visibleSections.map(s => (
            <PageSection key={s.id} {...s} forceOpen={filtering}>
              {body[s.id]}
            </PageSection>
          ))}
        </div>
      </div>
    </section>
  );
}

function VoiceSection(props: Props) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-white/40 uppercase tracking-widest font-bold ml-1">Bot Name</label>
          <input
            value={props.botName}
            onChange={e => props.setBotName(e.target.value)}
            placeholder="Tusk"
            maxLength={40}
            className="bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-gold-400/60 font-serif"
          />
          <p className="text-[10px] text-white/30 ml-1">In-character name (used in Discord replies).</p>
        </div>
      </div>

      {/* Clarification retrieval tuning.
          Both controls were labelled in the vocabulary of the thing that
          implements them — "similarity threshold", "top-K" — which tells a GM
          nothing about what changes at their table. They now say what the bot
          does differently, and read back the current value as a sentence. */}
      <div className="bg-black/30 border border-white/5 rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <ZapIcon size={16} className="text-verdigris-400" />
          <h3 className="text-sm font-bold uppercase tracking-widest text-white/70">Answering from your rulings</h3>
        </div>
        <p className="text-xs text-white/50 leading-relaxed mb-4 max-w-3xl">
          When you answer a lore gap, that ruling is remembered. Before every question, Vault looks
          through your saved rulings for ones about the same thing — matching by meaning, not
          wording, so &ldquo;who runs the docks?&rdquo; still finds a ruling you wrote about the
          harbour master. Whatever it finds is added to the question before the model sees it.
          This happens on your own machine and costs nothing.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-white/40 uppercase tracking-widest font-bold">
                How closely a ruling must match
              </label>
              <span className="text-xs font-mono text-verdigris-400">
                {props.clarificationThreshold.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0.30"
              max="0.85"
              step="0.05"
              value={props.clarificationThreshold}
              onChange={e => props.setClarificationThreshold(parseFloat(e.target.value))}
              className="accent-gold-500"
              aria-describedby="clarify-threshold-help"
            />
            <p id="clarify-threshold-help" className="text-[11px] text-white/45 leading-relaxed">
              {props.clarificationThreshold <= 0.35
                ? "Very loose — rulings on loosely related subjects will be pulled in. Useful if the bot keeps ignoring rulings you know you wrote, but it can bring in ones that do not apply."
                : props.clarificationThreshold <= 0.5
                  ? "Balanced. Finds rulings that are about the same thing even when worded differently. This is the default and suits most tables."
                  : props.clarificationThreshold <= 0.7
                    ? "Strict — a ruling must be clearly about the question to be used. Fewer irrelevant rulings, but near-misses get missed."
                    : "Very strict — only near-identical wording matches. Most rulings will be ignored; use only if the bot keeps applying the wrong ones."}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-white/40 uppercase tracking-widest font-bold">
                How many rulings to use at once
              </label>
              <span className="text-xs font-mono text-verdigris-400">{props.clarificationTopK}</span>
            </div>
            <input
              type="range"
              min="1"
              max="15"
              step="1"
              value={props.clarificationTopK}
              onChange={e => props.setClarificationTopK(parseInt(e.target.value, 10))}
              className="accent-gold-500"
              aria-describedby="clarify-topk-help"
            />
            <p id="clarify-topk-help" className="text-[11px] text-white/45 leading-relaxed">
              {props.clarificationTopK === 1
                ? "Only the single best-matching ruling is used. Cheapest, but a question touching two of your rulings will only get one."
                : props.clarificationTopK <= 5
                  ? `Up to ${props.clarificationTopK} of your best-matching rulings are added to each question. ${props.clarificationTopK === 5 ? "This is the default and suits most tables." : ""}`.trim()
                  : props.clarificationTopK <= 10
                    ? `Up to ${props.clarificationTopK} rulings per question — good if you have written a lot of them about overlapping subjects. Each one adds to the length of the question, so answers cost slightly more.`
                    : `Up to ${props.clarificationTopK} rulings per question. Generous; only worth it with a large body of rulings, and it makes every question longer and dearer.`}
            </p>
          </div>
        </div>
        <p className="mt-4 text-[11px] text-white/35">
          Neither setting changes what is in your lore — only which of your own rulings the bot is
          reminded of. Both apply to every connection: Gemini, OpenRouter, Claude Code and Ollama
          alike, because the matching happens here before the question is sent.
        </p>
        {/* The Save button is at the TOP of this panel, well above these
            sliders. Other controls here save on click and say so; these do not,
            and a slider that visibly moves reads as applied. Saying which model
            applies is the difference between a setting and a decoration. */}
        <p className="mt-2 text-[11px] text-gold-300/60">
          Moving a slider does not apply it — press <strong>Save Settings</strong> at the top of
          this panel. The next question then uses the new values.
        </p>
      </div>

      <div className="bg-black/30 border border-gold-400/15 rounded-2xl p-4 mb-6">
        <div className="flex items-start gap-4">
          <button
            onClick={props.onToggleSpeculativeMode}
            disabled={props.togglingSpeculativeMode}
            className={`flex-shrink-0 relative w-14 h-8 rounded-full transition-all duration-300 mt-1 disabled:opacity-60 ${props.speculativeMode ? "bg-verdigris-400" : "bg-white/10"}`}
          >
            <motion.div animate={{ x: props.speculativeMode ? 26 : 4 }} className="absolute top-1 w-6 h-6 bg-white rounded-full shadow-lg" />
          </button>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <label
                className="text-sm font-bold tracking-wide text-gold-300 cursor-pointer"
                onClick={props.onToggleSpeculativeMode}
              >
                Speculative Mode
              </label>
              {/* The state the SERVER holds, not the switch position. This
                  toggle used to persist only through the bulk Save button, so
                  the two could disagree indefinitely — and when they did, every
                  "who is most likely to…" question came back as a lore gap with
                  nothing on screen explaining why. */}
              {props.togglingSpeculativeMode ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-white/45">
                  <FlameLoader size={9} /> Saving…
                </span>
              ) : props.speculativeError ? (
                <span className="rounded border border-red-400/40 px-1.5 py-px text-[10px] text-red-300/90">
                  Not saved — {props.speculativeError}
                </span>
              ) : props.speculativeMode ? (
                <span className="rounded border border-verdigris-400/40 bg-verdigris-400/10 px-1.5 py-px text-[10px] text-verdigris-400">
                  Active · saved
                </span>
              ) : (
                <span className="rounded border border-white/10 px-1.5 py-px text-[10px] text-white/35">
                  Off
                </span>
              )}
            </div>
            <p className="text-xs text-white/50 mt-1 leading-relaxed">
              Lets {props.botName || "Tusk"} answer hypothetical / silly questions ("who is most likely to order a
              glass of milk at Starbucks?") by reasoning about characters' established personalities from the
              chronicle. Speculative answers are tagged{" "}
              <code className="font-mono text-verdigris-400">[speculation]</code>. Real lore questions still require
              proper source citations.
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-white/35">
              Saved the moment you click it — no need to press Save Settings. With this off, a
              question like <em>“who is most likely to…”</em> can never be sourced, so the bot
              answers it with the lore-gap phrase instead.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-black/30 border border-gold-400/15 rounded-2xl p-4 mb-6">
        <div className="flex items-start gap-4">
          <button
            onClick={props.onToggleIncludeReferences}
            disabled={props.togglingIncludeReferences}
            className={`flex-shrink-0 relative w-14 h-8 rounded-full transition-all duration-300 mt-1 disabled:opacity-60 ${props.includeReferences ? "bg-gold-500" : "bg-white/10"}`}
          >
            <motion.div animate={{ x: props.includeReferences ? 26 : 4 }} className="absolute top-1 w-6 h-6 bg-white rounded-full shadow-lg" />
          </button>
          <div className="flex-1">
            <label className="text-sm font-bold tracking-wide text-gold-300 cursor-pointer" onClick={props.onToggleIncludeReferences}>
              Show Source References
            </label>
            {/* "before they reach Discord" was true when Discord was the only
                surface. Foundry and MCP clients read the same stripped text,
                and saying otherwise invites the reasonable conclusion that the
                toggle does not apply to them. */}
            <p className="text-xs text-white/50 mt-1 leading-relaxed">
              When on, {props.botName || "Tusk"}'s replies include citation tags like{" "}
              <code className="font-mono text-gold-300">[chronicle.md]</code>,{" "}
              <code className="font-mono text-gold-300">[Alder Finch]</code> or{" "}
              <code className="font-mono text-gold-300">[clarification: cl-42]</code> after each claim. Turn off for
              cleaner prose — {props.botName || "Tusk"} still cites internally so answers stay grounded; the tags are
              stripped just before the answer is shown, on every surface: here, Discord, Foundry and any MCP client.
              Takes effect on the next reply, and applies however the model shortened the name.
            </p>
          </div>
        </div>
      </div>

      {props.activePersona && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-verdigris-400/30 bg-verdigris-400/[0.06] px-3 py-2 text-xs text-verdigris-100/85">
          <DramaIcon size={13} className="text-verdigris-300 flex-shrink-0" />
          <span>
            Active persona <strong className="text-white">{props.activePersona.name}</strong> overrides this system
            instruction at chat time. Edits below only apply when no persona is active.
          </span>
        </div>
      )}

      <textarea
        value={props.systemInstruction}
        onChange={e => props.setSystemInstruction(e.target.value)}
        placeholder="Enter the bot's core context, rules, and identity here..."
        className="w-full h-64 bg-black/40 border border-white/10 rounded-2xl p-6 text-white/80 focus:outline-none focus:border-gold-400/60 transition-all resize-none font-mono text-sm leading-relaxed"
      />
    </>
  );
}

function IntegrationsSection(props: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-white/40 uppercase tracking-widest font-bold ml-1">Ollama Base URL</label>
        <input
          value={props.ollamaBaseUrl}
          onChange={e => props.setOllamaBaseUrl(e.target.value)}
          placeholder="http://localhost:11434"
          className="bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-gold-400/60 font-mono"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-white/40 uppercase tracking-widest font-bold ml-1">
          Tusk's Tomes Sessions Path
        </label>
        <input
          value={props.tomesSessionsPath}
          onChange={e => props.setTomesSessionsPath(e.target.value)}
          placeholder="(auto-detect ../Tusks-Tomes/Sessions)"
          className="bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-gold-400/60 font-mono"
        />
        <p className="text-[10px] text-white/30 ml-1">Leave empty to auto-detect adjacent installations.</p>
      </div>
    </div>
  );
}
