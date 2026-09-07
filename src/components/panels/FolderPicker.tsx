// Choosing a folder without typing a path.
//
// A web page cannot open the OS folder dialog and get an absolute path back —
// `<input type="file" webkitdirectory>` returns relative entry names, never
// `D:/Notes/Vault`. The server browses instead (GET /api/obsidian/browse,
// loopback-only, directory names only) and this walks that listing.
//
// Modelled on ModelPicker's popover so the two pickers in this dashboard
// behave the same way: click to open, Escape or an outside click to dismiss.

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronRight, CornerLeftUp, FolderOpen, HardDrive, Loader2, X } from "lucide-react";
import { cn } from "../../lib/utils";

interface DirEntry {
  name: string;
  path: string;
  isObsidianVault: boolean;
}

interface DirListing {
  ok: boolean;
  error?: string;
  path: string | null;
  parent: string | null;
  entries: DirEntry[];
  truncated: boolean;
  isObsidianVault?: boolean;
}

interface Props {
  /** Where to open. Empty string starts at the drive/root list. */
  startPath?: string;
  onPick: (folderPath: string) => void;
  onClose: () => void;
}

export function FolderPicker({ startPath, onPick, onClose }: Props) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Guards against a slow listing for a folder the user has already navigated
  // away from landing after a fast one and replacing it.
  const requestRef = useRef(0);

  const load = useCallback(async (target: string) => {
    const ticket = ++requestRef.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/obsidian/browse?path=${encodeURIComponent(target)}`);
      const data = (await res.json()) as DirListing;
      if (ticket === requestRef.current) setListing(data);
    } catch {
      if (ticket === requestRef.current) {
        setListing({
          ok: false,
          error: "Could not reach the folder list.",
          path: null,
          parent: null,
          entries: [],
          truncated: false,
        });
      }
    } finally {
      if (ticket === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(startPath ?? "");
  }, [load, startPath]);

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const atRoots = listing?.path === null;

  return (
    <div
      ref={boxRef}
      className="absolute z-50 mt-1 flex max-h-[24rem] w-[min(32rem,90vw)] flex-col overflow-hidden rounded-xl border border-white/15 bg-[#160f0a] shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <FolderOpen size={13} className="shrink-0 text-gold-400/70" />
        <span className="flex-1 truncate font-mono text-xs text-white/70" title={listing?.path ?? undefined}>
          {atRoots ? "This computer" : (listing?.path ?? "Loading…")}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close folder picker"
          className="text-white/30 hover:text-white/70"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="flex items-center gap-2 px-3 py-3 text-xs text-white/40">
            <Loader2 size={12} className="animate-spin" /> Reading folder…
          </p>
        )}

        {!loading && listing && !listing.ok && (
          <p className="flex items-start gap-2 px-3 py-3 text-xs text-red-300/80">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            {listing.error}
          </p>
        )}

        {!loading && listing?.parent && (
          <button
            type="button"
            onClick={() => void load(listing.parent as string)}
            className="flex w-full items-center gap-2 border-b border-white/5 px-3 py-2 text-left hover:bg-white/5"
          >
            <CornerLeftUp size={13} className="shrink-0 text-white/40" />
            <span className="text-xs text-white/60">Up one level</span>
          </button>
        )}

        {!loading &&
          listing?.entries.map(entry => (
            <button
              key={entry.path}
              type="button"
              onClick={() => void load(entry.path)}
              title={entry.path}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/5"
            >
              {atRoots ? (
                <HardDrive size={13} className="shrink-0 text-white/40" />
              ) : (
                <FolderOpen size={13} className="shrink-0 text-white/40" />
              )}
              <span className="min-w-0 flex-1 truncate text-xs text-white/80">{entry.name}</span>
              {/* The one unambiguous signal, so a user recognises their vault
                  in a list of ordinary folders without opening each. */}
              {entry.isObsidianVault && (
                <span className="shrink-0 rounded border border-verdigris-400/40 px-1 py-px text-[9px] text-verdigris-400/90">
                  vault
                </span>
              )}
              <ChevronRight size={12} className="shrink-0 text-white/20" />
            </button>
          ))}

        {!loading && listing?.ok && listing.entries.length === 0 && (
          <p className="px-3 py-3 text-xs text-white/35">No sub-folders here.</p>
        )}

        {!loading && listing?.truncated && (
          <p className="border-t border-white/5 px-3 py-2 text-[10px] text-white/30">
            Only the first 500 sub-folders are shown. Open a more specific folder to narrow the list.
          </p>
        )}
      </div>

      {/* Choosing is always the CURRENT folder, never a highlighted row: the
          folder you are looking inside is the one you mean, and that removes
          the "did I select it or just open it?" ambiguity. */}
      {!atRoots && listing?.ok && listing.path && (
        <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
          <button
            type="button"
            onClick={() => onPick(listing.path as string)}
            className={cn(
              "flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
              listing.isObsidianVault
                ? "border-verdigris-400/40 bg-verdigris-400/15 text-verdigris-400 hover:bg-verdigris-400/25"
                : "border-gold-400/40 bg-gold-400/15 text-gold-300 hover:bg-gold-400/25"
            )}
          >
            Use this folder
          </button>
          {listing.isObsidianVault ? (
            <span className="shrink-0 text-[10px] text-verdigris-400/80">Obsidian vault</span>
          ) : (
            <span className="shrink-0 text-[10px] text-white/30">No .obsidian folder</span>
          )}
        </div>
      )}
    </div>
  );
}
