import React, { useState } from "react";
import { motion } from "motion/react";
import { Upload } from "lucide-react";

// Small "publisher's mark" badge in the corner of the header. Uses the user's
// uploaded mascot image at /kochi-tusker.png if present; otherwise shows a
// dashed placeholder with an explicit hint that they need to drop the file
// into public/ (so the fallback never gets mistaken for the actual mascot).

interface PublisherMarkProps {
  size?: number;
  /** Optional callback fired on each click of the publisher mark. App-level
   *  code uses this for the 5-tap dev-mode unlock (Android-style). Casual
   *  users see a logo that just looks pretty; the maintainer taps it 5×
   *  to reveal the Updates card's dev-mode toggle. */
  onSecretTap?: () => void;
}

export function PublisherMark({ size = 72, onSecretTap }: PublisherMarkProps) {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6, rotate: -10 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={{ delay: 0.4, type: "spring", stiffness: 200, damping: 18 }}
      whileHover={{ scale: 1.06, rotate: 2, transition: { duration: 0.3 } }}
      onClick={onSecretTap}
      className={`relative flex flex-col items-center ${onSecretTap ? "cursor-pointer" : ""}`}
      title={logoFailed ? "Save your KochiTusker logo as public/kochi-tusker.png to show it here" : "KochiTusker"}
    >
      {logoFailed ? (
        <div
          className="rounded-full border-2 border-dashed border-gold-400/40 bg-ink-800/40 flex flex-col items-center justify-center text-center p-2"
          style={{ width: size, height: size }}
        >
          <Upload size={Math.max(14, size * 0.25)} className="text-gold-400/60 mb-0.5" />
          <span className="text-[7px] text-gold-400/60 leading-tight px-1">
            kochi-tusker.png
          </span>
        </div>
      ) : (
        <div
          className="rounded-full bg-gradient-to-br from-gold-400/30 to-crimson-500/20 border-2 border-gold-400/60 p-1 shadow-[0_0_24px_oklch(0.78_0.20_55_/_0.45)] overflow-hidden"
          style={{ width: size, height: size }}
        >
          <img
            src="/kochi-tusker.png"
            // alt="" because the visible "KochiTusker" caption below the
            // image already announces the brand to screen readers — a
            // non-empty alt would make the same name be read twice in a row.
            alt=""
            onError={() => setLogoFailed(true)}
            className="w-full h-full rounded-full object-cover"
          />
        </div>
      )}
      <span className="mt-1 text-[8px] tracking-[0.3em] uppercase text-gold-400/60 font-serif">KochiTusker</span>
    </motion.div>
  );
}
