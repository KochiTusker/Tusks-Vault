import { AlertCircle, CheckCircle2, KeyRound, Plus, Save, ShieldQuestion, Trash2, X, Zap as ZapIcon } from "lucide-react";
import { FlameLoader } from "../FlameLoader";
import { KEY_SECTIONS, type KeyTier, type LlmProvider, type StoredKey, type TestResult } from "../../types/keys";

interface Props {
  keys: StoredKey[];
  activeKey: StoredKey | null;
  keyTestResults: Record<string, TestResult>;

  // Add-key form state (lifted in App.tsx so the inline form preserves
  // typed-in values when other parts of the app re-render).
  addKeyFor: string | null;
  setAddKeyFor: (v: string | null) => void;
  setNewKeyProvider: (p: LlmProvider) => void;
  setNewKeyTier: (t: KeyTier) => void;
  newKeyLabel: string;
  setNewKeyLabel: (v: string) => void;
  newKeyValue: string;
  setNewKeyValue: (v: string) => void;
  savingKey: boolean;

  // Actions
  testKey: (id: string) => void;
  submitNewKey: () => void;
  deleteStoredKey: (id: string) => void;
  selectChannel: (kind: "key" | "ollama" | "claudeCode", id?: string) => void;
}

/**
 * Settings → API Keys card. Layout mirrors Tusks-Tomes: one card,
 * provider-grouped sections with uppercase font-display headings,
 * per-slot bordered rows, and an inline expand-to-add form below the
 * section that opened it. Vault preserves its multi-key-per-provider data
 * model (Tomes only ever stores one slot per provider+tier).
 */
export function KeyVaultPanel(props: Props) {
  const {
    keys,
    activeKey,
    keyTestResults,
    addKeyFor,
    setAddKeyFor,
    setNewKeyProvider,
    setNewKeyTier,
    newKeyLabel,
    setNewKeyLabel,
    newKeyValue,
    setNewKeyValue,
    savingKey,
    testKey,
    submitNewKey,
    deleteStoredKey,
    selectChannel,
  } = props;

  // Keys for providers Vault no longer routes to. They match no section, so
  // without their own block they would be invisible — and a credential the
  // user can see but not delete is worse than one they never pasted.

  return (
    <div className="bg-black/30 border border-white/5 rounded-2xl p-6 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <KeyRound size={16} className="text-yellow-400" />
        <h3 className="text-sm font-bold uppercase tracking-widest text-white/70">API Keys</h3>
      </div>
      <p className="text-xs text-white/40 mb-5 leading-relaxed">
        Stored encrypted on this machine (AES-256-GCM, bound to this computer). They never leave your laptop.
      </p>

      <div className="space-y-5">
        {KEY_SECTIONS.map(section => {
          const slot = `${section.provider}:${section.tier}`;
          const sectionKeys = keys.filter(k => k.provider === section.provider && k.tier === section.tier);
          const isAdding = addKeyFor === slot;
          const isFreeTierSub = section.provider === "gemini" && section.tier === "free";

          return (
            <section key={slot} className={isFreeTierSub ? "ml-6 bg-white/[0.03] border border-white/5 rounded-xl p-3" : ""}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="space-y-0.5 flex-1 min-w-0">
                  <h4 className="font-display tracking-wider uppercase text-sm text-gold-200">{section.heading}</h4>
                  {section.description && (
                    <p className="text-[11px] text-white/45 leading-relaxed">{section.description}</p>
                  )}
                  <div className="flex items-center gap-1.5 text-[11px] text-white/50 pt-0.5">
                    {sectionKeys.length === 0 ? (
                      <><ShieldQuestion size={12} className="text-white/30" /> Not configured</>
                    ) : (
                      <><CheckCircle2 size={12} className="text-green-400" /> {sectionKeys.length} key{sectionKeys.length === 1 ? "" : "s"}</>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (isAdding) {
                      setAddKeyFor(null);
                    } else {
                      setNewKeyProvider(section.provider);
                      setNewKeyTier(section.tier);
                      setNewKeyLabel("");
                      setNewKeyValue("");
                      setAddKeyFor(slot);
                    }
                  }}
                  className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold transition-all"
                >
                  {isAdding ? <><X size={12} /> Cancel</> : <><Plus size={12} /> {sectionKeys.length === 0 ? "Add" : "Replace"}</>}
                </button>
              </div>

              {sectionKeys.length > 0 && (
                <div className="space-y-2">
                  {sectionKeys.map(k => {
                    const isActive = activeKey?.id === k.id;
                    const test = keyTestResults[k.id];
                    return (
                      <div
                        key={k.id}
                        className={`flex items-center justify-between gap-3 p-3 rounded-md text-sm border ${isActive ? 'bg-gold-500/10 border-gold-400/40' : 'bg-black/30 border-white/5'}`}
                      >
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                            <span>{k.label}</span>
                            {isActive && (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-gold-500/30 text-gold-200">active</span>
                            )}
                            {test?.status === "ok" && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-green-500/20 text-green-300" title={`Last test passed${test.modelCount != null ? ` · ${test.modelCount} models reachable` : ""}`}>
                                <CheckCircle2 size={10} /> tested
                              </span>
                            )}
                            {test?.status === "fail" && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-red-500/20 text-red-300" title={test.error || "Test failed"}>
                                <AlertCircle size={10} /> failed
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-white/30 font-mono">{k.maskedKey}</div>
                          {test?.status === "fail" && test.error && (
                            <p className="text-[10px] text-red-300/70 leading-snug max-w-md truncate" title={test.error}>{test.error}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => testKey(k.id)}
                            disabled={test?.status === "pending"}
                            className="flex items-center gap-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-50 rounded-lg text-xs font-bold border border-white/10"
                            title="Verify this key works by listing models"
                          >
                            {test?.status === "pending"
                              ? <FlameLoader size={12} />
                              : test?.status === "ok"
                                ? <CheckCircle2 size={12} className="text-green-400" />
                                : <ZapIcon size={12} />}
                            {test?.status === "pending" ? "Testing…" : "Test"}
                          </button>
                          {!isActive && (
                            <button
                              onClick={() => selectChannel('key', k.id)}
                              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold"
                            >
                              Use
                            </button>
                          )}
                          <button
                            onClick={() => deleteStoredKey(k.id)}
                            className="p-1.5 text-white/30 hover:text-red-400 transition-colors"
                            title="Delete this key"
                            aria-label={`Delete API key ${k.label}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {isAdding && (
                <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2 p-3 bg-black/40 rounded-xl border border-gold-400/25">
                  <div className="space-y-2">
                    <input
                      value={newKeyLabel}
                      onChange={(e) => setNewKeyLabel(e.target.value)}
                      placeholder={`Label (e.g. "${section.labelHint}")`}
                      className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/30"
                    />
                    <input
                      type="password"
                      value={newKeyValue}
                      onChange={(e) => setNewKeyValue(e.target.value)}
                      placeholder={section.keyPlaceholder}
                      className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/30 font-mono"
                    />
                  </div>
                  <button
                    onClick={submitNewKey}
                    disabled={savingKey || !newKeyValue.trim()}
                    className="flex items-center justify-center gap-1 px-4 py-2 bg-gold-500 hover:bg-gold-400 text-ink-950 disabled:opacity-40 rounded-lg text-xs font-bold transition-all"
                  >
                    {savingKey ? <FlameLoader size={12} /> : <Save size={12} />}
                    Save
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>

    </div>
  );
}
