// Guardrails — collapsed summary card + configuration modal. Defaults are
// all-off so the bot recounts source material faithfully on a fresh
// install. Mapping across providers (documented in prompt/system.ts):
// Gemini honours the toggles via API safetySettings; Claude/OpenAI receive
// an appended system-prompt nudge because their APIs don't expose
// per-category safety knobs. Extracted verbatim from App.tsx; the modal
// open/close state now lives here.
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ShieldQuestion, ExternalLink, X, Info, Save } from "lucide-react";
import { FlameLoader } from "../FlameLoader";
import { CardCorners } from "../TtrpgIcons";

export type GuardrailFlags = {
  harassment: boolean;
  hate: boolean;
  sexual: boolean;
  dangerous: boolean;
};

interface Props {
  guardrails: GuardrailFlags;
  setGuardrails: React.Dispatch<React.SetStateAction<GuardrailFlags>>;
  saving: boolean;
  /** Persists the given flags; resolves when the POST completes. The parent
   *  closes nothing — this panel owns its modal. */
  onSave: (next: GuardrailFlags) => Promise<boolean>;
}

export function GuardrailsPanel({ guardrails, setGuardrails, saving, onSave }: Props) {
  const [showModal, setShowModal] = useState(false);

  const activeCount =
    (guardrails.harassment ? 1 : 0) +
    (guardrails.hate ? 1 : 0) +
    (guardrails.sexual ? 1 : 0) +
    (guardrails.dangerous ? 1 : 0);
  const allOn = activeCount === 4;
  const summary =
    activeCount === 0
      ? "All guardrails off — bot recounts source material faithfully."
      : allOn
        ? "All 4 guardrails active — bot will sanitise restricted content."
        : `${activeCount}/4 guardrails active — ${[
            guardrails.harassment && "Harassment",
            guardrails.hate && "Hate",
            guardrails.sexual && "Sexual",
            guardrails.dangerous && "Dangerous",
          ]
            .filter(Boolean)
            .join(" · ")}.`;

  const save = async () => {
    const ok = await onSave(guardrails);
    if (ok) setShowModal(false);
  };

  return (
    <>
      <section className="scriptorium-card relative rounded-2xl p-4 mb-4 parchment">
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="w-full flex items-center justify-between gap-4 text-left group"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${activeCount > 0 ? "bg-crimson-500/20 text-crimson-300" : "bg-white/5 text-white/40"}`}
            >
              <ShieldQuestion size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display text-base font-bold tracking-wide text-gold-200">Guardrails</h3>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${activeCount === 0 ? "bg-white/5 text-white/50" : "bg-crimson-500/20 text-crimson-200"}`}
                >
                  {activeCount === 0 ? "off" : `${activeCount}/4 on`}
                </span>
              </div>
              <p className="text-[11px] text-white/50 leading-snug mt-0.5 truncate">{summary}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-white/40 group-hover:text-white/70 flex-shrink-0">
            Configure <ExternalLink size={12} />
          </div>
        </button>
      </section>

      <AnimatePresence>
        {showModal && (
          <motion.div
            key="guardrails-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              key="guardrails-modal"
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="scriptorium-card relative w-full max-w-lg rounded-2xl p-6 shadow-2xl parchment"
            >
              <CardCorners />
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-crimson-500/20 flex items-center justify-center text-crimson-300">
                    <ShieldQuestion size={20} />
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-bold tracking-wide text-gold-200">Guardrails</h3>
                    <p className="text-[11px] text-white/50 leading-snug">
                      Pick which content categories the bot should sanitise.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-1 text-white/40 hover:text-white/80 transition-colors"
                  title="Close"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/5">
                <button
                  onClick={() => setGuardrails({ harassment: true, hate: true, sexual: true, dangerous: true })}
                  className="flex-1 px-3 py-1.5 bg-crimson-500/15 hover:bg-crimson-500/25 border border-crimson-400/30 rounded-lg text-xs font-bold text-crimson-200 transition-colors"
                >
                  All on
                </button>
                <button
                  onClick={() => setGuardrails({ harassment: false, hate: false, sexual: false, dangerous: false })}
                  className="flex-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold text-white/70 transition-colors"
                >
                  All off
                </button>
              </div>

              <div className="space-y-2 mb-4">
                {(
                  [
                    { key: "harassment", label: "Harassment", desc: "Directed insults, threats, or harassment of individuals or groups." },
                    { key: "hate", label: "Hate speech", desc: "Slurs or hostility targeting protected characteristics." },
                    { key: "sexual", label: "Sexually explicit", desc: "Pornographic or sexually graphic material." },
                    { key: "dangerous", label: "Dangerous content", desc: "Material aiding the creation of weapons, drugs, or other dangerous goods." },
                  ] as Array<{ key: keyof GuardrailFlags; label: string; desc: string }>
                ).map(row => {
                  const on = guardrails[row.key];
                  return (
                    <div
                      key={row.key}
                      className={`flex items-start justify-between gap-3 p-3 rounded-lg border transition-colors ${on ? "bg-crimson-500/[0.06] border-crimson-400/30" : "bg-black/30 border-white/5"}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white">{row.label}</div>
                        <p className="text-[11px] text-white/50 leading-snug mt-0.5">{row.desc}</p>
                      </div>
                      <button
                        onClick={() => setGuardrails(prev => ({ ...prev, [row.key]: !prev[row.key] }))}
                        className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 mt-0.5 ${on ? "bg-crimson-500/70" : "bg-white/10"}`}
                        aria-pressed={on}
                        title={on ? "Toggle off" : "Toggle on"}
                      >
                        <motion.div animate={{ x: on ? 22 : 4 }} className="absolute top-1 w-5 h-5 bg-white rounded-full shadow" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mb-4 rounded-md bg-verdigris-400/[0.05] border border-verdigris-400/20 p-3 text-[11px] text-white/65 leading-relaxed">
                <p className="font-bold text-verdigris-200 mb-1 flex items-center gap-1.5">
                  <Info size={11} /> How this maps across providers
                </p>
                <p>
                  <strong className="text-white">Gemini</strong> honours these via Google's{" "}
                  <span className="font-mono text-white/80">safetySettings</span> API.
                </p>
                <p>
                  <strong className="text-white">Claude</strong> and <strong className="text-white">ChatGPT</strong>{" "}
                  don't expose per-category safety in their APIs — for those, an active toggle appends a
                  system-prompt instruction asking the model to apply its built-in safety guidance to that category.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold text-white/70 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 bg-gold-500 hover:bg-gold-400 text-ink-950 disabled:opacity-40 rounded-lg text-xs font-bold transition-colors"
                >
                  {saving ? <FlameLoader size={12} /> : <Save size={12} />}
                  {saving ? "Saving…" : "Save guardrails"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
