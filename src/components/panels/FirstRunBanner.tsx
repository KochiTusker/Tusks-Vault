// First-run onboarding banner — visible on Home until each of the three
// setup steps is satisfied. Extracted verbatim from App.tsx.
import { motion } from "motion/react";
import { CheckCircle2 } from "lucide-react";

interface Props {
  keyCount: number;
  discordConfigured: boolean;
  knowledgeCount: number;
  onAddKey: () => void;
  onOpenDiscord: () => void;
  onGoLore: () => void;
}

export function FirstRunBanner({
  keyCount,
  discordConfigured,
  knowledgeCount,
  onAddKey,
  onOpenDiscord,
  onGoLore,
}: Props) {
  return (
    <motion.section
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4 bg-gradient-to-r from-gold-500/[0.08] via-crimson-500/[0.06] to-gold-500/[0.08] border border-gold-400/30 rounded-2xl p-5 parchment"
    >
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gold-500/20 flex items-center justify-center text-gold-300 text-lg font-bold">
          📜
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold uppercase tracking-widest text-gold-300 mb-1">
            Welcome to Tusk's Vault
          </h3>
          <p className="text-sm text-white/70 mb-3">
            Three quick steps to get Tusk into your campaign. Nothing here requires editing config
            files — everything saves locally and persists across reboots.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <button
              onClick={onAddKey}
              className={`text-left p-3 rounded-xl border text-xs transition-all ${keyCount > 0 ? "bg-green-500/10 border-green-500/30 text-green-200" : "bg-white/5 border-white/10 hover:border-gold-400/40 text-white/80"}`}
            >
              <div className="flex items-center gap-2 mb-1">
                {keyCount > 0 ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <span className="w-4 h-4 rounded-full bg-white/10 text-[9px] flex items-center justify-center font-bold">1</span>
                )}
                <strong>Add an LLM key</strong>
              </div>
              <span className="opacity-70">
                {keyCount > 0
                  ? `${keyCount} key${keyCount === 1 ? "" : "s"} configured`
                  : "OpenRouter, Gemini, Claude Code, or Ollama"}
              </span>
            </button>

            <button
              onClick={onOpenDiscord}
              className={`text-left p-3 rounded-xl border text-xs transition-all ${discordConfigured ? "bg-green-500/10 border-green-500/30 text-green-200" : "bg-white/5 border-white/10 hover:border-gold-400/40 text-white/80"}`}
            >
              <div className="flex items-center gap-2 mb-1">
                {discordConfigured ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <span className="w-4 h-4 rounded-full bg-white/10 text-[9px] flex items-center justify-center font-bold">2</span>
                )}
                <strong>Connect Discord</strong>
              </div>
              <span className="opacity-70">
                {discordConfigured ? "Bot token saved" : "Guided setup, generated invite URL"}
              </span>
            </button>

            <button
              onClick={onGoLore}
              className={`text-left p-3 rounded-xl border text-xs transition-all ${knowledgeCount > 0 ? "bg-green-500/10 border-green-500/30 text-green-200" : "bg-white/5 border-white/10 hover:border-gold-400/40 text-white/80"}`}
            >
              <div className="flex items-center gap-2 mb-1">
                {knowledgeCount > 0 ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <span className="w-4 h-4 rounded-full bg-white/10 text-[9px] flex items-center justify-center font-bold">3</span>
                )}
                <strong>Upload lore documents</strong>
              </div>
              <span className="opacity-70">
                {knowledgeCount > 0
                  ? `${knowledgeCount} document${knowledgeCount === 1 ? "" : "s"} loaded`
                  : "PDFs, DOCX, TXT, MD, JSON"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
