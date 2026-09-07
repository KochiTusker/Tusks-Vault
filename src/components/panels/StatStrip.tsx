// Home dashboard 4-up stat strip — at-a-glance snapshot of the bot's state.
// Each card is clickable / actionable. Extracted verbatim from App.tsx.
import { motion } from "motion/react";
import { Zap as ZapIcon, BookOpen, ScrollText } from "lucide-react";
import type { LlmProvider, LlmTier } from "../../types/keys";

interface Props {
  loading: boolean;
  statusText: string | undefined;
  botName: string | undefined;
  discordConfigured: boolean;
  activeKeyLabel: string | null;
  activeProviderLabel: string | null;
  provider: LlmProvider;
  defaultTier: LlmTier;
  proModel: string;
  flashModel: string;
  knowledgeCount: number;
  gapCount: number;
  onOpenDiscord: () => void;
  onGoLore: () => void;
  onGoGaps: () => void;
}

export function StatStrip({
  loading,
  statusText,
  botName,
  discordConfigured,
  activeKeyLabel,
  activeProviderLabel,
  provider,
  defaultTier,
  proModel,
  flashModel,
  knowledgeCount,
  gapCount,
  onOpenDiscord,
  onGoLore,
  onGoGaps,
}: Props) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.45 }}
      className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
    >
      <button
        type="button"
        onClick={onOpenDiscord}
        className="text-left rounded-2xl border border-border/20 bg-surface p-5 hover:border-primary/50 hover:bg-surface-elevated transition-all gold-hover"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-foreground/40 text-[10px] uppercase tracking-widest font-bold">Bot Status</span>
          <div
            className={`w-2 h-2 rounded-full ${
              statusText === "Online"
                ? "bg-success animate-pulse shadow-glow-success-sm"
                : // Neutral, not red: nothing has failed on an install where
                  // Discord was simply never set up.
                  discordConfigured
                  ? "bg-danger"
                  : "bg-white/20"
            }`}
          />
        </div>
        {/* `truncate` needs a title or the text is simply gone: "Error: Missing
            Token" rendered as "Error: Missing …" with nothing on hover, which
            is the first thing a new user reads. And an optional surface nobody
            has set up yet is not an error — on a fresh install we say so
            plainly rather than showing red text the user cannot act on. */}
        <div
          className="font-display text-xl font-bold text-foreground-strong truncate"
          title={loading ? undefined : statusText || "Unknown"}
        >
          {loading ? "..." : !discordConfigured ? "Not connected" : statusText || "Unknown"}
        </div>
        <div className="text-foreground/50 text-xs mt-1 truncate">
          {botName || (discordConfigured ? "Connecting..." : "Click to add Discord token")}
        </div>
      </button>

      <div className="rounded-2xl border border-border/20 bg-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-foreground/40 text-[10px] uppercase tracking-widest font-bold">Active Channel</span>
          <ZapIcon size={14} className="text-primary/60" />
        </div>
        <div className="font-display text-xl font-bold text-foreground-strong truncate">
          {activeProviderLabel ?? (provider === "ollama" ? "Ollama" : "—")}
        </div>
        <div className="text-foreground/50 text-xs mt-1 truncate">
          {activeKeyLabel
            ? `${activeKeyLabel} · ${defaultTier === "pro" ? proModel : flashModel}`
            : provider === "ollama"
              ? "local inference"
              : "No key selected"}
        </div>
      </div>

      <button
        type="button"
        onClick={onGoLore}
        className="text-left rounded-2xl border border-border/20 bg-surface p-5 hover:border-primary/50 hover:bg-surface-elevated transition-all gold-hover"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-foreground/40 text-[10px] uppercase tracking-widest font-bold">Lore Documents</span>
          <BookOpen size={14} className="text-primary/60" />
        </div>
        <div className="font-display text-2xl font-bold text-foreground-strong">{knowledgeCount}</div>
        <div className="text-foreground/50 text-xs mt-1">
          {knowledgeCount === 0 ? "Upload below to begin" : "indexed in Lore/"}
        </div>
      </button>

      <button
        type="button"
        onClick={onGoGaps}
        className="text-left rounded-2xl border border-border/20 bg-surface p-5 hover:border-primary/50 hover:bg-surface-elevated transition-all gold-hover"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-foreground/40 text-[10px] uppercase tracking-widest font-bold">Lore Gaps</span>
          <ScrollText size={14} className="text-primary/60" />
        </div>
        <div className="font-display text-2xl font-bold text-foreground-strong">{gapCount}</div>
        <div className="text-foreground/50 text-xs mt-1">
          {gapCount === 0 ? "all answered" : "awaiting your input"}
        </div>
      </button>
    </motion.section>
  );
}
