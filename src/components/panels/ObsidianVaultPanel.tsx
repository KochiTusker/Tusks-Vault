// Lore source picker — the Tusks-Lore folder, or an Obsidian vault.
//
// Sits above the document list because it answers the prior question: not
// "what lore is there" but "where is lore read from". Choosing an Obsidian
// vault changes what every other row on the Lore tab is describing.
//
// The map is the second half of this card and only appears once a vault is
// selected, because "build a map of the vault" is meaningless before there is
// one.

import { useEffect, useRef, useState } from "react";
import { ForgeVaultCard } from "./ForgeVaultCard";
import { FolderPicker } from "./FolderPicker";
import {
  AlertTriangle,
  BookMarked,
  CheckCircle2,
  FolderOpen,
  FolderTree,
  Info,
  Map as MapIcon,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { FlameLoader } from "../FlameLoader";

export interface VaultInspection {
  ok: boolean;
  error?: string;
  path?: string;
  isObsidianVault?: boolean;
  noteCount?: number;
  folders?: Array<{ name: string; count: number }>;
  frontmatterKeys?: string[];
  notesWithAliases?: number;
}

export interface VaultStatus {
  loreSource: "folder" | "obsidian";
  useVaultMap: boolean;
  vaultPath: string | null;
  vaultExists: boolean;
  map: {
    builtAt: string;
    model: string | null;
    noteCount: number;
    modelSummarised: number;
    mechanicalSummarised: number;
    staleCount: number;
  } | null;
}

interface BuildProgress {
  phase: "scanning" | "summarising" | "embedding" | "done";
  done: number;
  total: number;
  note?: string;
}

interface Props {
  /** Owned by App: the Lore tab's provenance lines depend on the same
   *  answer, and two copies of it can disagree about which source is live. */
  status: VaultStatus | null;
  refreshStatus: () => Promise<void> | void;
  /** Refetch the Lore tab's document list — the source switch changes it. */
  onSourceChanged: () => void;
}

export function ObsidianVaultPanel({ status, refreshStatus, onSourceChanged }: Props) {
  const [pathInput, setPathInput] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inspection, setInspection] = useState<VaultInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [buildResult, setBuildResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Abort a build the user navigates away from rather than leaving the
  // stream — and the CLI behind it — running unattended.
  const abortRef = useRef<AbortController | null>(null);

  // Prefill the path box from the saved vault, once, without stomping on
  // what the user is currently typing.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current) return;
    if (status?.vaultPath) {
      prefilledRef.current = true;
      setPathInput(status.vaultPath);
    }
  }, [status?.vaultPath]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /** `override` exists for the folder picker: it inspects the folder just
   *  chosen, which setPathInput has not yet flushed into state. */
  const inspect = async (override?: string) => {
    const target = override ?? pathInput;
    setInspecting(true);
    setError(null);
    try {
      const res = await fetch("/api/obsidian/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: target }),
      });
      setInspection((await res.json()) as VaultInspection);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInspecting(false);
    }
  };

  const setSource = async (source: "folder" | "obsidian", useVaultMap?: boolean) => {
    setSwitching(true);
    setError(null);
    try {
      const res = await fetch("/api/obsidian/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, path: pathInput, useVaultMap }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not switch source.");
        return;
      }
      await refreshStatus();
      onSourceChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSwitching(false);
    }
  };

  const buildMap = async (force: boolean) => {
    setBuilding(true);
    setBuildResult(null);
    setError(null);
    setProgress(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/obsidian/map/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
        signal: ctrl.signal,
      });
      if (!res.body) throw new Error("No response stream.");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const event = chunk.match(/^event: (.*)$/m)?.[1];
          const raw = chunk.match(/^data: (.*)$/m)?.[1];
          if (!raw) continue;
          const data = JSON.parse(raw);
          if (event === "progress") setProgress(data as BuildProgress);
          else if (event === "error") setError(data.error);
          else if (event === "done") setBuildResult(describeBuild(data));
        }
      }
      await refreshStatus();
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setBuilding(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const clearMap = async () => {
    await fetch("/api/obsidian/map", { method: "DELETE" });
    setBuildResult(null);
    await refreshStatus();
    onSourceChanged();
  };

  const isObsidian = status?.loreSource === "obsidian";

  return (
    <div className="mb-6 rounded-2xl border border-white/5 bg-black/30 p-6">
      <div className="mb-1 flex items-center gap-2">
        <BookMarked size={16} className="text-verdigris-400" />
        <h3 className="text-sm font-bold uppercase tracking-widest text-white/70">Lore source</h3>
      </div>
      <p className="mb-5 text-xs leading-relaxed text-white/40">
        Where the bot reads your campaign from. An Obsidian vault is read strictly read-only — Tusk's
        Vault never writes, renames, or deletes anything inside it.
      </p>

      {/* Source choice. Two mutually-exclusive cards rather than a dropdown:
          this is a decision with consequences elsewhere on the page, and it
          should look like one. */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => void setSource("folder")}
          disabled={switching}
          className={`rounded-xl border p-4 text-left transition-all disabled:opacity-60 ${
            !isObsidian
              ? "border-gold-400/40 bg-gold-500/10"
              : "border-white/10 bg-black/20 hover:border-white/20"
          }`}
        >
          <div className="mb-1 flex items-center gap-2 text-sm font-bold">
            <FolderTree size={14} className={!isObsidian ? "text-gold-300" : "text-white/40"} />
            Tusks-Lore folder
            {!isObsidian && (
              <span className="rounded bg-gold-500/25 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gold-200">
                active
              </span>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-white/45">
            Documents you upload here — PDF, DOCX, Markdown, plain text. The default.
          </p>
        </button>

        <button
          onClick={() => void setSource("obsidian")}
          disabled={switching || !status?.vaultPath}
          title={status?.vaultPath ? undefined : "Choose a vault below first"}
          className={`rounded-xl border p-4 text-left transition-all disabled:opacity-40 ${
            isObsidian
              ? "border-gold-400/40 bg-gold-500/10"
              : "border-white/10 bg-black/20 hover:border-white/20"
          }`}
        >
          <div className="mb-1 flex items-center gap-2 text-sm font-bold">
            <BookMarked size={14} className={isObsidian ? "text-gold-300" : "text-white/40"} />
            Obsidian vault
            {isObsidian && (
              <span className="rounded bg-gold-500/25 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gold-200">
                active
              </span>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-white/45">
            One note per entity, with its aliases and links. Read where it already lives.
          </p>
        </button>
      </div>

      {isObsidian && status && !status.vaultExists && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-yellow-400/30 bg-yellow-500/[0.06] px-3 py-2 text-xs leading-relaxed text-yellow-100/85">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-yellow-300" />
          <span>
            The configured vault isn't there any more. The bot is answering from the Tusks-Lore
            folder until it comes back or you pick a different one.
          </span>
        </div>
      )}

      {/* Vault path + inspection.
          Browsing is the primary path — nobody should have to know, or
          re-type, an absolute path to point at a folder they can see. The
          text field stays for pasting one you already have. */}
      <div className="relative mb-2 flex flex-col gap-2 sm:flex-row">
        <button
          onClick={() => setPickerOpen(o => !o)}
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-gold-400/40 bg-gold-400/15 px-4 py-2 text-xs font-bold text-gold-300 transition-all hover:bg-gold-400/25"
        >
          <FolderOpen size={13} /> Browse…
        </button>
        <input
          value={pathInput}
          onChange={e => setPathInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") void inspect();
          }}
          placeholder="…or paste a full path"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/50 px-3 py-2 font-mono text-xs text-white placeholder:text-white/30"
        />
        <button
          onClick={() => void inspect()}
          disabled={inspecting || !pathInput.trim()}
          className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold transition-all hover:bg-white/10 disabled:opacity-40"
        >
          {inspecting ? <FlameLoader size={12} /> : <RefreshCw size={12} />} Check
        </button>

        {pickerOpen && (
          <FolderPicker
            // Reopen where the user last was rather than at the drive list.
            startPath={pathInput.trim() || status?.vaultPath || ""}
            onClose={() => setPickerOpen(false)}
            onPick={folder => {
              setPathInput(folder);
              setPickerOpen(false);
              // Inspect immediately: picking a folder IS the question "is this
              // the right one", and making the user click Check as well leaves
              // it unanswered for no reason.
              void inspect(folder);
            }}
          />
        )}
      </div>
      <p className="mb-4 text-[10px] leading-relaxed text-white/30">
        Browse to the folder your notes live in — vaults are marked. If you would rather paste the
        path, Obsidian shows it under Settings → About → Override config folder, or right-click the
        vault name → Reveal in file explorer.
      </p>

      {inspection && !inspection.ok && (
        <div className="mb-4 rounded-md border border-red-400/30 bg-red-500/[0.06] px-3 py-2 text-xs text-red-200/85">
          {inspection.error}
        </div>
      )}

      {inspection?.ok && (
        <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1 text-green-300">
              <CheckCircle2 size={12} /> {inspection.noteCount} note
              {inspection.noteCount === 1 ? "" : "s"}
            </span>
            {inspection.isObsidianVault ? (
              <span className="text-white/40">Obsidian vault</span>
            ) : (
              <span className="text-yellow-200/70">
                No .obsidian folder — a plain folder of notes, which works fine
              </span>
            )}
            <span className="text-white/40">
              {inspection.notesWithAliases} with aliases
            </span>
          </div>
          {inspection.folders && inspection.folders.length > 0 && (
            <p className="mb-2 text-[11px] leading-relaxed text-white/45">
              {inspection.folders.map(f => `${f.name} (${f.count})`).join(" · ")}
            </p>
          )}
          {inspection.frontmatterKeys && inspection.frontmatterKeys.length > 0 && (
            <p className="text-[11px] leading-relaxed text-white/35">
              Frontmatter: {inspection.frontmatterKeys.slice(0, 10).join(", ")}
            </p>
          )}
          {inspection.path !== status?.vaultPath && (
            <button
              onClick={() => void setSource("obsidian", true)}
              disabled={switching}
              className="mt-3 rounded-lg bg-gold-500 px-4 py-2 text-xs font-bold text-ink-950 transition-all hover:bg-gold-400 disabled:opacity-40"
            >
              Use this vault
            </button>
          )}
        </div>
      )}

      {/* The map. Only meaningful once a vault is chosen. */}
      {isObsidian && status?.vaultPath && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-1 flex items-center gap-2">
            <MapIcon size={14} className="text-verdigris-400" />
            <h4 className="text-xs font-bold uppercase tracking-widest text-white/60">Vault map</h4>
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-white/45">
            One pass over the vault reduces each note to a line describing what it covers. Every
            line goes in the prompt, so the bot always knows what exists — and only the notes a
            question actually needs are read in full. Without it, a large vault gets truncated
            arbitrarily.
          </p>

          <label className="mb-3 flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-white/60">
            <input
              type="checkbox"
              checked={status.useVaultMap}
              onChange={e => void setSource("obsidian", e.target.checked)}
              disabled={switching}
              className="mt-0.5 accent-gold-400"
            />
            <span>
              Use the map when answering. Turn off to send the whole vault every time — fine for a
              small vault, expensive for a large one.
            </span>
          </label>

          {status.map ? (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/50">
              <span className="inline-flex items-center gap-1 text-green-300/90">
                <CheckCircle2 size={11} /> {status.map.noteCount} notes mapped
              </span>
              <span>
                {status.map.modelSummarised} by {status.map.model ?? "a model"}
                {status.map.mechanicalSummarised > 0 && `, ${status.map.mechanicalSummarised} without AI`}
              </span>
              <span className="text-white/30">·</span>
              <span>built {new Date(status.map.builtAt).toLocaleString()}</span>
              {status.map.staleCount > 0 && (
                <span className="inline-flex items-center gap-1 text-yellow-200/80">
                  <AlertTriangle size={11} /> {status.map.staleCount} note
                  {status.map.staleCount === 1 ? "" : "s"} added or removed since
                </span>
              )}
            </div>
          ) : (
            <div className="mb-3 flex items-start gap-2 text-[11px] leading-relaxed text-white/45">
              <Info size={12} className="mt-0.5 flex-shrink-0 text-white/30" />
              <span>No map yet. Until one is built, the whole vault is sent on every question.</span>
            </div>
          )}

          {building && progress && (
            <div className="mb-3 flex items-center gap-2 text-[11px] text-white/60">
              <FlameLoader size={12} />
              <span>
                {progress.phase === "scanning" && `Scanning ${progress.total} notes…`}
                {progress.phase === "summarising" &&
                  `Reading notes — ${progress.done} of ${progress.total}`}
                {progress.phase === "embedding" &&
                  `Indexing — ${progress.done} of ${progress.total}`}
                {progress.phase === "done" && "Finishing…"}
              </span>
            </div>
          )}

          {buildResult && (
            <div className="mb-3 rounded-md border border-green-400/25 bg-green-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-green-100/85">
              {buildResult}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void buildMap(false)}
              disabled={building}
              className="flex items-center gap-1 rounded-lg bg-gold-500 px-4 py-2 text-xs font-bold text-ink-950 transition-all hover:bg-gold-400 disabled:opacity-40"
            >
              {building ? <FlameLoader size={12} /> : <MapIcon size={12} />}
              {status.map ? "Update map" : "Build map"}
            </button>
            {status.map && (
              <>
                <button
                  onClick={() => void buildMap(true)}
                  disabled={building}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold transition-all hover:bg-white/10 disabled:opacity-40"
                  title="Re-read every note, even unchanged ones"
                >
                  Rebuild from scratch
                </button>
                <button
                  onClick={() => void clearMap()}
                  disabled={building}
                  className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold text-white/30 transition-colors hover:text-red-300 disabled:opacity-40"
                >
                  <Trash2 size={12} /> Clear
                </button>
              </>
            )}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-white/25">
            Updating only re-reads notes whose contents changed. The map is stored with Tusk's
            Vault's own settings, never inside your vault.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-md border border-red-400/30 bg-red-500/[0.06] px-3 py-2 text-xs text-red-200/85">
          {error}
        </div>
      )}

      {/* Sits under the source choice on purpose: the folder source is where
          a new user starts, and this is the step that turns it into the vault
          the option above wants pointing at. */}
      <div className="mt-5">
        <ForgeVaultCard onForged={() => void refreshStatus()} />
      </div>
    </div>
  );
}

function describeBuild(data: {
  notesTotal: number;
  notesSummarised: number;
  batchesFailed: number;
  mechanicalOnly: boolean;
  model: string | null;
}): string {
  if (data.notesSummarised === 0) {
    return `Nothing had changed — all ${data.notesTotal} notes were already mapped.`;
  }
  const bits = [`Mapped ${data.notesSummarised} note${data.notesSummarised === 1 ? "" : "s"}`];
  if (data.mechanicalOnly) {
    // Said plainly rather than buried: the map works without a model, but it
    // is noticeably better with one, and the user should know which they got.
    bits.push(
      "without a model — no provider was configured, so summaries came from each note's opening line. " +
        "Add a key and rebuild for better retrieval."
    );
  } else if (data.model) {
    bits.push(`using ${data.model}`);
  }
  if (data.batchesFailed > 0) {
    bits.push(
      `${data.batchesFailed} batch${data.batchesFailed === 1 ? "" : "es"} failed and fell back to ` +
        "opening lines; running Update again retries them."
    );
  }
  return bits.join(" ") + ".";
}
