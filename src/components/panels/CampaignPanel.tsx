// Campaign Management — clarifications, lore gaps, and system logs in one
// inner-tabbed section. Extracted from App.tsx; row-edit state and the API
// mutations live here now, with refetch callbacks to keep the parent's
// counts honest.
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { BookOpen, Zap as ZapIcon, AlertCircle, Trash2, RefreshCw } from "lucide-react";
import { CardCorners } from "../TtrpgIcons";

export interface Clarification {
  id: string;
  question: string;
  answer: string;
  timestamp: string;
  embedded?: boolean;
}

export interface LoreGap {
  id: string;
  question: string;
  timestamp: string;
  status: string;
}

export type CampaignTab = "clarifications" | "gaps" | "logs";

interface Props {
  clarifications: Clarification[];
  loreGaps: LoreGap[];
  logs: string[];
  activeTab: CampaignTab;
  setActiveTab: (t: CampaignTab) => void;
  refetchClarifications: () => void;
  refetchLoreGaps: () => void;
  refetchLogs: () => void;
}

export function CampaignPanel({
  clarifications,
  loreGaps,
  logs,
  activeTab,
  setActiveTab,
  refetchClarifications,
  refetchLoreGaps,
  refetchLogs,
}: Props) {
  const [resolvingGap, setResolvingGap] = useState<string | null>(null);
  const [gapAnswer, setGapAnswer] = useState("");
  // In-place edit state — one row per card at a time.
  const [editingClarificationId, setEditingClarificationId] = useState<string | null>(null);
  const [editingClarificationQuestion, setEditingClarificationQuestion] = useState("");
  const [editingClarificationAnswer, setEditingClarificationAnswer] = useState("");
  const [editingGapId, setEditingGapId] = useState<string | null>(null);
  const [editingGapQuestion, setEditingGapQuestion] = useState("");

  const resolveGap = async (id: string) => {
    if (!gapAnswer.trim()) return;
    try {
      const res = await fetch("/api/lore-gaps/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, answer: gapAnswer }),
      });
      if (res.ok) {
        setGapAnswer("");
        setResolvingGap(null);
        refetchLoreGaps();
        refetchClarifications();
      }
    } catch (err) {
      console.error("Failed to resolve gap", err);
    }
  };

  const deleteGap = async (id: string) => {
    try {
      const res = await fetch(`/api/lore-gaps/${id}`, { method: "DELETE" });
      if (res.ok) refetchLoreGaps();
    } catch (err) {
      console.error("Delete gap failed", err);
    }
  };

  const deleteClarification = async (id: string) => {
    try {
      const res = await fetch(`/api/clarifications/${id}`, { method: "DELETE" });
      if (res.ok) refetchClarifications();
    } catch (err) {
      console.error("Delete clarification failed", err);
    }
  };

  const saveClarificationEdit = async (id: string, question: string, answer: string) => {
    try {
      const res = await fetch("/api/clarifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, question, answer }),
      });
      if (res.ok) {
        setEditingClarificationId(null);
        refetchClarifications();
      }
    } catch (err) {
      console.error("Edit clarification failed", err);
    }
  };

  const saveGapEdit = async (id: string, question: string) => {
    try {
      const res = await fetch(`/api/lore-gaps/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (res.ok) {
        setEditingGapId(null);
        refetchLoreGaps();
      }
    } catch (err) {
      console.error("Edit gap failed", err);
    }
  };

  const clearLogs = async () => {
    if (!confirm("Clear all system logs? The on-disk log file at Tusks-Lore/logs/ will be truncated.")) return;
    try {
      const res = await fetch("/api/logs", { method: "DELETE" });
      if (res.ok) refetchLogs();
    } catch (err) {
      console.error("Clear logs failed", err);
    }
  };

  return (
    <section id="campaign-section" className="scriptorium-card relative rounded-2xl p-6 md:p-8 parchment">
      <CardCorners />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex min-w-0 items-center gap-4">
          <div className="w-12 h-12 shrink-0 rounded-2xl bg-verdigris-400/20 flex items-center justify-center text-verdigris-400">
            <BookOpen size={24} />
          </div>
          <div>
            <h2 className="font-display text-3xl font-bold tracking-wide text-gold-300">Campaign Management</h2>
            <p className="text-white/40 text-sm">
              Review clarifications, unanswered lore gaps, and system logs. Source documents now live in the{" "}
              <strong>Lore</strong> tab.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 bg-black/40 p-1 rounded-xl border border-white/10">
          {(["clarifications", "gaps", "logs"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize whitespace-nowrap ${activeTab === tab ? "bg-gold-500 text-ink-950" : "text-white/40 hover:text-white/60"}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === "clarifications" && (
          <motion.div key="clarifications" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
            <h3 className="text-xl font-bold mb-6">Recorded Clarifications</h3>
            <div className="space-y-4">
              {clarifications.length === 0 ? (
                <div className="py-12 text-center border-2 border-dashed border-white/5 rounded-3xl">
                  <p className="text-white/20">No clarifications recorded yet.</p>
                </div>
              ) : (
                clarifications.map(c => {
                  const isEditing = editingClarificationId === c.id;
                  return (
                    <div key={c.id} className="p-6 rounded-2xl bg-white/5 border border-white/10">
                      <div className="flex justify-between items-start mb-2 gap-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-gold-400 font-bold text-sm uppercase tracking-wider">Question</p>
                          {c.embedded ? (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-verdigris-400/20 text-verdigris-400 flex items-center gap-1">
                              <ZapIcon size={10} /> embedded
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-yellow-500/20 text-yellow-300 flex items-center gap-1">
                              <AlertCircle size={10} /> not embedded
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!isEditing && (
                            <button
                              onClick={() => {
                                setEditingClarificationId(c.id);
                                setEditingClarificationQuestion(c.question);
                                setEditingClarificationAnswer(c.answer);
                              }}
                              className="px-3 py-1.5 text-xs font-bold text-gold-300 hover:text-gold-200 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                            >
                              Edit
                            </button>
                          )}
                          <button
                            onClick={() => deleteClarification(c.id)}
                            className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
                            title="Delete clarification"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="space-y-3">
                          <textarea
                            value={editingClarificationQuestion}
                            onChange={e => setEditingClarificationQuestion(e.target.value)}
                            placeholder="Question"
                            className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-gold-400/60 font-medium"
                          />
                          <p className="text-gold-400 font-bold text-sm uppercase tracking-wider">Answer</p>
                          <textarea
                            value={editingClarificationAnswer}
                            onChange={e => setEditingClarificationAnswer(e.target.value)}
                            placeholder="Answer"
                            className="w-full h-32 bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white/80 focus:outline-none focus:border-gold-400/60"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveClarificationEdit(c.id, editingClarificationQuestion.trim(), editingClarificationAnswer.trim())}
                              disabled={!editingClarificationQuestion.trim() || !editingClarificationAnswer.trim()}
                              className="px-4 py-2 bg-gold-500 hover:bg-gold-400 disabled:opacity-40 text-ink-950 rounded-lg text-xs font-bold transition-all"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingClarificationId(null)}
                              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-white font-medium mb-4">{c.question}</p>
                          <p className="text-gold-400 font-bold text-sm uppercase tracking-wider mb-2">Answer</p>
                          <p className="text-white/70 text-sm leading-relaxed">{c.answer}</p>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}

        {activeTab === "gaps" && (
          <motion.div key="gaps" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
            <h3 className="text-xl font-bold mb-6">Lore Gaps</h3>
            <div className="space-y-4">
              {loreGaps.length === 0 ? (
                <div className="py-12 text-center border-2 border-dashed border-white/5 rounded-3xl">
                  <p className="text-white/20">No lore gaps detected.</p>
                </div>
              ) : (
                loreGaps.map(g => {
                  const isEditing = editingGapId === g.id;
                  return (
                    <div key={g.id} className="p-6 rounded-2xl bg-white/5 border border-white/10">
                      <div className="flex justify-between items-start mb-4 gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-yellow-400 font-bold text-sm uppercase tracking-wider mb-1">Unanswered Question</p>
                          {isEditing ? (
                            <textarea
                              value={editingGapQuestion}
                              onChange={e => setEditingGapQuestion(e.target.value)}
                              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-gold-400/60 font-medium"
                            />
                          ) : (
                            <p className="text-white font-medium">{g.question}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!isEditing && (
                            <button
                              onClick={() => {
                                setEditingGapId(g.id);
                                setEditingGapQuestion(g.question);
                              }}
                              className="px-3 py-1.5 text-xs font-bold text-gold-300 hover:text-gold-200 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                            >
                              Edit
                            </button>
                          )}
                          <button
                            onClick={() => deleteGap(g.id)}
                            className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
                            title="Delete gap"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveGapEdit(g.id, editingGapQuestion.trim())}
                            disabled={!editingGapQuestion.trim()}
                            className="px-4 py-2 bg-gold-500 hover:bg-gold-400 disabled:opacity-40 text-ink-950 rounded-lg text-xs font-bold transition-all"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingGapId(null)}
                            className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold transition-all"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : resolvingGap === g.id ? (
                        <div className="space-y-3">
                          <textarea
                            value={gapAnswer}
                            onChange={e => setGapAnswer(e.target.value)}
                            placeholder="Provide the lore detail here..."
                            className="w-full h-32 bg-black/40 border border-white/10 rounded-xl p-4 text-sm text-white/80 focus:outline-none focus:border-gold-400/60"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => resolveGap(g.id)}
                              className="px-4 py-2 bg-gold-500 hover:bg-gold-400 text-ink-950 rounded-lg text-xs font-bold transition-all"
                            >
                              Save Clarification
                            </button>
                            <button
                              onClick={() => setResolvingGap(null)}
                              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setResolvingGap(g.id)}
                          className="w-full py-3 border border-dashed border-white/10 rounded-xl text-xs font-bold text-white/40 hover:text-white/60 hover:border-white/20 transition-all"
                        >
                          Click to provide clarification
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}

        {activeTab === "logs" && (
          <motion.div key="logs" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-bold">System Logs</h3>
                <p className="text-[11px] text-white/40 mt-0.5">
                  Persisted to <code className="font-mono">Tusks-Lore/logs/tusks-vault.log</code> — survives restarts.
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={refetchLogs} title="Refresh log buffer" className="p-2 text-white/40 hover:text-white transition-colors">
                  <RefreshCw size={16} />
                </button>
                <button
                  onClick={clearLogs}
                  title="Clear in-memory and on-disk logs"
                  className="px-3 py-1.5 text-xs font-bold text-white/60 hover:text-red-300 bg-white/5 hover:bg-red-500/10 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <Trash2 size={13} /> Clear logs
                </button>
              </div>
            </div>
            <div className="bg-black/40 border border-white/10 rounded-2xl p-6 font-mono text-xs leading-relaxed h-[500px] overflow-y-auto space-y-1">
              {logs.length === 0 ? (
                <p className="text-white/20">No logs available.</p>
              ) : (
                logs.map((log, i) => (
                  <div
                    key={i}
                    className={`py-1 border-b border-white/5 last:border-0 ${log.includes("[ERROR]") ? "text-red-400" : log.includes("[WARN]") ? "text-yellow-400" : "text-white/60"}`}
                  >
                    {log}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
