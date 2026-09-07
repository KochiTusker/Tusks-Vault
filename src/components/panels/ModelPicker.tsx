// Picking one model out of four hundred.
//
// A native <select> is the right control for a handful of options and the
// wrong one for OpenRouter's catalogue: 414 entries in a flat, alphabetically
// arbitrary list, with the price — the thing that actually decides the
// choice — nowhere in sight. Users scroll it looking for a vendor they
// recognise and give up.
//
// So: browse by vendor first (60 groups instead of 414 rows), expand one to
// see its models, and put a tier badge on every row saying what it costs
// relative to what the user is probably already paying. Vendors offering
// something free sort first, because "can I run this for nothing" is the
// question people open this list to answer.
//
// Tier and vendor come from the server (`/api/openrouter/models`) rather than
// being recomputed here, so this and the model browser can never disagree
// about what a model costs.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Search, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { AvailableModel } from "./ActiveProviderPanel";
import { costTooltip, formatContext, formatRatePerM, vendorTooltip } from "../../lib/model-cost";

type Tier = "free" | "cheaper" | "comparable" | "premium" | "unknown";

interface CatalogueRow {
  id: string;
  name: string;
  vendor: string;
  tier: Tier;
  inputPerM: number;
  outputPerM: number;
  contextLength: number;
  isFree: boolean;
  isModerated: boolean;
  leaksReasoning?: boolean;
  /** OpenRouter's floating "-latest" pointer rather than a pinned version. */
  isAlias?: boolean;
}

interface CatalogueResponse {
  models: CatalogueRow[];
  vendors: Array<{ vendor: string; label: string }>;
  benchmark: { id: string; inputPerM: number; outputPerM: number } | null;
}

/** Cheapest first — the order a cost-conscious user reads in. */
const TIER_ORDER: Tier[] = ["free", "cheaper", "comparable", "premium", "unknown"];

const TIER_STYLE: Record<Tier, { label: string; cls: string }> = {
  free: { label: "Free", cls: "bg-emerald-400/15 text-emerald-300 border-emerald-400/30" },
  cheaper: { label: "Cheaper", cls: "bg-green-400/10 text-green-300/90 border-green-400/25" },
  comparable: { label: "Similar", cls: "bg-amber-400/10 text-amber-300/90 border-amber-400/25" },
  premium: { label: "Pricier", cls: "bg-orange-400/10 text-orange-300/90 border-orange-400/25" },
  unknown: { label: "—", cls: "bg-white/5 text-white/40 border-white/10" },
};

interface Props {
  value: string;
  availableModels: AvailableModel[];
  onPick: (modelId: string) => void;
  /** Shown while the probe is still deciding what this key can reach. */
  loading?: boolean;
}

export function ModelPicker({ value, availableModels, onPick, loading }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueResponse | null>(null);
  const [fetching, setFetching] = useState(false);
  /** Models the user has already allowed data sharing for. Read on open so
   *  an existing consent does not prompt again. */
  const [optedIn, setOptedIn] = useState<string[]>([]);
  /** The model awaiting a decision, if any. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Fetched on first open, not on mount: a user who never touches the picker
  // should not pay for a catalogue request, and the server caches it anyway.
  useEffect(() => {
    if (!open || catalogue || fetching) return;
    setFetching(true);
    Promise.all([
      fetch("/api/openrouter/models").then(r => (r.ok ? r.json() : null)),
      fetch("/api/settings")
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([cat, settings]) => {
        setCatalogue(cat as CatalogueResponse | null);
        const list = (settings as { openRouterDataSharingOptIn?: unknown } | null)
          ?.openRouterDataSharingOptIn;
        setOptedIn(Array.isArray(list) ? list.filter((m): m is string => typeof m === "string") : []);
      })
      .catch(() => setCatalogue(null))
      .finally(() => setFetching(false));
  }, [open, catalogue, fetching]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const byId = useMemo(
    () => new Map((catalogue?.models ?? []).map(m => [m.id, m])),
    [catalogue]
  );
  const vendorLabels = useMemo(
    () => new Map((catalogue?.vendors ?? []).map(v => [v.vendor, v.label])),
    [catalogue]
  );

  /**
   * Only models the probe says this key can reach, enriched with catalogue
   * detail where we have it.
   *
   * Availability is the source of truth for WHICH models to offer — a
   * catalogue entry the key cannot call is not an option — while the
   * catalogue supplies price and tier. A model missing from the catalogue
   * still appears, with an unknown tier, rather than vanishing.
   */
  const rows = useMemo(() => {
    return availableModels
      // Once the catalogue has loaded it is the complete list of models this
      // provider can serve as TEXT, so anything absent from it is retired or
      // not a chat model — a music or image generator, which answers a lore
      // question with caption timestamps or an upstream 502 depending on the
      // day. Probe results are cached and can predate that filter, so the
      // check is repeated here rather than trusted upstream. Before the
      // catalogue arrives nothing is hidden.
      .filter(m => !catalogue || byId.has(m.id))
      .map(m => {
        const cat = byId.get(m.id);
        return {
          id: m.id,
          label: m.displayName === m.id ? m.id : m.displayName,
          vendor: cat?.vendor ?? m.id.split("/")[0] ?? "other",
          tier: (cat?.tier ?? "unknown") as Tier,
          inputPerM: cat?.inputPerM,
          outputPerM: cat?.outputPerM,
          contextLength: cat?.contextLength,
          leaksReasoning: cat?.leaksReasoning,
          isModerated: cat?.isModerated,
          isAlias: cat?.isAlias,
          unavailable: m.verification === "unavailable",
          reason: m.verificationReason,
        };
      });
  }, [availableModels, byId, catalogue]);

  /** Offered by a stale probe but absent from the catalogue. Reported rather
   *  than silently dropped: a user who configured one of these deserves to
   *  know why it stopped appearing. */
  const hidden = catalogue ? availableModels.length - rows.length : 0;

  /**
   * Does picking this model require dropping the privacy floor?
   *
   * A free model is free because its hosts keep prompts, which is exactly
   * what the floor excludes — so choosing one is a decision about privacy,
   * not just about price, and it has to be asked rather than assumed. Models
   * already consented to do not ask again.
   */
  const needsConsent = (m: { id: string; inputPerM?: number; outputPerM?: number }): boolean =>
    m.inputPerM === 0 && (m.outputPerM ?? 0) === 0 && !optedIn.includes(m.id);

  const commit = (id: string): void => {
    onPick(id);
    setConfirming(null);
    setOpen(false);
  };

  /** Record consent for ONE model, then select it. Written straight to
   *  settings as a partial update so it cannot clobber anything else the
   *  dashboard is holding. */
  const allowSharing = async (id: string): Promise<void> => {
    setSaving(true);
    const next = [...new Set([...optedIn, id])];
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openRouterDataSharingOptIn: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setOptedIn(next);
      commit(id);
    } catch {
      // Selecting the model without the consent stored would send lore on the
      // next question and fail the floor again — worse than staying put.
      setConfirming(null);
    } finally {
      setSaving(false);
    }
  };

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? rows.filter(r => r.id.toLowerCase().includes(q) || r.label.toLowerCase().includes(q))
      : rows;

    const byVendor = new Map<string, typeof matched>();
    for (const r of matched) {
      const list = byVendor.get(r.vendor);
      if (list) list.push(r);
      else byVendor.set(r.vendor, [r]);
    }

    return [...byVendor.entries()]
      .map(([vendor, models]) => {
        const sorted = [...models].sort(
          (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.label.localeCompare(b.label)
        );
        return {
          vendor,
          label: vendorLabels.get(vendor) ?? vendor,
          models: sorted,
          bestTier: sorted.reduce<Tier>(
            (best, m) => (TIER_ORDER.indexOf(m.tier) < TIER_ORDER.indexOf(best) ? m.tier : best),
            "unknown"
          ),
        };
      })
      .sort(
        (a, b) => TIER_ORDER.indexOf(a.bestTier) - TIER_ORDER.indexOf(b.bestTier) || a.label.localeCompare(b.label)
      );
  }, [rows, query, vendorLabels]);

  // A search narrows to a handful of groups; keeping them shut would make the
  // user open each one to see whether their term matched anything inside.
  const searching = query.trim().length > 0;
  const selected = byId.get(value);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={loading}
        className={cn(
          "w-full flex items-center justify-between gap-2 bg-black/40 border border-white/10 rounded-xl px-3 py-2.5",
          "text-sm text-white font-mono text-left hover:border-white/20 focus:outline-none focus:border-gold-400/60",
          loading && "opacity-50 cursor-not-allowed"
        )}
      >
        <span className="truncate">
          {loading ? "Loading models…" : value || "— pick a model —"}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {selected && (
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-sans", TIER_STYLE[selected.tier].cls)}>
              {TIER_STYLE[selected.tier].label}
            </span>
          )}
          <ChevronDown size={14} className="text-white/40" />
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-[min(34rem,90vw)] max-h-[26rem] overflow-hidden flex flex-col rounded-xl border border-white/15 bg-[#160f0a] shadow-2xl">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
            <Search size={13} className="text-white/30 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search models…"
              className="flex-1 bg-transparent text-sm text-white placeholder:text-white/25 focus:outline-none"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="text-white/30 hover:text-white/60">
                <X size={13} />
              </button>
            )}
          </div>

          {catalogue?.benchmark && (
            <p className="px-3 py-1.5 text-[10px] text-white/35 border-b border-white/5">
              Compared against {catalogue.benchmark.id} — {formatRatePerM(catalogue.benchmark.inputPerM)}/M in
            </p>
          )}

          {confirming && (
            <div className="px-3 py-3 border-b border-amber-400/25 bg-amber-400/[0.06] space-y-2">
              <p className="text-xs text-amber-200/90 font-medium">
                This model needs your lore sent to a host that keeps it
              </p>
              <p className="text-[11px] leading-relaxed text-white/65">
                <span className="font-mono text-white/80">{confirming}</span> is free because the
                providers serving it retain prompts, often to train on. Vault blocks that by
                default. Every question sends your campaign material — session logs, character
                notes, anything in your lore folder — to that host, and what they do with it is
                outside Vault's control.
              </p>
              <p className="text-[11px] leading-relaxed text-white/45">
                This applies to this one model. Everything else stays on the privacy floor, and
                picking a different model here ends it.
              </p>
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void allowSharing(confirming)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-amber-400/40 bg-amber-400/15 text-amber-100 hover:bg-amber-400/25 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Allow for this model"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/60 hover:text-white/90"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="overflow-y-auto">
            {fetching && (
              <p className="flex items-center gap-2 px-3 py-3 text-xs text-white/40">
                <Loader2 size={12} className="animate-spin" /> Loading prices…
              </p>
            )}
            {groups.length === 0 && !fetching && (
              <p className="px-3 py-4 text-xs text-white/40">No models match “{query}”.</p>
            )}
            {hidden > 0 && !query && (
              <p className="px-3 py-2 text-[10px] text-white/30 border-b border-white/5">
                {hidden} model{hidden === 1 ? "" : "s"} hidden — not text-only, or no longer offered.
                Re-run “Test which work” to refresh.
              </p>
            )}

            {groups.map(g => {
              const isOpen = searching || expanded === g.vendor;
              return (
                <div key={g.vendor} className="border-b border-white/5 last:border-b-0">
                  <button
                    type="button"
                    title={vendorTooltip(g.label, g.models)}
                    onClick={() => setExpanded(cur => (cur === g.vendor ? null : g.vendor))}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 text-left"
                  >
                    {isOpen ? (
                      <ChevronDown size={13} className="text-white/40 shrink-0" />
                    ) : (
                      <ChevronRight size={13} className="text-white/40 shrink-0" />
                    )}
                    <span className="text-sm text-white/85 flex-1 truncate">{g.label}</span>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", TIER_STYLE[g.bestTier].cls)}>
                      {g.bestTier === "free" ? "has free" : TIER_STYLE[g.bestTier].label}
                    </span>
                    <span className="text-[10px] text-white/30 tabular-nums w-8 text-right">{g.models.length}</span>
                  </button>

                  {isOpen &&
                    g.models.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        disabled={m.unavailable}
                        // Cost lives here rather than on the row: visible
                        // enough to find, quiet enough not to crowd 400 rows.
                        title={m.unavailable && m.reason ? m.reason : costTooltip(m)}
                        onClick={() => (needsConsent(m) ? setConfirming(m.id) : commit(m.id))}
                        className={cn(
                          "w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-left hover:bg-white/5",
                          m.unavailable && "opacity-40 cursor-not-allowed hover:bg-transparent"
                        )}
                      >
                        {m.id === value ? (
                          <Check size={12} className="text-gold-400 shrink-0" />
                        ) : (
                          <span className="w-3 shrink-0" />
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white/80 font-mono truncate">{m.id}</span>
                            {m.isAlias && (
                              <span className="shrink-0 text-[9px] px-1 py-px rounded border border-white/15 text-white/40">
                                latest
                              </span>
                            )}
                            {/* Consent, once given, stays visible — a user
                                should be able to see which models are set to
                                share without opening settings. */}
                            {optedIn.includes(m.id) && (
                              <span
                                title="You allowed data sharing for this model. Its host keeps your prompts."
                                className="shrink-0 text-[9px] px-1 py-px rounded border border-amber-400/40 text-amber-300/90"
                              >
                                sharing
                              </span>
                            )}
                          </span>
                          {/* One number, not four: the input rate dominates a
                              lore question's bill. The rest is on hover. */}
                          {m.inputPerM !== undefined && (
                            <span className="block text-[10px] text-white/35">
                              {m.inputPerM === 0 ? "No charge" : `${formatRatePerM(m.inputPerM)}/M`}
                              {" · "}
                              {formatContext(m.contextLength)} context
                            </span>
                          )}
                        </span>
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded border shrink-0", TIER_STYLE[m.tier].cls)}>
                          {TIER_STYLE[m.tier].label}
                        </span>
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
