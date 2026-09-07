// Active Provider — cascading provider → model dropdowns, plus the persona
// voice column. Selection side effects stay with the parent via callbacks.
import { Zap as ZapIcon, Info, CheckCircle2, Drama } from "lucide-react";
import { FlameLoader } from "../FlameLoader";
import { CardCorners } from "../TtrpgIcons";
import type { PersonaRow } from "../../hooks/usePersonas";
import type { LlmProvider, KeyTier, StoredKey } from "../../types/keys";
import { ModelPicker } from "./ModelPicker";

// Two shapes of connection. A "key" slot is offered once the user has
// stored a key for that {provider, tier}. A "keyless" slot is offered once
// the server reports the thing is actually reachable — Ollama answering on
// its port, the Claude Code CLI being on PATH. Neither is a module to opt
// into: they are live connection questions, and the picker asks them.
/** What the last probe found for a model. "unverified" is a real third
 *  state: nobody has checked, which is neither a promise nor a warning. */
export type Verification = "verified" | "unavailable" | "unverified";

export interface AvailableModel {
  id: string;
  displayName: string;
  verification?: Verification;
  verificationReason?: string;
  /** Set by /api/models when the resolved key is Gemini's free-tier slot and
   *  this is a Pro model: advertised by Google, refused on the call. Distinct
   *  from `verification` because it is a rule, not something a probe found. */
  needsPaidKey?: boolean;
}

/** Hover copy for a Pro row locked behind billing. One string, because the
 *  option label has room for the verdict but not for the reason. */
const PAID_KEY_HINT =
  "Google removed Pro from the API free tier. This key's quota for it is zero, so a question would get no answer. Enable billing on the key, or add it under Gemini · Paid tier in Settings.";

export type KeylessProvider = Extract<LlmProvider, "ollama" | "claudeCode">;
export type ProviderSlot =
  | { id: string; kind: "key"; provider: Extract<LlmProvider, "gemini" | "openrouter">; tier: KeyTier; label: string; hint: string }
  | { id: string; kind: "keyless"; provider: KeylessProvider; label: string; hint: string };

interface Props {
  slots: ProviderSlot[];
  keys: StoredKey[];
  activeKey: StoredKey | null;
  provider: LlmProvider;
  proModel: string;
  availableModels: AvailableModel[];
  modelsLoading: boolean;
  modelsReason: string | null;
  /** ISO timestamp of the last probe for this connection, or null if never. */
  probedAt: string | null;
  probing: boolean;
  onProbe: () => void;
  /** Provider id → reachable, from /api/providers. Gates the keyless slots. */
  keylessReachable: Record<string, boolean>;
  personas: PersonaRow[];
  activePersonaId: string;
  personaBusy: string | null;
  savingSettings: boolean;
  saveSuccess: boolean;
  modelCostHint: (provider: LlmProvider, modelId: string) => string;
  onPickProvider: (slotId: string) => void;
  onPickModel: (modelId: string) => void;
  onPickPersona: (personaId: string) => void;
  onRetryModels: () => void;
  onGoSettings: () => void;
  onShowOllamaInfo: () => void;
}

export function ActiveProviderPanel({
  slots,
  keys,
  activeKey,
  provider,
  proModel,
  availableModels,
  modelsLoading,
  modelsReason,
  probedAt,
  probing,
  onProbe,
  keylessReachable,
  personas,
  activePersonaId,
  personaBusy,
  savingSettings,
  saveSuccess,
  modelCostHint,
  onPickProvider,
  onPickModel,
  onPickPersona,
  onRetryModels,
  onGoSettings,
  onShowOllamaInfo,
}: Props) {
  // Unconfigured slots are hidden entirely rather than greyed out — add the
  // key in Settings, or start the local runtime, and the option appears here
  // automatically.
  const availableSlots = slots.filter(slot => {
    if (slot.kind === "keyless") return keylessReachable[slot.provider] === true;
    return keys.some(k => k.provider === slot.provider && k.tier === slot.tier);
  });

  const currentSlotId = activeKey
    ? `${activeKey.provider}:${activeKey.tier}`
    : provider === "ollama" || provider === "claudeCode"
      ? provider
      : "";
  const hasActiveProvider = currentSlotId !== "";

  const activePersona = personas.find(p => p.id === activePersonaId);

  // A catalogue entry is an advertisement; a probe is evidence. Counting them
  // separately is what lets the line below say which it is showing.
  const verifiedCount = availableModels.filter(m => m.verification === "verified").length;

  // Models the probe has PROVEN this key cannot call are dropped rather than
  // listed-and-disabled. Google advertises the same ids to a free-tier key
  // and a billing-enabled one — the refusal only arrives on the call — so an
  // unfiltered list is mostly paid-only entries on a free key, and reads as
  // "these are your options" when they are not.
  //
  // The currently-selected model is the exception and always survives: it may
  // be the very model that stopped working, and silently removing it would
  // hide both the choice the user made and the reason it now fails.
  const offeredModels = availableModels.filter(
    m => m.verification !== "unavailable" || m.id === proModel
  );
  const hiddenUnavailable = availableModels.length - offeredModels.length;

  // Paid-tier models are shown but not selectable, rather than hidden like a
  // probe-refused one. The Gemini list is a handful of entries, not four
  // hundred, and "Pro is missing" with no explanation reads as a bug — where
  // a locked row states the reason and the fix in the same breath.
  const lockedCount = offeredModels.filter(m => m.needsPaidKey).length;
  const callableCount = offeredModels.length - lockedCount;
  const selectionLocked = offeredModels.some(m => m.id === proModel && m.needsPaidKey);

  return (
    <section className="scriptorium-card relative rounded-2xl p-6 md:p-8 mb-4 parchment">
      <CardCorners />

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gold-500/20 flex items-center justify-center text-gold-400">
            <ZapIcon size={22} />
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold tracking-wide text-gold-300">Active Provider</h2>
            <p className="text-white/40 text-xs">
              Pick an API-key provider, then choose a text model the bot will call.
            </p>
          </div>
        </div>
        <button
          onClick={onShowOllamaInfo}
          className="self-start flex items-center gap-2 text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          <Info size={12} /> How does Ollama work?
        </button>
      </div>

      {availableSlots.every(s => s.kind === "keyless") && !hasActiveProvider ? (
        <div className="rounded-xl border border-yellow-400/30 bg-yellow-500/[0.06] p-4 text-sm">
          <p className="font-semibold text-yellow-200/90 mb-1">No cloud API key configured yet.</p>
          <p className="text-yellow-100/70 text-xs leading-relaxed">
            Add an OpenRouter or Gemini key in{" "}
            <button onClick={onGoSettings} className="underline text-yellow-200">
              Settings → API Keys
            </button>
            , or pick a local option below.
          </p>
        </div>
      ) : null}

      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-white/40 uppercase tracking-widest font-bold ml-1">
            Provider · API Key
          </label>
          <select
            value={currentSlotId}
            onChange={e => onPickProvider(e.target.value)}
            className="bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-gold-400/60"
          >
            {!hasActiveProvider && <option value="">— select a provider —</option>}
            {availableSlots.map(slot => (
              <option key={slot.id} value={slot.id}>
                {slot.label}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-white/30 ml-1">
            {availableSlots.length <= 1
              ? "Add a cloud key in Settings → API Keys to unlock more options."
              : "Only providers with a saved API key appear here."}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-white/40 uppercase tracking-widest font-bold ml-1 flex items-center gap-1">
            Model
            {modelsLoading && <FlameLoader size={10} />}
          </label>
          {!hasActiveProvider ? (
            <select disabled className="bg-black/20 border border-white/5 rounded-xl px-3 py-2.5 text-sm text-white/30 cursor-not-allowed">
              <option>Select a provider first…</option>
            </select>
          ) : modelsLoading ? (
            <select disabled className="bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white/50 font-mono">
              <option>Loading models…</option>
            </select>
          ) : offeredModels.length === 0 ? (
            // Distinguishes "the list came back empty" from "everything in it
            // was probed and refused" — the second is a tier problem, and
            // saying so is the difference between a fixable answer and a
            // shrug.
            <select disabled className="bg-black/40 border border-red-400/30 rounded-xl px-3 py-2.5 text-sm text-red-300/80 font-mono">
              <option>
                {availableModels.length === 0
                  ? "No models reachable from this key"
                  : `All ${availableModels.length} advertised models were refused by this key`}
              </option>
            </select>
          ) : provider === "openrouter" ? (
            // OpenRouter alone needs a browser rather than a list: a native
            // select of 400+ flat entries with no prices is unusable, and
            // price is what decides the pick. Every other provider offers a
            // handful of models, where a select is the better control.
            <ModelPicker value={proModel} availableModels={availableModels} onPick={onPickModel} />
          ) : (
            <select
              value={proModel}
              onChange={e => onPickModel(e.target.value)}
              className="bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-gold-400/60 font-mono"
            >
              {!availableModels.some(m => m.id === proModel) && proModel && (
                <option value={proModel}>{proModel} (saved · re-pick to refresh)</option>
              )}
              {offeredModels.map(m => {
                const hint = modelCostHint(provider, m.id);
                // Only reachable here as the still-selected model (see
                // offeredModels): kept, marked and disabled, so the reason it
                // stopped working is visible instead of it just vanishing.
                const bad = m.verification === "unavailable";
                // Google advertises Pro to a free key and refuses the call,
                // so it is disabled rather than absent — the label carries
                // the fix, which "it vanished" does not. A probe verdict
                // outranks the rule in both directions: `verified` clears
                // needsPaidKey server-side, and an `unavailable` verdict
                // already carries Google's own specific reason, which beats
                // a generic one.
                const locked = !bad && m.needsPaidKey === true;
                return (
                  <option
                    key={m.id}
                    value={m.id}
                    disabled={bad || locked}
                    title={locked ? PAID_KEY_HINT : m.verificationReason}
                  >
                    {m.verification === "verified" ? "✓ " : bad ? "✕ " : locked ? "🔒 " : ""}
                    {hint ? `${hint} · ` : ""}
                    {m.displayName === m.id ? m.id : `${m.displayName} — ${m.id}`}
                    {bad && m.verificationReason ? ` — ${m.verificationReason}` : ""}
                    {locked ? " — needs a paid Gemini key" : ""}
                  </option>
                );
              })}
            </select>
          )}
          <p className="text-[10px] text-white/30 ml-1">
            {!hasActiveProvider ? (
              "Provider locks in first; the model list is pulled from its API."
            ) : availableModels.length > 0 ? (
              <>
                {callableCount} model
                {callableCount === 1 ? "" : "s"} you can call
                {verifiedCount > 0 && <> · {verifiedCount} verified</>}
                {lockedCount > 0 && (
                  <>
                    {" "}
                    · {lockedCount} Pro
                    <span className="text-white/20"> (paid key only)</span>
                  </>
                )}
                {hiddenUnavailable > 0 && (
                  <>
                    {" "}
                    · {hiddenUnavailable} hidden
                    <span className="text-white/20"> (this key can't call them)</span>
                  </>
                )}
                {". "}
                <button onClick={onProbe} disabled={probing} className="underline text-gold-300 disabled:opacity-50">
                  {probing ? "Testing…" : probedAt ? "Re-test" : "Test which work"}
                </button>
                {probedAt && (
                  <span className="text-white/20"> · last tested {new Date(probedAt).toLocaleString()}</span>
                )}
              </>
            ) : modelsReason ? (
              <>
                Couldn't load: {modelsReason}{" "}
                <button onClick={onRetryModels} className="underline text-gold-300">
                  Retry
                </button>
              </>
            ) : (
              "—"
            )}
          </p>
          {/* The saved model can predate the key it is now paired with — a
              user who selected Pro and later switched to the free slot has a
              config that answers nothing. The disabled option says so, but a
              closed select is easy to skim past. */}
          {selectionLocked && (
            <p className="text-[10px] text-amber-300/80 ml-1 leading-snug">
              {proModel} needs a paid Gemini key. Questions will fail until you pick a Flash model,
              or enable billing on this key and re-run “Test which work”.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-white/40 uppercase tracking-widest font-bold ml-1 flex items-center gap-1">
            <Drama size={11} className="text-verdigris-400" /> Persona · Voice
          </label>
          <select
            value={activePersonaId}
            onChange={e => onPickPersona(e.target.value)}
            disabled={!!personaBusy}
            className="bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-verdigris-400/60 disabled:opacity-60"
          >
            {personas.length === 0 && <option value="">Loading personas…</option>}
            {personas.filter(p => p.builtin).length > 0 && (
              <optgroup label="Built-in presets">
                {personas
                  .filter(p => p.builtin)
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            )}
            {personas.filter(p => !p.builtin).length > 0 && (
              <optgroup label="Your personas">
                {personas
                  .filter(p => !p.builtin)
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
          <p className="text-[10px] text-white/30 ml-1 leading-snug">
            {activePersona
              ? activePersona.description || "Active voice for all Discord replies."
              : "Pick a voice. Manage / author personas in Settings → Personas."}
          </p>
        </div>
      </div>

      {(savingSettings || saveSuccess) && (
        <div className="flex items-center gap-2 text-[11px] text-white/50">
          {savingSettings ? (
            <>
              <FlameLoader size={12} /> Saving model selection…
            </>
          ) : (
            <>
              <CheckCircle2 size={12} className="text-green-400" /> Saved.
            </>
          )}
        </div>
      )}
    </section>
  );
}
