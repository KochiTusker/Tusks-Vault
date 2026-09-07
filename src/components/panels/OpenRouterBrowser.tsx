// OpenRouter model browser.
//
// OpenRouter publishes its whole catalogue without auth, so — uniquely among
// the providers here — the app can show what a model costs, how much context
// it has, whether it filters prompts, and what its hosts do with your lore,
// all before a single call is made and before any key is pasted.
//
// A reference surface first: browsing costs nothing until the disclosure is
// opened (the catalogue is only fetched then), and rows deliberately show
// the properties that matter for THIS app — price per million (a Vault
// question ships the whole lore corpus, so input price dominates), context
// window (the corpus must fit), moderation (mature campaign content gets
// refused by moderated hosts), and reasoning leaks. "Use" hands the model
// to the active-channel picker via the same save path the Home dropdown
// uses.
import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { InfoHint } from "../ui/InfoHint";
import { cn } from "../../lib/utils";
import { costTooltip } from "../../lib/model-cost";
import { ModelFitPicker, type ContextInfo } from "./ModelFitPicker";

interface ModelRow {
  id: string;
  name: string;
  inputPerM: number;
  outputPerM: number;
  cachedInputPerM?: number;
  contextLength: number;
  maxCompletionTokens: number | null;
  isModerated: boolean;
  isFree: boolean;
  supportsImages: boolean;
  tieredPricing?: boolean;
  mandatoryReasoning?: boolean;
  leaksReasoning?: boolean;
  grades?: ModelGrades;
}

/** Mirrors src/server/llm/model-grades.ts. Three axes measuring different
 *  things, averaged — cost, whether answers can be trusted, and whether the
 *  model will narrate a grim setting instead of bowdlerising it. */
interface ModelGrades {
  cost: Grade;
  accuracy: Grade | null;
  maturity: Grade | null;
  overall: Grade | null;
  measured: Array<"cost" | "accuracy" | "maturity">;
  contextTooSmall?: boolean;
}

type Grade = "A+" | "A" | "B" | "C" | "C-" | "D" | "D-" | "F";

/** Green through red. A letter with no colour is a letter people have to
 *  read; a coloured one is one they can scan. */
const GRADE_STYLE: Record<Grade, string> = {
  "A+": "bg-emerald-400/15 text-emerald-300 border-emerald-400/30",
  A: "bg-green-400/10 text-green-300/90 border-green-400/25",
  B: "bg-green-400/10 text-green-300/80 border-green-400/20",
  C: "bg-amber-400/10 text-amber-300/90 border-amber-400/25",
  "C-": "bg-amber-400/10 text-amber-300/80 border-amber-400/20",
  D: "bg-orange-400/10 text-orange-300/90 border-orange-400/25",
  "D-": "bg-orange-400/10 text-orange-300/80 border-orange-400/25",
  F: "bg-red-400/10 text-red-300/90 border-red-400/30",
};

function GradeChip({ grade, title }: { grade: Grade | null | undefined; title?: string }) {
  // An unmeasured axis shows a dash, not a guess. "We have not tested this"
  // and "this scored badly" must never look the same.
  if (!grade) {
    return (
      <span title={title ?? "Not measured yet"} className="text-white/25">
        —
      </span>
    );
  }
  return (
    <span
      title={title}
      className={cn("inline-block min-w-[2.1rem] rounded border px-1 py-px text-center font-mono text-[10px]", GRADE_STYLE[grade])}
    >
      {grade}
    </span>
  );
}

interface ProviderPolicy {
  name: string;
  trains: boolean;
  retains: boolean;
  retentionDays: number | null;
}

interface CatalogueResponse {
  fetchedAt: string;
  models: ModelRow[];
  policies: ProviderPolicy[];
  /** What this install's prompts actually need. Absent from an older cached
   *  response, so every consumer treats it as optional. */
  context?: ContextInfo;
}

type SortKey = "price" | "context" | "name" | "grade" | "maturity";

/** Best first. Only a handful of models have been through the suites, and the
 *  table is capped at 200 rows — without a way to sort by grade, a graded
 *  model can sit below the cut and the whole grading system is something you
 *  have to already know to search for. */
const GRADE_RANK: Record<string, number> = {
  "A+": 0, A: 1, B: 2, C: 3, "C-": 4, D: 5, "D-": 6, F: 7,
};

export function formatRate(perM: number): string {
  if (perM === 0) return "free";
  return `$${perM < 0.01 ? perM.toFixed(4) : perM.toFixed(2)}`;
}

export function formatTokens(n: number | null): string {
  if (n === null || n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

interface Props {
  /** Hands a model id to the active-channel save path. Omitted = browse-only. */
  onPickModel?: (id: string) => void;
  /** Whether OpenRouter is the currently active provider — "Use" only makes
   *  sense when a pick would actually be called. */
  openrouterActive: boolean;
  /** The model currently in use, so both surfaces can mark it rather than
   *  leaving the user to remember what they picked. */
  selectedModel?: string;
}

export function OpenRouterBrowser({ onPickModel, openrouterActive, selectedModel }: Props) {
  // Collapsed by default, and the catalogue is only fetched once the
  // disclosure is first opened — users who never open it never pay for the
  // request.
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CatalogueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("price");
  // Off by default: under the zero-retention privacy floor most :free
  // variants are unreachable, so listing them by default would advertise
  // models that error on use.
  const [showFree, setShowFree] = useState(false);
  const [testedOnly, setTestedOnly] = useState(false);
  const [unmoderatedOnly, setUnmoderatedOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/openrouter/models${refresh ? "?refresh=1" : ""}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (open && data === null && !loading) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    let out = data.models.filter(m => (showFree ? true : !m.isFree));
    // Cost is free to compute for the whole catalogue, so "has a grade" is
    // true of everything and means nothing. What the user is asking for here
    // is the models somebody actually ran the suites against, which is two
    // measured axes or more.
    if (testedOnly) out = out.filter(m => (m.grades?.measured.length ?? 0) >= 2);
    // OpenRouter has no per-request equivalent of Gemini's BLOCK_NONE:
    // moderation is a property of the HOST serving the model, not a
    // parameter a caller can set. So the only real control is which model
    // you pick, and until now that was a badge you had to spot rather than
    // something you could filter on.
    if (unmoderatedOnly) out = out.filter(m => !m.isModerated);
    if (q) out = out.filter(m => `${m.id} ${m.name}`.toLowerCase().includes(q));
    out = [...out].sort((a, b) => {
      if (sort === "price") return a.inputPerM - b.inputPerM || a.id.localeCompare(b.id);
      if (sort === "context") return b.contextLength - a.contextLength || a.id.localeCompare(b.id);
      // The maturity grade answers "will this model narrate a grim chronicle,
      // or hand back a bowdlerised summary" — the one axis that decides
      // whether a persona with an edge survives contact with the provider.
      // Ungraded sorts last, same rule as the overall grade: "not measured"
      // is information, not absence.
      if (sort === "maturity") {
        const ra = a.grades?.maturity ? GRADE_RANK[a.grades.maturity] : 99;
        const rb = b.grades?.maturity ? GRADE_RANK[b.grades.maturity] : 99;
        return ra - rb || a.inputPerM - b.inputPerM || a.id.localeCompare(b.id);
      }
      if (sort === "grade") {
        // Ungraded models sort after every graded one rather than being
        // hidden: "not measured" is information, not absence.
        const ra = a.grades?.overall ? GRADE_RANK[a.grades.overall] : 99;
        const rb = b.grades?.overall ? GRADE_RANK[b.grades.overall] : 99;
        return ra - rb || a.inputPerM - b.inputPerM || a.id.localeCompare(b.id);
      }
      return a.name.localeCompare(b.name);
    });
    return out;
  }, [data, query, sort, showFree, testedOnly, unmoderatedOnly]);

  const retainers = data ? data.policies.filter(p => p.retains || p.trains).length : 0;

  return (
    <details
      className="rounded-2xl border border-white/10 bg-black/30"
      open={open}
      onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer list-none px-5 py-4 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-white/70">
              OpenRouter model browser
            </h3>
            <p className="text-[11px] text-white/40 mt-0.5">
              Live prices, context windows and host data policies for the whole catalogue — no key needed to look.
            </p>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-white/30">{open ? "close" : "browse"}</span>
        </div>
      </summary>

      <div className="reveal-on-open border-t border-white/5 p-5">
        {loading && (
          <p className="flex items-center gap-2 py-6 text-sm text-white/50">
            <Loader2 size={14} className="animate-spin" /> Fetching the catalogue…
          </p>
        )}
        {error && (
          <p className="py-4 text-sm text-danger">
            Couldn't load the catalogue: {error}{" "}
            <button onClick={() => void load()} className="underline text-gold-300">
              Retry
            </button>
          </p>
        )}

        {data && !loading && (
          <>
            <div className="mb-4">
              <ModelFitPicker
                candidates={data.models
                  .filter(m => m.grades?.accuracy && m.grades?.maturity)
                  .map(m => ({ id: m.id, grades: m.grades!, contextLength: m.contextLength }))}
                context={data.context}
                selectedModel={selectedModel}
                // Same gate the table's "Use" button uses. Ungated, a click
                // would save an OpenRouter model while another provider is
                // active — a setting that quietly does nothing.
                onPick={openrouterActive && onPickModel ? onPickModel : undefined}
              />
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-44">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search models…"
                  className="w-full bg-black/40 border border-white/10 rounded-xl pl-8 pr-3 py-2 text-sm text-white focus:outline-none focus:border-gold-400/60"
                />
              </div>
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortKey)}
                className="bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-gold-400/60"
              >
                <option value="price">Cheapest input first</option>
                <option value="context">Largest context first</option>
                <option value="name">By name</option>
                <option value="grade">Best graded first</option>
                <option value="maturity">Least censorious first</option>
              </select>
              <label className="flex items-center gap-1.5 text-[11px] text-white/50 select-none">
                <input
                  type="checkbox"
                  checked={testedOnly}
                  onChange={e => setTestedOnly(e.target.checked)}
                  className="accent-gold-500"
                />
                developer tested
                <InfoHint label="What developer tested means" align="left">
                  The catalogue lists hundreds of models and every one of them gets a cost grade,
                  because price is public. Accuracy and mature-content handling had to be measured by
                  running the suites — so only a handful carry them. Tick this to hide everything that
                  has not been through the suites, leaving the models whose behaviour is actually
                  known rather than inferred from a price.
                </InfoHint>
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-white/50 select-none">
                <input
                  type="checkbox"
                  checked={unmoderatedOnly}
                  onChange={e => setUnmoderatedOnly(e.target.checked)}
                  className="accent-gold-500"
                />
                unmoderated only
                <InfoHint label="What unmoderated means" align="left">
                  Gemini takes a per-request safety setting, so Vault can switch its filters off
                  for you. OpenRouter has no equivalent — moderation belongs to the host serving
                  the model, and no parameter turns it off. Choosing the model IS the control, so
                  this hides every host that content-filters prompts on the way in. Useful for a
                  grim setting, or for a persona with a mouth on it. It is not the whole story:
                  an unmoderated host can still serve a model trained to decline, which is what
                  the maturity grade measures and what &ldquo;least censorious first&rdquo; sorts by.
                </InfoHint>
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-white/50 select-none">
                <input type="checkbox" checked={showFree} onChange={e => setShowFree(e.target.checked)} className="accent-gold-500" />
                show :free variants
                <InfoHint label="About free variants" align="left">
                  Free variants cost nothing, but every request from Vault routes only to hosts that
                  do not retain prompts — your lore corpus travels with every question — and today no
                  free variant runs on such a host. Listed free models will usually error with "no
                  endpoints found" until that changes.
                </InfoHint>
              </label>
              <button
                onClick={() => void load(true)}
                disabled={refreshing}
                className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[11px] font-bold text-white/60 transition-colors disabled:opacity-50"
                title="Refetch the catalogue (cached for 24h otherwise)"
              >
                <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Refresh
              </button>
            </div>

            <p className="mb-3 flex items-center gap-1.5 text-[11px] text-white/45">
              {retainers > 0 ? (
                <ShieldCheck size={12} className="text-success" />
              ) : (
                <ShieldAlert size={12} className="text-warning" />
              )}
              {data.policies.length} hosts in the directory, {retainers} of which retain or train on prompts —
              Vault's requests route only to the ones that do neither.
              <InfoHint label="Host data policies" align="left">
                <span className="block max-h-48 overflow-y-auto pr-1">
                  {data.policies
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(p => (
                      <span key={p.name} className="flex items-center justify-between gap-2 py-0.5">
                        <span>{p.name}</span>
                        <span className={p.retains || p.trains ? "text-warning" : "text-success"}>
                          {p.trains ? "trains" : p.retains ? `retains${p.retentionDays ? ` ${p.retentionDays}d` : ""}` : "zero retention"}
                        </span>
                      </span>
                    ))}
                </span>
              </InfoHint>
            </p>

            <div className="max-h-96 overflow-y-auto rounded-xl border border-white/5">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-ink-900">
                  <tr className="text-[10px] uppercase tracking-widest text-white/40">
                    <th className="px-3 py-2 font-bold">Model</th>
                    <th className="px-3 py-2 font-bold text-right">In /M</th>
                    <th className="px-3 py-2 font-bold text-right">Out /M</th>
                    <th className="px-3 py-2 font-bold text-right">Context</th>
                    <th className="px-3 py-2 font-bold text-center">Cost</th>
                    <th className="px-3 py-2 font-bold text-center">Accuracy</th>
                    <th className="px-3 py-2 font-bold text-center">Mature</th>
                    <th className="px-3 py-2 font-bold text-center">Overall</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map(m => (
                    <ModelTableRow
                      key={m.id}
                      model={m}
                      expanded={expanded === m.id}
                      onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
                      onPick={openrouterActive && onPickModel ? () => onPickModel(m.id) : undefined}
                    />
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <p className="py-8 text-center text-sm text-white/30">Nothing matches "{query}".</p>
              )}
              {rows.length > 200 && (
                <p className="border-t border-white/5 py-2 text-center text-[11px] text-white/30">
                  Showing the first 200 of {rows.length} — narrow the search for the rest.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

function ModelTableRow({
  model: m,
  expanded,
  onToggle,
  onPick,
}: {
  model: ModelRow;
  expanded: boolean;
  onToggle: () => void;
  onPick?: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        // The same hover contract as the picker: the table shows the rates,
        // the tooltip turns them into what one question actually costs.
        // Sharing the formatter is what stops the two surfaces quoting
        // different numbers for the same model.
        title={costTooltip(m)}
        className={cn(
          "cursor-pointer border-t border-white/5 transition-colors hover:bg-white/[0.04]",
          expanded && "bg-white/[0.04]"
        )}
      >
        <td className="px-3 py-2">
          <span className="font-mono text-gold-200/90">{m.id}</span>
          <span className="ml-2 inline-flex items-center gap-1 align-middle">
            {m.isModerated && (
              <span title="Moderated host — mature campaign content may be refused" className="text-warning">
                <ShieldAlert size={11} />
              </span>
            )}
            {m.leaksReasoning && (
              <span title="Measured writing its reasoning into replies — deliberation may appear in answers" className="text-danger">
                <TriangleAlert size={11} />
              </span>
            )}
            {m.isFree && (
              <span className="rounded bg-white/10 px-1 text-[9px] uppercase tracking-wider text-white/50">free</span>
            )}
          </span>
        </td>
        <td className="px-3 py-2 text-right font-mono text-white/70">{formatRate(m.inputPerM)}</td>
        <td className="px-3 py-2 text-right font-mono text-white/70">{formatRate(m.outputPerM)}</td>
        <td className="px-3 py-2 text-right font-mono text-white/70">{formatTokens(m.contextLength)}</td>
        <td className="px-3 py-2 text-center">
          <GradeChip grade={m.grades?.cost} title="What it charges, against the Gemini flash benchmark." />
        </td>
        <td className="px-3 py-2 text-center">
          <GradeChip
            grade={m.grades?.accuracy}
            title={
              m.grades?.accuracy
                ? "Citation discipline: finds and cites the right fact, declines when the lore does not say, surfaces contradictions, quotes exactly. Measured twice; a case counts only if it held both times."
                : "Not measured yet — this model has not been through the accuracy suite."
            }
          />
        </td>
        <td className="px-3 py-2 text-center">
          <GradeChip
            grade={m.grades?.maturity}
            title={
              m.grades?.maturity
                ? "Will it narrate a grim campaign: graphic violence, fresh profanity, a cruel point of view, gallows humour, grim register unprompted, adult themes. An axis counts only if it delivered in every run."
                : "Not measured yet — this model has not been through the mature-content suite."
            }
          />
        </td>
        <td className="px-3 py-2 text-center">
          <GradeChip
            grade={m.grades?.overall}
            title={
              m.grades?.overall
                ? `Average of ${m.grades.measured.join(", ")}.` +
                  (m.grades.contextTooSmall
                    ? " Its context window is too small to hold a lore prompt, whatever it scored."
                    : "")
                : "Only cost is known for this model — an overall grade from one axis would read as a verdict on all three."
            }
          />
          {m.grades?.contextTooSmall && (
            // The grades cannot see this, and it outranks all three: a model
            // that cannot fit one retrieved question is not a candidate,
            // however well it narrates.
            <span title="Context window too small to hold a lore prompt" className="ml-1 text-warning">
              <TriangleAlert size={10} className="inline" />
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          {onPick && (
            <button
              onClick={e => {
                e.stopPropagation();
                onPick();
              }}
              className="rounded-lg bg-gold-500/90 px-2.5 py-1 text-[10px] font-bold text-ink-950 hover:bg-gold-400 transition-colors"
              title="Set as the active model (saves immediately)"
            >
              Use
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-white/5 bg-black/30">
          <td colSpan={9} className="px-4 py-3 text-[11px] leading-relaxed text-white/60">
            <span className="text-white/85 font-medium">{m.name}</span>
            <span className="mx-2 text-white/20">·</span>
            output ceiling {formatTokens(m.maxCompletionTokens)}
            {m.cachedInputPerM !== undefined && (
              <>
                <span className="mx-2 text-white/20">·</span>
                cached input {formatRate(m.cachedInputPerM)}/M
              </>
            )}
            {m.supportsImages && (
              <>
                <span className="mx-2 text-white/20">·</span>
                reads images
              </>
            )}
            {m.tieredPricing && (
              <>
                <span className="mx-2 text-white/20">·</span>
                <span className="text-warning">
                  price rises past a prompt-length threshold — a large lore corpus will cross it
                </span>
              </>
            )}
            {m.mandatoryReasoning && (
              <>
                <span className="mx-2 text-white/20">·</span>
                always spends reasoning tokens (billed as output)
              </>
            )}
            {m.isModerated && (
              <div className="mt-1 text-warning">
                Moderated host: prompts are content-filtered — mature campaign material may be refused.
              </div>
            )}
            {m.leaksReasoning && (
              <div className="mt-1 text-danger">
                Measured writing untagged deliberation into its replies; there is no reliable way to strip
                it. Prefer a different model for clean prose.
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
