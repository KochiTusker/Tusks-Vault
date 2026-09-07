import React, { createContext, useContext, useId, useRef, useState } from "react";
import { motion } from "motion/react";

// Custom headless-ish Tabs component, shared between Tusk's Vault and
// Tusk's Tomes so both apps render an identical top-bar strip. The visual
// language matches Tomes: a semi-transparent surface strip, Cinzel
// uppercase labels with wide tracking, and a lifted-background active
// chip with an amethyst rim. The chip itself uses framer-motion's
// `layoutId` so movement between tabs glides on a spring — Tomes' original
// Radix implementation used a plain CSS shadow; the spring is preserved
// because the user prefers Vault's animation feel.
//
// Public API mirrors Radix UI's Tabs (Tabs / TabsList / TabsTrigger /
// TabsContent) so callers can switch between this implementation and any
// shadcn-derived equivalent with a one-line import change.
//
// Modes:
//   - Controlled: pass `value` + `onValueChange`.
//   - Uncontrolled: pass `defaultValue` (component manages internal state;
//     `onValueChange` still fires if provided).
//
// Accessibility: WAI-ARIA tabs pattern. Each trigger has role="tab",
// aria-selected, aria-controls; the active trigger is the only tab-stop
// (tabIndex=0) and arrow keys move focus between triggers. The content
// panel gets role="tabpanel" + aria-labelledby and is focusable so
// screen-reader users can read it after activation.

interface TabsContextValue {
  value: string;
  onValueChange: (v: string) => void;
  rootId: string;
  registerTrigger: (value: string, el: HTMLButtonElement | null) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`${component} must be used inside <Tabs>`);
  return ctx;
}

interface TabsProps {
  /** Controlled value. Pass alongside `onValueChange`. */
  value?: string;
  /** Uncontrolled initial value. Used when `value` is not supplied. */
  defaultValue?: string;
  /** Fires whenever the active tab changes — controlled or uncontrolled. */
  onValueChange?: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({
  value: controlledValue,
  defaultValue,
  onValueChange,
  children,
  className = "",
}: TabsProps) {
  const rootId = useId();
  // Controlled vs uncontrolled: if a `value` prop is provided, the parent
  // owns the state; otherwise we maintain our own and just notify out.
  const [internalValue, setInternalValue] = useState<string>(defaultValue ?? "");
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;

  const handleValueChange = (v: string) => {
    if (!isControlled) setInternalValue(v);
    onValueChange?.(v);
  };

  // Ordered map of value → trigger element. Used by TabsList's arrow-key
  // handler to find the next/previous tab. Kept as a Map (insertion order
  // is the visual tab order).
  const triggersRef = useRef<Map<string, HTMLButtonElement>>(new Map());

  const registerTrigger = (val: string, el: HTMLButtonElement | null) => {
    if (el) {
      triggersRef.current.set(val, el);
    } else {
      triggersRef.current.delete(val);
    }
  };

  return (
    <TabsContext.Provider
      value={{ value, onValueChange: handleValueChange, rootId, registerTrigger }}
    >
      <div className={className} data-tabs-root>
        {React.Children.map(children, child => {
          // Inject triggersRef so TabsList can do arrow-key nav across siblings.
          if (
            React.isValidElement(child) &&
            (child.type as { displayName?: string }).displayName === "TabsList"
          ) {
            return React.cloneElement(child as React.ReactElement<TabsListProps>, {
              _triggersRef: triggersRef,
            });
          }
          return child;
        })}
      </div>
    </TabsContext.Provider>
  );
}

interface TabsListProps {
  children: React.ReactNode;
  className?: string;
  /** Internal: passed in by <Tabs>. Don't set this manually. */
  _triggersRef?: React.MutableRefObject<Map<string, HTMLButtonElement>>;
}

export function TabsList({ children, className = "", _triggersRef }: TabsListProps) {
  const ctx = useTabsContext("TabsList");

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!_triggersRef) return;
    const triggers: Array<[string, HTMLButtonElement]> = Array.from(_triggersRef.current.entries());
    if (triggers.length === 0) return;
    const currentIndex = triggers.findIndex(([v]) => v === ctx.value);
    let nextIndex = currentIndex;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % triggers.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + triggers.length) % triggers.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = triggers.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    const [nextValue, nextEl] = triggers[nextIndex];
    ctx.onValueChange(nextValue);
    nextEl.focus();
  }

  // Top-bar strip — semi-transparent card surface with an ember edge.
  // Matches Tomes' canonical TabsList look: `bg-card/60 border border-border`.
  return (
    <div
      role="tablist"
      onKeyDown={handleKeyDown}
      className={`relative inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-surface border border-border/40 ${className}`}
    >
      {children}
    </div>
  );
}
(TabsList as React.FC<TabsListProps>).displayName = "TabsList";

interface TabsTriggerProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function TabsTrigger({ value, children, className = "" }: TabsTriggerProps) {
  const ctx = useTabsContext("TabsTrigger");
  const ref = useRef<HTMLButtonElement | null>(null);
  const active = ctx.value === value;
  const tabId = `${ctx.rootId}-tab-${value}`;
  const panelId = `${ctx.rootId}-panel-${value}`;

  function setRef(el: HTMLButtonElement | null) {
    ref.current = el;
    ctx.registerTrigger(value, el);
  }

  // Cinzel display, uppercase, wide tracking — same typography as Tomes'
  // tab labels. Active state uses a lifted-surface chip (bg-background
  // + amethyst rim + soft glow) while inactive triggers stay muted. The
  // motion.span layoutId chip glides between tabs on a spring.
  return (
    <button
      ref={setRef}
      type="button"
      role="tab"
      id={tabId}
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      onClick={() => ctx.onValueChange(value)}
      className={`relative whitespace-nowrap px-4 py-1.5 font-display text-xs sm:text-sm tracking-[0.18em] uppercase rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
        active ? "text-foreground-strong" : "text-foreground/55 hover:text-foreground/85"
      } ${className}`}
    >
      {active && (
        <motion.span
          aria-hidden
          layoutId={`tab-indicator-${ctx.rootId}`}
          className="absolute inset-0 rounded-md bg-background border border-primary/40 shadow-glow-sm"
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        />
      )}
      <span className="relative z-10">{children}</span>
    </button>
  );
}
