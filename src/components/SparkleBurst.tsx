import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { SparkleIcon } from "./TtrpgIcons";

// Eight sparkles bursting outward in a star pattern. Triggered by a state
// flag from the parent (e.g. saveSuccess). Auto-clears via AnimatePresence.

interface SparkleBurstProps {
  active: boolean;
}

const POSITIONS = [
  { dx:  60, dy:   0, scale: 1.1, delay: 0.00, size: 18 },
  { dx:  42, dy:  42, scale: 0.9, delay: 0.04, size: 14 },
  { dx:   0, dy:  60, scale: 1.0, delay: 0.08, size: 16 },
  { dx: -42, dy:  42, scale: 0.85, delay: 0.04, size: 12 },
  { dx: -60, dy:   0, scale: 1.0, delay: 0.00, size: 16 },
  { dx: -42, dy: -42, scale: 0.9, delay: 0.04, size: 14 },
  { dx:   0, dy: -60, scale: 1.1, delay: 0.08, size: 18 },
  { dx:  42, dy: -42, scale: 0.95, delay: 0.04, size: 14 },
];

export function SparkleBurst({ active }: SparkleBurstProps) {
  return (
    <AnimatePresence>
      {active && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10" aria-hidden="true">
          {POSITIONS.map((p, i) => (
            <motion.div
              key={i}
              initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
              animate={{
                x: p.dx,
                y: p.dy,
                opacity: [0, 1, 1, 0],
                scale: [0, p.scale, p.scale, 0],
                rotate: [0, 180],
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, delay: p.delay, ease: "easeOut" }}
              className="absolute text-gold-300"
            >
              <SparkleIcon size={p.size} />
            </motion.div>
          ))}
        </div>
      )}
    </AnimatePresence>
  );
}
