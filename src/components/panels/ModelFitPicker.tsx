// "Which model should I use?" — answered by asking what you care about.
//
// The grades say what each model is good at. They do not say which to pick,
// because the three axes genuinely trade off: the cheapest model in the table
// invents campaign facts, and the best narrator costs seven times the cheapest
// that works. Only the person paying can weigh that.
//
// Two controls, one underlying set of weights:
//
//   TICKBOXES  three boxes, seven useful combinations, each with a name
//   TRIANGLE   the same choice continuously, with every measured model plotted
//              at its OWN strengths — so the trade-off is visible rather than
//              asserted, and you can see there is nothing in the middle
//
// Ticking moves the marker; dragging the marker is ticking with weights in
// between. Neither is the real control, which is why both stay in sync.

import { useMemo, useRef, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  CORNERS,
  PRESETS,
  PRIORITIES,
  PRIORITY_BLURB,
  PRIORITY_LABEL,
  pointFromWeights,
  rankByFit,
  weightsFromPoint,
  weightsFromPriorities,
  type FitCandidate,
  type Priority,
} from "../../server/llm/model-fit";

/** Padding inside the SVG viewbox so corner labels are not clipped. */
const PAD = 26;
const SIZE = 240;

const DOT_COLOUR: Record<string, string> = {
  "A+": "#34d399",
  A: "#4ade80",
  B: "#a3e635",
  C: "#fbbf24",
  "C-": "#fb923c",
  D: "#f87171",
  "D-": "#ef4444",
  F: "#dc2626",
};

/** Mirrors ContextRequirement in src/server/knowledge/context-requirement.ts.
 *  Whether a window is big enough is a fact about this install, not about the
 *  model, so the picker states which install it is talking about. */
export interface ContextInfo {
  tokens: number;
  regime: "folder" | "vault-full" | "vault-mapped";
  notesTotal: number;
  selectivity: number;
  coarseNotes: number;
  summary: string;
  /** What the vault's organisation is buying — the one figure on this panel
   *  the user can actually change. Null when there is nothing to say. */
  selectivityNote: string | null;
  degraded?: { reason: string; fix: string };
  couldBeTokens?: number;
}

/** How much room this install leaves a model, in the terms the hover card
 *  uses. Mirrors Headroom in src/server/llm/model-fit.ts. */
const HEADROOM_NOTE: Record<string, string> = {
  tight: "Only just fits your lore — little room to search, and less to answer in.",
  workable: "Comfortable room for your lore.",
  ample: "Far more room than your lore needs.",
};

interface Props {
  candidates: FitCandidate[];
  context?: ContextInfo;
  /** The model currently in use. Marked in the triangle and the list, so the
   *  panel answers "which am I on?" without the user going to look. */
  selectedModel?: string;
  /** Absent when picking cannot do anything — OpenRouter is not the active
   *  provider — in which case the dots stay informative but inert rather
   *  than saving a setting that would not take effect. */
  onPick?: (modelId: string) => void;
}

const kTokens = (n: number): string => `${Math.round(n / 1000)}k`;

const toSvg = (p: { x: number; y: number }) => ({
  cx: PAD + p.x * SIZE,
  cy: PAD + p.y * SIZE,
});

export function ModelFitPicker({ candidates, context, selectedModel, onPick }: Props) {
  const [ticked, setTicked] = useState<Priority[]>(["cost", "accuracy", "maturity"]);
  const [custom, setCustom] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const weights = useMemo(
    () => (custom ? weightsFromPoint(custom.x, custom.y) : weightsFromPriorities(ticked)),
    [custom, ticked]
  );
  const ranked = useMemo(
    () => rankByFit(candidates, weights, context?.tokens),
    [candidates, weights, context?.tokens]
  );
  const marker = custom ?? pointFromWeights(weights);

  const toggle = (p: Priority): void => {
    // Dragging leaves the boxes stale; ticking is a fresh statement of intent,
    // so it takes over.
    setCustom(null);
    setTicked(cur => (cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p]));
  };

  const onSvgClick = (e: React.MouseEvent<SVGSVGElement>): void => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * (SIZE + PAD * 2);
    const y = ((e.clientY - rect.top) / rect.height) * (SIZE + PAD * 2);
    setCustom({ x: (x - PAD) / SIZE, y: (y - PAD) / SIZE });
  };

  const corner = (p: Priority) => toSvg(CORNERS[p]);
  const a = corner("accuracy");
  const c = corner("cost");
  const m = corner("maturity");
  const hovered = ranked.find(r => r.id === hover);
  const top = ranked.filter(r => !r.contextTooSmall)[0];

  const activePreset = custom
    ? null
    : PRESETS.find(
        p => p.priorities.length === ticked.length && p.priorities.every(x => ticked.includes(x))
      );

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white/90">Find the model for you</h3>
        <p className="text-[11px] leading-relaxed text-white/50 mt-1">
          Tick what matters, or click inside the triangle for a mix. Each dot is a model, placed at
          its own strengths — the closer to a corner, the better it is at that one thing.
        </p>
      </div>

      {context && (
        // Which models are even eligible depends on how much lore reaches the
        // prompt here, and that varies by an order of magnitude between a
        // whole-corpus concatenation and a mapped vault. Saying so is what
        // stops the same warning meaning two different things.
        <div className="rounded-xl border border-white/10 bg-black/25 p-2.5 text-[11px] leading-relaxed">
          <p className="text-white/55">{context.summary}</p>
          {context.selectivityNote && (
            // Deliberately above the model list: how well the lore is filed
            // changes which models are viable at all, and it is the only
            // thing on this panel the user can go and improve.
            <p className="mt-1.5 text-white/45">{context.selectivityNote}</p>
          )}
          {context.degraded && (
            <p className="mt-1.5 flex items-start gap-1.5 text-warning">
              <TriangleAlert size={12} className="mt-px shrink-0" />
              <span>
                {context.degraded.reason} {context.degraded.fix}
                {context.couldBeTokens && (
                  <>
                    {" "}
                    That would bring the requirement down to about {kTokens(context.couldBeTokens)},
                    putting smaller models back in reach.
                  </>
                )}
              </span>
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {PRIORITIES.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => toggle(p)}
            title={PRIORITY_BLURB[p]}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors",
              !custom && ticked.includes(p)
                ? "border-gold-400/50 bg-gold-400/10 text-gold-100"
                : "border-white/10 text-white/60 hover:border-white/20"
            )}
          >
            <span
              className={cn(
                "flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[9px]",
                !custom && ticked.includes(p) ? "border-gold-400/60 bg-gold-400/30" : "border-white/20"
              )}
            >
              {!custom && ticked.includes(p) ? "✓" : ""}
            </span>
            {PRIORITY_LABEL[p]}
          </button>
        ))}
      </div>

      {activePreset && (
        <p className="text-[11px] text-white/45">
          <span className="text-white/70">{activePreset.label}</span> — {activePreset.hint}
        </p>
      )}

      <div className="flex flex-col gap-4 sm:flex-row">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIZE + PAD * 2} ${SIZE + PAD * 2}`}
          onClick={onSvgClick}
          // self-start, or the flex row stretches the SVG to the height of
          // the column beside it. Stretching re-centres the drawing inside a
          // letterboxed box, which moves every dot whenever that column
          // changes height — including the height change hovering a dot
          // causes. The dot slides out from under the cursor, hover drops,
          // the column shrinks, and the whole thing oscillates.
          className="w-full max-w-[19rem] shrink-0 self-start cursor-crosshair select-none"
          role="img"
          aria-label="Model strengths plotted by cost, accuracy and mature-content handling"
        >
          <polygon
            points={`${a.cx},${a.cy} ${m.cx},${m.cy} ${c.cx},${c.cy}`}
            fill="rgba(255,255,255,0.03)"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={1}
          />
          {/* Corner labels sit outside the shape so they never overlap a dot. */}
          <text x={a.cx} y={a.cy - 9} textAnchor="middle" className="fill-white/50" fontSize="10">
            Never invents
          </text>
          <text x={c.cx - 2} y={c.cy + 16} textAnchor="start" className="fill-white/50" fontSize="10">
            Runs cheap
          </text>
          <text x={m.cx + 2} y={m.cy + 16} textAnchor="end" className="fill-white/50" fontSize="10">
            Dark themes
          </text>

          {ranked.map(r => {
            const p = toSvg(r.position);
            const isHover = hover === r.id;
            return (
              <g key={r.id}>
                {/* First child: SVG takes <title> as the element's accessible
                    name, and only honours it in that position. */}
                <title>{r.id}</title>
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r={isHover ? 7 : 5}
                  fill={DOT_COLOUR[r.grades.overall ?? "F"] ?? "#888"}
                  stroke={r.contextTooSmall ? "#f59e0b" : "rgba(0,0,0,0.5)"}
                  strokeWidth={r.contextTooSmall ? 2 : 1}
                  strokeDasharray={r.contextTooSmall ? "2 2" : undefined}
                  opacity={hover && !isHover ? 0.35 : 0.95}
                  className="transition-opacity"
                  pointerEvents="none"
                />
                {r.id === selectedModel && (
                  // The one in use, marked where the eye already is rather
                  // than only in a list somewhere else on the page.
                  <circle
                    cx={p.cx}
                    cy={p.cy}
                    r={9}
                    fill="none"
                    stroke="var(--color-gold-400)"
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                )}
                {/* The hit target is a separate, FIXED-radius circle. Hit-
                    testing the visible dot means the hover region changes
                    size the moment it is hovered, and a cursor near the old
                    edge then flickers in and out of it. Also fatter than the
                    dot, because a 5px target is a hard thing to hold. */}
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r={10}
                  fill="transparent"
                  className={onPick ? "cursor-pointer" : "cursor-default"}
                  onMouseEnter={() => setHover(r.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={e => {
                    // A dot is a model, not a position — clicking one should
                    // select it, not move the marker underneath it.
                    e.stopPropagation();
                    onPick?.(r.id);
                  }}
                />
              </g>
            );
          })}

          <g pointerEvents="none">
            <circle
              cx={PAD + marker.x * SIZE}
              cy={PAD + marker.y * SIZE}
              r={9}
              fill="none"
              stroke="rgba(255,255,255,0.85)"
              strokeWidth={1.5}
            />
            <circle cx={PAD + marker.x * SIZE} cy={PAD + marker.y * SIZE} r={2} fill="white" />
          </g>
        </svg>

        <div className="flex-1 min-w-0 space-y-2">
          {/* Fixed height, always rendered. The detail card is taller than the
              hint it replaces, and letting the column grow on hover reflows
              everything above the dots — which is what made hovering feel
              like the panel was fighting back. */}
          <div className="h-[4.75rem] rounded-lg border border-white/10 bg-black/30 p-2.5">
            {hovered ? (
              <>
                <p className="flex items-center gap-1.5 font-mono text-[11px] text-white/85">
                  <span className="truncate">{hovered.id}</span>
                  {hovered.id === selectedModel ? (
                    <span className="shrink-0 rounded bg-gold-400/15 px-1 font-sans text-[9px] uppercase tracking-wider text-gold-200">
                      in use
                    </span>
                  ) : (
                    onPick && (
                      <span className="shrink-0 font-sans text-[10px] text-white/35">click to use</span>
                    )
                  )}
                </p>
                <p className="mt-1 text-[11px] text-white/55">
                  cost {hovered.grades.cost} · accuracy {hovered.grades.accuracy} · dark themes{" "}
                  {hovered.grades.maturity} · overall {hovered.grades.overall}
                </p>
                {hovered.contextTooSmall ? (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-warning">
                    <TriangleAlert size={11} className="shrink-0" />
                    {context
                      ? `Too small for your lore — you need about ${kTokens(context.tokens)}.`
                      : "Context window too small to hold a lore prompt."}
                  </p>
                ) : (
                  hovered.headroom && (
                    <p
                      className={cn(
                        "mt-1 text-[11px]",
                        hovered.headroom === "tight" ? "text-warning" : "text-white/40"
                      )}
                    >
                      {HEADROOM_NOTE[hovered.headroom]}
                    </p>
                  )
                )}
              </>
            ) : (
              <p className="text-[11px] text-white/35">Hover a dot to see which model it is.</p>
            )}
          </div>

          <ol className="space-y-1">
            {ranked.slice(0, 6).map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  onMouseEnter={() => setHover(r.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onPick?.(r.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] hover:bg-white/5",
                    r.contextTooSmall && "opacity-50"
                  )}
                >
                  <span className="w-3 text-white/30">{i + 1}</span>
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: DOT_COLOUR[r.grades.overall ?? "F"] }}
                  />
                  <span
                    className={cn(
                      "flex-1 truncate font-mono",
                      r.id === selectedModel ? "text-gold-200" : "text-white/75"
                    )}
                  >
                    {r.id}
                  </span>
                  {r.id === selectedModel && (
                    <Check size={11} className="shrink-0 text-gold-300" aria-label="in use" />
                  )}
                  {r.contextTooSmall && <TriangleAlert size={10} className="shrink-0 text-warning" />}
                  <span className="tabular-nums text-white/40">{Math.round(r.score * 100)}%</span>
                </button>
              </li>
            ))}
          </ol>

          {top && (
            <p className="text-[11px] leading-relaxed text-white/45">
              Best match: <span className="text-white/75">{top.id}</span>. Only models measured on
              all three axes appear here.
              {!onPick && " Switch the active provider to OpenRouter to select one from here."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
