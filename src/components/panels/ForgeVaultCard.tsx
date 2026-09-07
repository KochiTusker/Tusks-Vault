// "Organise my lore into a vault" — the button.
//
// The pipeline behind it is mechanical: every note body is copied from its
// source verbatim, so it restructures and cannot invent. That is worth saying
// on the card, because "let the AI reorganise my campaign" is a frightening
// proposition to anyone whose notes exist nowhere else, and the honest answer
// is that this particular pass does not use one.
//
// Progress is streamed rather than awaited. A real campaign takes tens of
// seconds, and a button that appears to hang is a button people press twice.

import { useEffect, useState } from "react";
import { Hammer, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/utils";

interface Target {
  loreDir: string;
  outDir: string;
  ok: boolean;
  reason: string | null;
}

interface Progress {
  phase: "reading" | "planning" | "linking" | "writing" | "verifying" | "done";
  done: number;
  total: number;
  detail?: string;
}

interface Result {
  outDir: string;
  documentsRead: number;
  unitsFound: number;
  notesWritten: number;
  linksWritten: number;
  brokenLinks: number;
  needsDecision: number;
  byType: Record<string, number>;
  orphans: string[];
  heldBack: number;
  bytesWritten: number;
}

const PHASE_LABEL: Record<Progress["phase"], string> = {
  reading: "Reading documents",
  planning: "Working out the notes",
  linking: "Linking them together",
  writing: "Writing the vault",
  verifying: "Checking the links",
  done: "Done",
};

export function ForgeVaultCard({ onForged }: { onForged?: () => void }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeSessions, setIncludeSessions] = useState(true);
  const running = progress !== null && progress.phase !== "done";

  useEffect(() => {
    fetch("/api/forge/target")
      .then(r => (r.ok ? r.json() : null))
      .then(setTarget)
      .catch(() => setTarget(null));
  }, [result]);

  const build = async (): Promise<void> => {
    setError(null);
    setResult(null);
    setProgress({ phase: "reading", done: 0, total: 0 });
    try {
      const res = await fetch("/api/forge/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeSessions }),
      });
      if (!res.ok || !res.body) throw new Error(`Server returned ${res.status}`);

      // Server-sent events, read by hand: the payloads are small and the
      // alternative is a dependency for one endpoint.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const event = /^event: (.+)$/m.exec(chunk)?.[1];
          const data = /^data: (.+)$/m.exec(chunk)?.[1];
          if (!event || !data) continue;
          const parsed = JSON.parse(data);
          if (event === "progress") setProgress(parsed as Progress);
          else if (event === "done") {
            setResult(parsed as Result);
            setProgress({ phase: "done", done: 1, total: 1 });
            onForged?.();
          } else if (event === "error") setError((parsed as { message: string }).message);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(p => (p && p.phase !== "done" ? null : p));
    }
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-gold-300/80">
          <Hammer size={16} />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white/90">Organise into a vault</h3>
          <p className="text-[11px] leading-relaxed text-white/50 mt-1">
            Splits your documents into one note per subject, adds frontmatter and links them
            together — an Obsidian vault you can open and edit. Your source documents are never
            modified. Every note's text is copied from them word for word, so this reorganises
            your lore; it does not rewrite it.
          </p>
        </div>
      </div>

      {target && (
        <p className="text-[10px] font-mono text-white/35 break-all">
          {target.loreDir} → {target.outDir}
        </p>
      )}

      {target && !target.ok && (
        <p className="flex items-start gap-2 text-[11px] text-warning">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          {target.reason}
        </p>
      )}

      <label className="flex items-center gap-2 text-[11px] text-white/60">
        <input
          type="checkbox"
          checked={includeSessions}
          onChange={e => setIncludeSessions(e.target.checked)}
          className="accent-gold-400"
        />
        Include session records
        <span className="text-white/30">
          — leave on, or the bot cannot answer “what happened last session”
        </span>
      </label>

      <button
        type="button"
        onClick={() => void build()}
        disabled={running || (target ? !target.ok : false)}
        className={cn(
          "w-full flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm",
          "border border-gold-400/40 bg-gold-400/10 text-gold-100 hover:bg-gold-400/20",
          "disabled:opacity-40 disabled:cursor-not-allowed"
        )}
      >
        {running && <Loader2 size={13} className="animate-spin" />}
        {running ? PHASE_LABEL[progress.phase] : result ? "Rebuild the vault" : "Build the vault"}
      </button>

      {running && (
        <div className="space-y-1">
          <div className="h-1 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-gold-400/70 transition-all" style={{ width: `${pct}%` }} />
          </div>
          {progress.detail && (
            <p className="text-[10px] font-mono text-white/30 truncate">{progress.detail}</p>
          )}
        </div>
      )}

      {error && <p className="text-[11px] text-red-300/90">{error}</p>}

      {result && (
        <div className="space-y-2 text-[11px] text-white/60">
          <p className="text-white/80">
            {result.notesWritten} notes from {result.documentsRead} documents ·{" "}
            {result.linksWritten} links · {result.brokenLinks} broken
          </p>
          <p className="text-[10px] text-white/40">
            {Object.entries(result.byType)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([type, n]) => `${n} ${type}`)
              .join(" · ")}
          </p>
          {result.needsDecision > 0 && (
            // Surfaced rather than buried: these are the notes filed under a
            // guess, and the user is the only one who can settle them.
            <p className="text-warning/90">
              {result.needsDecision} note{result.needsDecision === 1 ? "" : "s"} could not be typed
              from the source — they are filed under Lore. Worth a look in Obsidian.
            </p>
          )}
          {result.orphans.length > 0 && (
            <p className="text-white/40">
              Nothing links to {result.orphans.length} note
              {result.orphans.length === 1 ? "" : "s"} — usually a subject the rest of your lore
              calls something else. Adding an alias to those notes fixes it.
            </p>
          )}
          <p className="text-white/40">
            Point the lore source at this folder above to start using it.
          </p>
        </div>
      )}
    </div>
  );
}
