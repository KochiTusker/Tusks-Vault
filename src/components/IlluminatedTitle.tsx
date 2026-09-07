import React from "react";
import { motion } from "motion/react";

// "Tusk's Vault" with a per-character write-in animation. Each letter fades
// up + scales in with a small stagger so it looks like the title is being
// inscribed onto the page. The .illuminated CSS class handles the gold
// gradient.
//
// Note: an earlier version animated `filter: blur(8px) -> blur(0px)` per
// character. Even though blur(0px) is technically a no-op, leaving filter
// declarations on every span kept the filter rendering pipeline active and
// caused the title to look subtly fuzzy in some browsers — especially when
// combined with the parent's own filter. We now animate opacity + transform
// only; the gold gradient stays crisp throughout.

interface IlluminatedTitleProps {
  text: string;
  className?: string;
}

export function IlluminatedTitle({ text, className = "" }: IlluminatedTitleProps) {
  const chars = Array.from(text);
  // Default size pulled to match Tusk's Tomes brand wordmark
  // (text-2xl / text-3xl) so the two sibling apps feel like the same
  // family. Pass `className` to override per call-site.
  return (
    <h1
      className={`illuminated text-2xl sm:text-3xl tracking-wide flex flex-wrap ${className}`}
      aria-label={text}
    >
      {chars.map((ch, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 18, scale: 0.75 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            delay: 0.1 + i * 0.05,
            duration: 0.55,
            ease: [0.22, 1, 0.36, 1],
          }}
          aria-hidden="true"
          style={{ whiteSpace: ch === " " ? "pre" : undefined, display: "inline-block" }}
        >
          {ch}
        </motion.span>
      ))}
    </h1>
  );
}
