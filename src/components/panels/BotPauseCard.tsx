// Single-button kill switch — the first interactive element on Home, so the
// user is one click from "stop responding RIGHT NOW" without deleting the
// Discord token. When paused, the bot stays connected so unpausing is
// instant. Extracted verbatim from App.tsx.
import { motion } from "motion/react";
import { Power, PowerOff } from "lucide-react";

interface Props {
  botPaused: boolean;
  toggling: boolean;
  onToggle: () => void;
  /** Whether Discord actually has a token. A fresh install has the Discord
   *  surface enabled by default but no token, and this card used to announce
   *  "Bot is responding" directly above the red "Error: Missing Token" card —
   *  two adjacent widgets contradicting each other on the first screen a new
   *  user ever sees. The kill switch still works in that state (pausing a
   *  disconnected bot is meaningful — it persists), so the card stays live and
   *  only its CLAIM changes. */
  discordConfigured: boolean;
}

export function BotPauseCard({ botPaused, toggling, onToggle, discordConfigured }: Props) {
  // Three states, not two: paused, responding, and "nothing to respond with".
  const idle = !botPaused && !discordConfigured;
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      disabled={toggling}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`w-full mb-4 flex items-center gap-3 rounded-2xl border px-4 py-3 transition-all text-left disabled:opacity-60 ${
        botPaused
          ? "bg-crimson-500/15 border-crimson-500/50 hover:bg-crimson-500/20 hover:border-crimson-500/70"
          : idle
            ? "bg-white/[0.03] border-white/10 hover:bg-white/[0.05] hover:border-white/20"
            : "bg-green-500/[0.08] border-green-500/30 hover:bg-green-500/[0.12] hover:border-green-500/50"
      }`}
      aria-pressed={botPaused}
      title={
        botPaused
          ? "Click to resume — bot will start replying to mentions and DMs again."
          : idle
            ? "Add a Discord token to put the bot in your server. This switch already works — it decides whether the bot replies once it is connected."
            : "Click to pause — bot stops replying. Stays connected to Discord; unpausing is instant."
      }
    >
      {botPaused ? (
        <PowerOff size={18} className="text-crimson-400 flex-shrink-0" />
      ) : (
        <Power size={18} className={`flex-shrink-0 ${idle ? "text-white/25" : "text-green-400"}`} />
      )}
      <span className="font-display text-sm font-bold text-foreground-strong">
        {botPaused ? "Bot is PAUSED" : idle ? "Bot is not connected" : "Bot is responding"}
      </span>
      <span className="text-xs text-foreground/55 font-serif italic flex-1 truncate">
        {botPaused
          ? "Silently ignoring every mention and DM."
          : idle
            ? "Add a Discord token to put it in your server — everything else already works."
            : "Replying to @mentions and DMs in connected channels."}
      </span>
      <span
        className={`text-[10px] uppercase tracking-widest font-bold ${
          botPaused ? "text-crimson-300" : idle ? "text-white/30" : "text-green-300"
        }`}
      >
        {toggling ? "…" : botPaused ? "Resume" : "Pause"}
      </span>
    </motion.button>
  );
}
