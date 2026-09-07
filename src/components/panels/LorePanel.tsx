// Lore — source documents, the Tusks-Lore folder card, and the Tomes
// pairing card. Extracted from App.tsx; upload/delete/sync/create actions
// and their in-flight state live here, with refetch callbacks so the
// parent's counts stay honest.
import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { displayFileName } from "../../lib/loreFileName";
import { filterLoreFiles, groupLoreFiles } from "../../lib/loreTree";
import { motion } from "motion/react";
import {
  BookOpen,
  RefreshCw,
  Upload,
  FileText,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Info,
  Plus,
  ExternalLink,
  Search,
  FolderOpen,
  ChevronRight,
} from "lucide-react";
import { FlameLoader } from "../FlameLoader";
import { CardCorners } from "../TtrpgIcons";

export interface KnowledgeFile {
  name: string;
  size: number;
  createdAt: string;
  /** False when Vault cannot parse the file type. Optional so a dashboard
   *  tab left open across an upgrade still renders against an older payload. */
  indexed?: boolean;
}

export interface TusksLoreProbe {
  resolution: "env" | "settings" | "sibling" | "fallback";
  isExternal: boolean;
  loreRoot: string;
  loreRootExists: boolean;
  knowledgeDir: string;
  defaultSibling: string;
  defaultSiblingExists: boolean;
}

export interface TomesProbe {
  found: boolean;
  sessionsPath: string | null;
  repoPath?: string | null;
  campaignCount: number;
  chronicleCount: number;
  alreadyImported: number;
}

export interface TomesChronicle {
  campaign: string;
  filename: string;
  size: number;
  alreadyImported: boolean;
}

interface Props {
  knowledgeFiles: KnowledgeFile[];
  /** Rendered above the document list — the lore-source picker. Passed in as
   *  a slot rather than imported here so this panel keeps owning one concern
   *  (what lore is there) and not two (and where does it come from). */
  sourcePanel?: ReactNode;
  /** Set when an Obsidian vault is the live source. The document list below
   *  is then the VAULT's notes, so every "indexed from …" line has to name
   *  the vault — crediting the Tusks-Lore folder for notes that did not come
   *  from it is worse than saying nothing. */
  activeVaultPath?: string | null;
  clarificationCount: number;
  tusksLore: TusksLoreProbe | null;
  tomesProbe: TomesProbe | null;
  tomesChronicles: TomesChronicle[];
  refetchKnowledge: () => Promise<void> | void;
  refetchTusksLore: () => Promise<void> | void;
  refetchClarifications: () => Promise<void> | void;
  refetchTomesStatus: () => Promise<void> | void;
  onGoClarifications: () => void;
}

export function LorePanel({
  knowledgeFiles,
  sourcePanel,
  activeVaultPath,
  clarificationCount,
  tusksLore,
  tomesProbe,
  tomesChronicles,
  refetchKnowledge,
  refetchTusksLore,
  refetchClarifications,
  refetchTomesStatus,
  onGoClarifications,
}: Props) {
  // Set every time Refresh completes a fresh fetch of the file list +
  // Tusks-Lore probe + clarifications count — so the user can be CERTAIN
  // their disk-side edits have been re-read by the dashboard (the bot
  // itself re-reads on every message).
  const [lastScannedAt, setLastScannedAt] = useState<Date | null>(null);
  // A file Vault cannot parse is still listed — vanishing silently is worse —
  // but it is never counted as something the bot reads.
  const indexedCount = knowledgeFiles.filter(f => f.indexed !== false).length;
  const skippedCount = knowledgeFiles.length - indexedCount;
  const [uploading, setUploading] = useState(false);
  const [tusksLoreCreating, setTusksLoreCreating] = useState(false);
  const [tusksLoreCreateResult, setTusksLoreCreateResult] = useState<string | null>(null);
  const [tomesSyncing, setTomesSyncing] = useState(false);
  const [tomesSyncSummary, setTomesSyncSummary] = useState<string | null>(null);
  const [fileQuery, setFileQuery] = useState("");
  /** Folders the user has collapsed. Starts empty — a first visit shows the
   *  whole corpus, and hiding it behind closed folders would trade one
   *  navigation problem for another. */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  void fileInputRef;

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) formData.append("files", files[i]);
    try {
      const res = await fetch("/api/knowledge", { method: "POST", body: formData });
      if (res.ok) void refetchKnowledge();
    } catch (err) {
      console.error("Upload failed", err);
    } finally {
      setUploading(false);
    }
  };

  const deleteFile = async (filename: string) => {
    try {
      const res = await fetch(`/api/knowledge/${filename}`, { method: "DELETE" });
      if (res.ok) void refetchKnowledge();
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  const createTusksLore = async () => {
    setTusksLoreCreating(true);
    setTusksLoreCreateResult(null);
    try {
      const res = await fetch("/api/integrations/tusks-lore/create", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTusksLoreCreateResult(
          data.created
            ? `Created ${data.loreRoot}. Restart Tusk's Vault for it to become the active lore folder.`
            : `Folder already existed at ${data.loreRoot}. Restart to make it active.`
        );
        await refetchTusksLore();
      } else {
        setTusksLoreCreateResult(data.error || "Could not create folder.");
      }
    } catch (err) {
      setTusksLoreCreateResult("Network error: " + (err as Error).message);
    } finally {
      setTusksLoreCreating(false);
    }
  };

  const syncTomes = async () => {
    setTomesSyncing(true);
    setTomesSyncSummary(null);
    try {
      const res = await fetch("/api/integrations/tomes/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTomesSyncSummary(`Imported ${data.imported}, skipped ${data.skipped}, failed ${data.failed}.`);
        await refetchKnowledge();
        await refetchTomesStatus();
      } else {
        setTomesSyncSummary(data.error || "Sync failed.");
      }
    } catch (err) {
      setTomesSyncSummary("Network error: " + (err as Error).message);
    } finally {
      setTomesSyncing(false);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="scriptorium-card relative rounded-2xl p-6 md:p-8 parchment"
    >
      <CardCorners />

      {sourcePanel}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-verdigris-400/20 flex items-center justify-center text-verdigris-400">
            <BookOpen size={24} />
          </div>
          <div>
            <h2 className="font-display text-3xl font-bold tracking-wide text-gold-300">Lore</h2>
            <p className="text-white/40 text-sm">Source documents — your campaign's canon, indexed and queryable.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              // Fan out the three reads that determine what the bot will see
              // on its NEXT message. Setting lastScannedAt only after the
              // trio resolves keeps the surfaced timestamp honest.
              await Promise.all([refetchKnowledge(), refetchTusksLore(), refetchClarifications()]);
              setLastScannedAt(new Date());
            }}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 text-parchment-100/80 hover:text-parchment-100 rounded-lg text-sm font-semibold transition-all border border-white/10"
            title="Re-scan the Tusks-Lore folder, re-probe the resolved path, and re-count clarifications. The bot itself re-reads on every message — this catches the DASHBOARD up to disk."
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <label className="relative flex items-center gap-2 px-4 py-2 bg-gold-500 hover:bg-gold-400 text-ink-950 rounded-lg text-sm font-semibold transition-all cursor-pointer group overflow-hidden">
            {uploading ? <FlameLoader size={16} /> : <Upload size={16} />}
            <span>{uploading ? "Uploading..." : "Bulk Upload"}</span>
            <input
              type="file"
              className="hidden"
              onChange={handleFileUpload}
              disabled={uploading}
              accept=".pdf,.txt,.md,.markdown,.json,.docx,.rtf,.html,.htm,.yaml,.yml,.csv,.tsv"
              multiple
            />
          </label>
        </div>
      </div>

      {/* "What the bot will see on its next message" status line. The bot
          has NO content cache; this is the dashboard's promise that what
          you see here is what the bot will see next. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-parchment-100/65 font-mono">
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 size={11} className="text-green-400/80" />
          {lastScannedAt ? (
            <>
              Scanned{" "}
              <strong className="text-parchment-100/90">
                {lastScannedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </strong>
            </>
          ) : (
            <>Auto-scanned on launch</>
          )}
        </span>
        <span className="text-parchment-100/30">·</span>
        <span>
          <strong className="text-parchment-100/90">{indexedCount}</strong> doc
          {indexedCount === 1 ? "" : "s"}
          {skippedCount > 0 && (
            <span className="text-parchment-100/45"> ({skippedCount} not readable)</span>
          )}
          {activeVaultPath ? (
            <>
              {" "}
              from <code className="text-gold-300/85 break-all">{activeVaultPath}</code>{" "}
              <span className="text-parchment-100/45">(Obsidian vault)</span>
            </>
          ) : (
            tusksLore?.knowledgeDir && (
              <>
                {" "}
                from <code className="text-gold-300/85 break-all">{tusksLore.knowledgeDir}</code>
              </>
            )
          )}
        </span>
        <span className="text-parchment-100/30">·</span>
        <span>
          <strong className="text-parchment-100/90">{clarificationCount}</strong> clarification
          {clarificationCount === 1 ? "" : "s"} also in context
        </span>
      </div>

      {/* The #1 surprise when deleting a lore file: the spoiler was also
          (or only) a clarification, and clarifications don't live in the
          lore folder. */}
      {clarificationCount > 0 && (
        <div className="mb-6 flex items-start gap-2 rounded-md border border-verdigris-400/30 bg-verdigris-400/[0.06] px-3 py-2 text-xs text-parchment-100/85 leading-relaxed">
          <Info size={13} className="text-verdigris-300 flex-shrink-0 mt-0.5" />
          <span>
            <strong className="text-white">Heads up:</strong> spoilers can also live in clarifications — deleting
            lore files doesn't remove them. Manage in the{" "}
            <button onClick={onGoClarifications} className="underline text-verdigris-300 hover:text-verdigris-200 font-semibold">
              Clarifications tab
            </button>
            .
          </span>
        </div>
      )}

      <p className="text-xs text-white/40 mb-6 leading-relaxed">
        Supports <strong>PDF</strong>, <strong>Word (.docx)</strong>, <strong>plain text</strong>,{" "}
        <strong>Markdown</strong>, <strong>JSON</strong>, and more. For <strong>Google Docs</strong>, use{" "}
        <em>File → Download → Microsoft Word (.docx)</em> or <em>Plain Text (.txt)</em> and upload the exported
        file. PDFs are parsed for text only — images inside PDFs aren't read yet (see roadmap).
      </p>

      {/* Tusks-Lore folder card */}
      <div className="mb-6 bg-gradient-to-br from-gold-500/[0.08] via-ink-800/40 to-verdigris-400/[0.06] border border-gold-400/30 rounded-2xl p-5 parchment">
        <div className="flex items-start gap-4 mb-3">
          <div className="text-3xl">📚</div>
          <div className="flex-1 min-w-0">
            <h4 className="font-display text-lg text-gold-200 mb-0.5">Tusks-Lore folder</h4>
            <p className="text-xs text-parchment-100/60 font-serif italic leading-relaxed">
              Your campaign documents live in a shared <code className="font-mono">Tusks-Lore/</code> folder next to
              Tusks-Vault. Lore survives clean reinstalls; Tomes writes session chronicles into{" "}
              <code className="font-mono">Tusks-Lore/Sessions/&lt;campaign&gt;/</code>.
            </p>
          </div>
        </div>

        {!tusksLore ? (
          <div className="text-xs text-white/40 italic">Checking Tusks-Lore folder…</div>
        ) : tusksLore.isExternal ? (
          <div className="text-xs text-parchment-100/70 leading-relaxed">
            <CheckCircle2 size={12} className="inline text-green-400 mr-1" />
            Active lore root: <code className="font-mono text-gold-300">{tusksLore.loreRoot}</code>
            <span className="ml-2 text-parchment-100/50">({tusksLore.resolution})</span>
            {activeVaultPath ? (
              <div className="mt-1 text-parchment-100/50">
                Not currently in use — the bot is reading your Obsidian vault instead. This folder is
                kept as it is; switch back above at any time.
              </div>
            ) : (
              <>
                <div className="text-parchment-100/50 mt-1">
                  Documents indexed from <code className="font-mono">{tusksLore.knowledgeDir}</code>.
                </div>
                <div className="text-parchment-100/55 mt-1">
                  <CheckCircle2 size={10} className="inline text-green-400/80 mr-1" />
                  {indexedCount} document{indexedCount === 1 ? "" : "s"} auto-loaded on launch. Drop
                  new files into the folder and click <strong>Refresh</strong> above to re-scan.
                </div>
              </>
            )}
            <button onClick={() => void refetchTusksLore()} className="underline text-gold-300 hover:text-gold-200 mt-2">
              Re-check folder
            </button>
          </div>
        ) : (
          <div className="text-xs text-parchment-100/70 leading-relaxed">
            <span className="inline-flex items-center gap-1 text-gold-300/80">
              <AlertCircle size={12} /> Currently using the repo-local <code className="font-mono">Lore/</code> folder.
            </span>
            <div className="mt-2 mb-3 text-parchment-100/55">
              Recommended: create a shared <code className="font-mono">Tusks-Lore/</code> folder next to this repo (
              {tusksLore.defaultSibling}) so your lore is independent of Vault's code. Existing files in{" "}
              <code className="font-mono">Lore/</code> will be migrated automatically on the next restart.
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={createTusksLore}
                disabled={tusksLoreCreating}
                className="flex items-center gap-2 px-4 py-2 bg-gold-500 hover:bg-gold-400 disabled:opacity-40 text-ink-950 rounded-lg text-xs font-bold transition-all"
              >
                {tusksLoreCreating ? <FlameLoader size={12} /> : <Plus size={12} />}
                {tusksLore.defaultSiblingExists ? "Adopt existing Tusks-Lore" : "Create Tusks-Lore folder"}
              </button>
              <button onClick={() => void refetchTusksLore()} className="text-xs underline text-gold-300 hover:text-gold-200">
                Re-check
              </button>
            </div>
            {tusksLoreCreateResult && (
              <p className="mt-2 text-gold-300/90 font-serif italic">{tusksLoreCreateResult}</p>
            )}
          </div>
        )}
      </div>

      {/* Tusk's Tomes integration card */}
      <div className="mb-6 bg-gradient-to-br from-verdigris-400/[0.08] via-ink-800/40 to-gold-500/[0.06] border border-verdigris-400/40 rounded-2xl p-5 parchment">
        <div className="flex items-start gap-4 mb-3">
          <div className="text-3xl">📜</div>
          <div className="flex-1 min-w-0">
            <h4 className="font-display text-lg text-gold-200 mb-0.5">Paired with Tusk's Tomes</h4>
            <p className="text-xs text-parchment-100/60 font-serif italic leading-relaxed">
              Tusk's Tomes records and chronicles your D&D sessions. Drop both repos as siblings and Vault
              auto-imports finished session chronicles as lore.
            </p>
          </div>
          <a
            href="https://github.com/KochiTusker/Tusks-Tomes"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 text-xs text-verdigris-400 hover:text-verdigris-400/80 underline flex items-center gap-1"
          >
            View repo <ExternalLink size={11} />
          </a>
        </div>

        {!tomesProbe ? (
          <div className="text-xs text-white/40 italic">Probing for Tomes installation…</div>
        ) : tomesProbe.found && tomesProbe.sessionsPath ? (
          <div>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div className="text-xs text-parchment-100/70">
                <CheckCircle2 size={12} className="inline text-green-400 mr-1" />
                Found at <code className="font-mono text-verdigris-400">{tomesProbe.sessionsPath}</code>
                <span className="ml-2 text-parchment-100/50">
                  · {tomesProbe.campaignCount} campaign{tomesProbe.campaignCount === 1 ? "" : "s"} ·{" "}
                  {tomesProbe.chronicleCount} chronicle{tomesProbe.chronicleCount === 1 ? "" : "s"}
                  {tomesProbe.alreadyImported > 0 && ` · ${tomesProbe.alreadyImported} already imported`}
                </span>
              </div>
              <button
                onClick={syncTomes}
                disabled={tomesSyncing || tomesProbe.chronicleCount === tomesProbe.alreadyImported}
                className="flex items-center gap-2 px-4 py-2 bg-verdigris-400 hover:bg-verdigris-400/80 disabled:opacity-40 text-ink-950 rounded-lg text-xs font-bold transition-all"
              >
                {tomesSyncing ? <FlameLoader size={12} /> : <BookOpen size={12} />}
                {tomesSyncing
                  ? "Syncing…"
                  : tomesProbe.chronicleCount === tomesProbe.alreadyImported
                    ? "All synced"
                    : `Sync ${tomesProbe.chronicleCount - tomesProbe.alreadyImported} new`}
              </button>
            </div>
            {tomesChronicles.length > 0 && (
              <details className="text-xs text-parchment-100/60">
                <summary className="cursor-pointer hover:text-parchment-100/90">View detected chronicles</summary>
                <ul className="mt-2 space-y-1 ml-4 reveal-on-open">
                  {tomesChronicles.map(c => (
                    <li key={c.filename} className="flex items-center gap-2">
                      {c.alreadyImported ? (
                        <CheckCircle2 size={10} className="text-green-400" />
                      ) : (
                        <span className="w-[10px] h-[10px] rounded-full bg-gold-400/60" />
                      )}
                      <span className="text-verdigris-400">{c.campaign}</span>
                      <span className="text-parchment-100/40">/</span>
                      <span className="font-mono">{c.filename}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {tomesSyncSummary && <p className="text-xs text-gold-300 mt-2">{tomesSyncSummary}</p>}
          </div>
        ) : tomesProbe.found ? (
          <div className="text-xs text-parchment-100/70 leading-relaxed">
            <CheckCircle2 size={12} className="inline text-verdigris-400 mr-1" />
            Tomes detected at <code className="font-mono text-verdigris-400">{tomesProbe.repoPath}</code>{" "}
            <span className="text-parchment-100/50">— but no chronicles yet.</span>
            <div className="mt-1.5 text-parchment-100/55">
              Tomes hasn't created a <code className="font-mono">Sessions/</code> folder yet. Run a session through
              Tomes (record → transcribe → chronicle), then click{" "}
              <button onClick={() => void refetchTomesStatus()} className="underline text-gold-300 hover:text-gold-200">
                Probe again
              </button>{" "}
              here to import the first chronicle.
            </div>
          </div>
        ) : (
          <div className="text-xs text-parchment-100/60 leading-relaxed">
            No Tusk's Tomes installation detected nearby. To enable: clone{" "}
            <a
              href="https://github.com/KochiTusker/Tusks-Tomes"
              target="_blank"
              rel="noopener noreferrer"
              className="text-verdigris-400 underline"
            >
              Tusks-Tomes
            </a>{" "}
            next to this folder (so you have <code className="font-mono">../Tusks-Tomes</code> from here), or set{" "}
            <strong>Tomes Sessions Path</strong> in Settings to its location.{" "}
            <button onClick={() => void refetchTomesStatus()} className="underline text-gold-300 hover:text-gold-200 ml-1">
              Probe again
            </button>
          </div>
        )}
      </div>

      {/* Lore-size warning. Counts only files Vault can actually read: a
          folder full of .bak copies is not "loaded into every LLM query", and
          telling the user it is sends them off pruning the wrong things. */}
      {(() => {
        const indexedFiles = knowledgeFiles.filter(f => f.indexed !== false);
        const totalBytes = indexedFiles.reduce((sum, f) => sum + (f.size || 0), 0);
        const SOFT_LIMIT = 500 * 1024;
        const HARD_LIMIT = 5 * 1024 * 1024;
        if (totalBytes < SOFT_LIMIT) return null;
        const overHard = totalBytes >= HARD_LIMIT;
        const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);
        return (
          <div
            className={`mb-6 rounded-2xl p-4 border text-xs leading-relaxed ${overHard ? "bg-red-500/[0.08] border-red-400/40 text-red-100/90" : "bg-amber-500/[0.08] border-amber-400/40 text-amber-100/90"}`}
          >
            <div className="flex items-start gap-3">
              <AlertCircle size={16} className={`flex-shrink-0 mt-0.5 ${overHard ? "text-red-300" : "text-amber-300"}`} />
              <div>
                <p className="font-semibold mb-1">
                  {overHard ? "Your lore is large enough to risk truncation." : "Heads up — your lore is getting sizeable."}
                </p>
                <p className="text-parchment-100/80">
                  {indexedFiles.length} document{indexedFiles.length === 1 ? "" : "s"} totalling{" "}
                  <strong>{totalMb} MB</strong> are loaded into every LLM query. Larger context means each question
                  costs a little more in tokens.
                  {overHard && (
                    <>
                      {" "}
                      Content past the prompt cap (~500k characters) is silently truncated — consider trimming or
                      splitting the largest files.
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {knowledgeFiles.length === 0 ? (
        <div className="py-12 text-center border-2 border-dashed border-white/5 rounded-3xl">
          <p className="text-white/20">No sources uploaded yet.</p>
        </div>
      ) : (
        (() => {
          // The corpus already has a shape — an Obsidian vault groups NPCs by
          // family and notes by session — and rendering it flat threw that away
          // and produced one alphabetical wall. Group on the folder the user
          // made. Nothing here writes to disk; the vault is read-only.
          const matches = filterLoreFiles(knowledgeFiles, fileQuery);
          const groups = groupLoreFiles(matches);
          const searching = fileQuery.trim().length > 0;

          return (
            <>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="relative flex-1 min-w-[220px]">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
                  <input
                    type="search"
                    value={fileQuery}
                    onChange={e => setFileQuery(e.target.value)}
                    placeholder="Filter by name or folder…"
                    aria-label="Filter lore documents by name or folder"
                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm placeholder:text-white/20 focus:outline-none focus:border-gold-400/40"
                  />
                </div>
                <p className="text-[11px] text-white/35 uppercase tracking-wider">
                  {searching
                    ? `${matches.length} of ${knowledgeFiles.length} shown`
                    : `${groups.length} folder${groups.length === 1 ? "" : "s"} · ${knowledgeFiles.length} documents`}
                </p>
                {groups.length > 1 && !searching && (
                  <button
                    onClick={() => setCollapsedGroups(c => (c.size ? new Set() : new Set(groups.map(g => g.name))))}
                    className="text-[11px] uppercase tracking-wider text-gold-300/70 hover:text-gold-200 underline"
                  >
                    {collapsedGroups.size ? "Expand all" : "Collapse all"}
                  </button>
                )}
              </div>

              {matches.length === 0 ? (
                <div className="py-12 text-center border-2 border-dashed border-white/5 rounded-3xl">
                  <p className="text-white/25 text-sm">
                    Nothing matches “{fileQuery.trim()}”.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {groups.map(group => {
                    // A search result is always open: collapsing what someone
                    // just searched for hides the answer behind another click.
                    const collapsed = !searching && collapsedGroups.has(group.name);
                    return (
                      <div key={group.name} className="rounded-2xl border border-white/10 bg-white/[0.02]">
                        <button
                          onClick={() =>
                            setCollapsedGroups(c => {
                              const next = new Set(c);
                              if (!next.delete(group.name)) next.add(group.name);
                              return next;
                            })
                          }
                          aria-expanded={!collapsed}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] rounded-2xl transition-colors"
                        >
                          <ChevronRight
                            size={16}
                            className={`text-gold-400/70 flex-shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
                          />
                          <FolderOpen size={16} className="text-gold-400/70 flex-shrink-0" />
                          <span className="font-display font-bold text-sm truncate" title={group.name}>
                            {group.name}
                          </span>
                          <span className="text-[10px] text-white/30 uppercase tracking-wider flex-shrink-0">
                            {group.files.length} · {(group.bytes / 1024).toFixed(0)} KB
                            {group.unreadable > 0 && (
                              <span
                                className="ml-1.5 text-amber-300/70"
                                title={`${group.unreadable} file(s) in this folder can't be read, so they never reach the bot`}
                              >
                                · {group.unreadable} not read
                              </span>
                            )}
                          </span>
                        </button>

                        {!collapsed && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-3 pb-3">
                            {group.files.map(({ file, subPath }) => (
                              <div
                                key={file.name}
                                className={`p-3 rounded-xl border flex items-center justify-between group ${
                                  file.indexed === false
                                    ? "bg-white/[0.02] border-white/5 opacity-60"
                                    : "bg-white/5 border-white/10"
                                }`}
                              >
                                <div className="flex items-center gap-3 overflow-hidden">
                                  <div className="text-gold-400 flex-shrink-0">
                                    <FileText size={16} />
                                  </div>
                                  <div className="overflow-hidden">
                                    {/* Full path in the title: the row shows the
                                        part below the heading, so the heading
                                        plus the row is the whole path. */}
                                    <p className="font-semibold truncate text-sm" title={displayFileName(file.name)}>
                                      {subPath}
                                    </p>
                                    <p className="text-[10px] text-white/30 uppercase tracking-wider">
                                      {(file.size / 1024).toFixed(1)} KB
                                      {file.indexed === false && (
                                        <span
                                          className="ml-1.5 text-amber-300/70"
                                          title="Vault can't read this file type, so it never reaches the bot"
                                        >
                                          · not read
                                        </span>
                                      )}
                                    </p>
                                  </div>
                                </div>
                                <button
                                  onClick={() => deleteFile(file.name)}
                                  className="p-2 text-white/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                                  title={`Remove ${displayFileName(file.name)}`}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          );
        })()
      )}
    </motion.section>
  );
}
