import { CheckCircle2, Drama, FilePlus2, Pencil, Save, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { FlameLoader } from "../FlameLoader";
import type { UsePersonasApi } from "../../hooks/usePersonas";

interface Props {
  /** Bundle returned by usePersonas(). All state + actions flow through this. */
  api: UsePersonasApi;
}

/**
 * Settings → Personas card. The dropdown on the Home tab is the primary fast
 * switcher; this card is the editor surface: list, customise a preset,
 * author new ones (template / scratch / AI-generate), delete user personas.
 * Presets are read-only (their `builtin` flag is true) so they can be
 * cloned but not edited in place.
 *
 * Personas ship with the app — there is nothing to install and therefore
 * nothing to gate on. "No persona" is simply not selecting one.
 */
export function PersonasPanel({ api }: Props) {
  const {
    personas,
    activePersonaId,
    busy,
    editor,
    setEditor,
    saving,
    genPrompt,
    setGenPrompt,
    generating,
    genError,
    setActiveOnServer,
    save,
    remove,
    clone,
    generate,
    openEditor,
  } = api;

  const activePersona = personas.find(p => p.id === activePersonaId);
  const presetRows = personas.filter(p => p.builtin);
  const userRows = personas.filter(p => !p.builtin);

  return (
    <div className="bg-black/30 border border-white/5 rounded-2xl p-6 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Drama size={16} className="text-verdigris-400" />
        <h3 className="text-sm font-bold uppercase tracking-widest text-white/70">Personas</h3>
        {activePersona && (
          <span className="ml-2 rounded bg-gold-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gold-200">
            Active: {activePersona.name}
          </span>
        )}
      </div>
      <p className="text-xs text-white/40 mb-4 leading-relaxed">
        Swap the bot's voice without touching the system prompt below. The active persona's prompt replaces the System Instruction at chat time. Citations and lore-gap rules stay intact across every persona.
      </p>

      {/* Preset row — six character cards plus the default Chronicler.
          Click "Use" to make it active, "Customise" to fork into a
          user-editable copy. */}
      <div className="mb-5">
        <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold mb-2">Built-in presets</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {presetRows.map(p => {
            const isActive = p.id === activePersonaId;
            const isBusy = busy === p.id;
            return (
              <div
                key={p.id}
                className={`rounded-md border p-3 transition-colors ${isActive ? 'border-gold-400/50 bg-gold-500/[0.08]' : 'border-white/10 bg-black/20 hover:border-white/20'}`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="font-medium text-sm text-white flex items-center gap-1.5">
                    {isActive && <CheckCircle2 size={12} className="text-gold-300 flex-shrink-0" />}
                    <span>{p.name}</span>
                  </div>
                </div>
                <p className="text-[11px] text-white/55 leading-snug mb-2 min-h-[2.5em]">{p.description}</p>
                <div className="flex items-center gap-1">
                  {!isActive && (
                    <button
                      onClick={() => setActiveOnServer(p.id)}
                      disabled={isBusy}
                      className="flex-1 px-2 py-1 bg-gold-500/80 hover:bg-gold-400 text-ink-950 disabled:opacity-40 rounded text-[11px] font-bold transition-colors"
                    >
                      Use
                    </button>
                  )}
                  <button
                    onClick={() => clone(p.id)}
                    disabled={isBusy}
                    className="flex-1 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 rounded text-[11px] font-bold text-white/70 transition-colors"
                    title="Make an editable copy of this preset"
                  >
                    Customise
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* User-authored row */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold">Your personas</p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => openEditor("template")}
              className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[11px] font-bold text-white/70 transition-colors"
              title="Start from the canonical Chronicler template"
            >
              <FilePlus2 size={11} /> From template
            </button>
            <button
              onClick={() => openEditor("scratch")}
              className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[11px] font-bold text-white/70 transition-colors"
              title="Open an empty editor"
            >
              <Pencil size={11} /> From scratch
            </button>
          </div>
        </div>
        {userRows.length === 0 ? (
          <p className="text-[11px] text-white/40 italic py-3">No custom personas yet. Customise a preset above, paste a prompt from scratch, or describe one below for the AI to draft.</p>
        ) : (
          <div className="space-y-2">
            {userRows.map(p => {
              const isActive = p.id === activePersonaId;
              const isBusy = busy === p.id;
              return (
                <div
                  key={p.id}
                  className={`flex items-start justify-between gap-3 p-3 rounded-md text-sm border ${isActive ? 'bg-gold-500/10 border-gold-400/40' : 'bg-black/30 border-white/5'}`}
                >
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                      <span>{p.name}</span>
                      {isActive && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-gold-500/30 text-gold-200">active</span>
                      )}
                    </div>
                    {p.description && (
                      <div className="text-[11px] text-white/50 leading-snug">{p.description}</div>
                    )}
                    <div className="text-[10px] text-white/30 font-mono">
                      {p.prompt.length.toLocaleString()} chars
                      {p.updatedAt ? ` · updated ${new Date(p.updatedAt).toLocaleDateString()}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!isActive && (
                      <button
                        onClick={() => setActiveOnServer(p.id)}
                        disabled={isBusy}
                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 rounded-lg text-xs font-bold"
                      >
                        Use
                      </button>
                    )}
                    <button
                      onClick={() => openEditor("edit", p)}
                      className="p-1.5 text-white/60 hover:text-white transition-colors"
                      title="Edit"
                      aria-label={`Edit persona ${p.name}`}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => remove(p.id, p.name)}
                      className="p-1.5 text-white/30 hover:text-red-400 transition-colors"
                      title="Delete"
                      aria-label={`Delete persona ${p.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* AI-generate flow. Uses the user's active provider+tier — same
          key the Discord bot uses. The generated draft drops into the
          editor; the user reviews + clicks Save before it's persisted. */}
      <div className="mb-4 rounded-md bg-verdigris-400/[0.04] border border-verdigris-400/20 p-3">
        <p className="flex items-center gap-1.5 text-[10px] text-verdigris-200 uppercase tracking-widest font-bold mb-2">
          <Sparkles size={11} /> Generate from a description
        </p>
        <p className="text-[11px] text-white/50 mb-2 leading-relaxed">
          Describe the persona in a sentence — your active LLM drafts a full prompt against the canonical template. You can edit before saving.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.target.value)}
            placeholder="e.g. a no-nonsense Yorkshire farmer who's seen it all"
            maxLength={400}
            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-verdigris-400/60"
          />
          <button
            onClick={generate}
            disabled={generating || !genPrompt.trim()}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-verdigris-400 hover:bg-verdigris-300 text-ink-950 disabled:opacity-40 rounded-lg text-xs font-bold transition-colors"
          >
            {generating ? <FlameLoader size={12} /> : <Wand2 size={12} />}
            {generating ? "Drafting…" : "Generate"}
          </button>
        </div>
        {genError && (
          <p className="mt-2 text-[11px] text-red-300/80 leading-snug">{genError}</p>
        )}
      </div>

      {/* Editor panel. Inline rather than modal so the user can see
          the persona list while writing. */}
      {editor && (
        <div className="rounded-md border border-gold-400/30 bg-black/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-display tracking-wider uppercase text-sm text-gold-200">
              {editor.mode === "edit" ? "Edit persona" : "New persona"}
            </h4>
            <button
              onClick={() => setEditor(null)}
              className="p-1 text-white/40 hover:text-white/80 transition-colors"
              title="Close editor"
              aria-label="Close persona editor"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-white/40 uppercase tracking-widest font-bold ml-1">Name</label>
              <input
                value={editor.name}
                onChange={(e) => setEditor(prev => prev ? { ...prev, name: e.target.value } : prev)}
                placeholder="e.g. Stoic Knight"
                maxLength={60}
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-400/60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-white/40 uppercase tracking-widest font-bold ml-1">Description</label>
              <input
                value={editor.description}
                onChange={(e) => setEditor(prev => prev ? { ...prev, description: e.target.value } : prev)}
                placeholder="One-line summary for the dropdown."
                maxLength={140}
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-400/60"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-white/40 uppercase tracking-widest font-bold ml-1">Prompt</label>
              <span className="text-[10px] text-white/30">
                {editor.prompt.length.toLocaleString()} chars · use {"{{BOT_NAME}}"} for the bot's name
              </span>
            </div>
            <textarea
              value={editor.prompt}
              onChange={(e) => setEditor(prev => prev ? { ...prev, prompt: e.target.value } : prev)}
              placeholder="The full system prompt. Keep the seven core rules verbatim — they're what makes citation work."
              className="w-full h-72 bg-black/40 border border-white/10 rounded-lg p-3 text-white/80 focus:outline-none focus:border-gold-400/60 transition-all resize-none font-mono text-[12px] leading-relaxed"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setEditor(null)}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold text-white/70 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !editor.name.trim() || !editor.prompt.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-gold-500 hover:bg-gold-400 text-ink-950 disabled:opacity-40 rounded-lg text-xs font-bold transition-colors"
            >
              {saving ? <FlameLoader size={12} /> : <Save size={12} />}
              {saving ? "Saving…" : (editor.mode === "edit" ? "Save changes" : "Save persona")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
