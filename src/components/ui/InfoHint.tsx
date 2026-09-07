// InfoHint — the "tell me more" affordance that keeps settings copy to one
// line. Ported from the sibling project (same API, ember hover instead of
// amethyst).
//
// Why click-to-open rather than a hover tooltip: the content this app needs
// to explain is long (trade-offs, cost caveats, provider quirks). Hover
// tooltips are the wrong container for a paragraph — unreachable on touch,
// gone when the pointer moves toward them, unable to hold a link. A small
// ⓘ button toggling a readable panel is the pattern settings pages
// converge on for exactly this reason.
//
// The rule this component enforces: a card shows ONE line of plain
// language, and everything else — rationale, measurements, caveats — lives
// behind the ⓘ. Nothing is deleted, just folded away until asked for.
//
// Accessibility: real <button> trigger, aria-expanded, labelled panel,
// Escape to close, click-outside to close.

import React, { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "../../lib/utils";

type Props = {
  /** Short accessible name, e.g. "About retrieval thresholds". Screen
   *  readers announce this on the trigger; sighted users see the icon. */
  label: string;
  children: React.ReactNode;
  /** Which side the panel opens toward. Use 'left' when the trigger sits
   *  near the right edge so the panel doesn't overflow. */
  align?: "left" | "right";
  className?: string;
};

export function InfoHint({ label, children, align = "right", className }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointerDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className={cn("relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(v => !v)}
        className={cn(
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
          "text-foreground/50 transition-colors hover:text-primary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
          open && "text-primary"
        )}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          id={panelId}
          role="note"
          className={cn(
            "absolute top-6 z-50 w-80 rounded-md border border-border/40 bg-surface-elevated p-3",
            "text-left text-xs font-normal leading-relaxed text-foreground/75 shadow-lg",
            "normal-case tracking-normal",
            align === "right" ? "left-0" : "right-0"
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
