import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";

// Card whose body expands with a dramatic, theme-appropriate animation:
//   - the chevron rotates 180° with a spring overshoot
//   - the body unfurls (scale-Y from a top anchor) while the rune-trace
//     gradient fades in from the left, simulating a sigil being drawn
//   - the card itself glows ember while expanded

interface ExpandableCardProps {
  title: React.ReactNode;
  defaultOpen?: boolean;
  /** Optional small chip / tag shown next to the title (e.g. provider name). */
  pill?: React.ReactNode;
  /** Optional emoji or small icon at the start of the row. */
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function ExpandableCard({ title, defaultOpen = false, pill, icon, children }: ExpandableCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <motion.div
      layout
      transition={{ layout: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } }}
      className={`relative rounded-2xl border overflow-hidden transition-shadow ${
        open
          ? "bg-gradient-to-br from-ink-800/60 to-ink-900/60 border-gold-400/50 shadow-[0_0_28px_oklch(0.78_0.20_55_/_0.35)]"
          : "bg-ink-800/30 border-gold-400/20 hover:border-gold-400/40"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 text-left p-5 cursor-pointer group"
      >
        {icon && <span className="flex-shrink-0 text-xl">{icon}</span>}
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg font-semibold text-gold-200 leading-tight">
            {title}
          </h3>
        </div>
        {pill && <span className="flex-shrink-0">{pill}</span>}
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 16 }}
          className="flex-shrink-0 text-gold-400 group-hover:text-gold-300"
        >
          <ChevronDown size={22} />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
              opacity: { duration: 0.35, delay: 0.05 },
            }}
            className="overflow-hidden"
          >
            <motion.div
              initial={{ scaleY: 0.85, y: -6, originY: 0 }}
              animate={{ scaleY: 1, y: 0 }}
              exit={{ scaleY: 0.9, y: -4 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="px-5 pb-5 -mt-1 relative"
            >
              {/* Faux ink-rule separator unfurling left-to-right */}
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="origin-left h-px bg-gradient-to-r from-gold-400/60 via-gold-400/30 to-transparent mb-4"
              />
              <div className="font-serif text-parchment-100/85 leading-relaxed text-[15px]">
                {children}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
