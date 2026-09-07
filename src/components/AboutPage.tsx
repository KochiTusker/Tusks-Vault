import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Coffee, Heart, ExternalLink, MessageSquare } from "lucide-react";
import { RuneDivider } from "./RuneDivider";

const BMC_URL = "https://buymeacoffee.com/kochitusker";
// Shared with Tusk's Tomes on purpose: one inbox is read, two are not, and a
// report about either project usually turns out to be about the pair of them.
// This is the only feedback route the project has — there is no support desk —
// so the copy beside the button says so rather than implying a queue.
const FEEDBACK_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdxdqOhb1SQvI3fs50gMJv_Cesh2MuxUm95QO2iZia5sFhyyQ/viewform?usp=header";

const CONVICTIONS: Array<{ title: string; body: string }> = [
  {
    title: "Local-first, not SaaS",
    body: "Your lore, your keys, your hardware. No subscription, no account, no rug-pull risk.",
  },
  {
    title: "AI as librarian, not author",
    body: "Tusk's Vault remembers what you wrote — it doesn't invent NPCs or generate plot. Creativity stays yours.",
  },
  {
    title: "Tools for tables, MIT-licensed",
    body: "Built for kitchen-table games and small Discord servers. Fork it, modify it, redistribute it — it's yours.",
  },
];

export function AboutPage() {
  // Read rather than hardcoded. The literal here said 0.1.0 for three releases
  // after that stopped being true, which is the failure mode of every version
  // string a human has to remember to bump.
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && typeof d?.version === "string") setVersion(d.version); })
      .catch(() => { /* the card falls back to a dash; a version is not worth an error state */ });
    return () => { live = false; };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="mb-8 flex items-start gap-6 flex-wrap">
        <motion.div
          initial={{ opacity: 0, scale: 0.6, rotate: -8 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 180, damping: 16 }}
          className="flex-shrink-0"
        >
          <img
            src="/kochi-tusker.png"
            alt="Tusk's Vault crest"
            width={96}
            height={96}
            className="w-24 h-24 object-contain drop-shadow-[0_4px_18px_oklch(0.78_0.20_55_/_0.35)]"
          />
        </motion.div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-4xl font-bold text-gold-300 tracking-wide mb-1">About Tusk's Vault</h2>
          <p className="font-serif text-parchment-100/70 italic">
            A fantasy scribe for tabletop campaigns — built by a Dungeon Master, for Dungeon Masters and players.
          </p>
        </div>
      </header>

      <RuneDivider />

      <section className="mb-10">
        <h3 className="font-display text-2xl text-gold-300/90 mb-3">Why this exists</h3>
        <ul className="space-y-2">
          {CONVICTIONS.map((c, i) => (
            <motion.li
              key={c.title}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.07, duration: 0.4 }}
              className="font-serif text-parchment-100/85 leading-relaxed flex gap-3"
            >
              <span className="text-gold-400/70 flex-shrink-0">·</span>
              <span><strong className="text-gold-200">{c.title}.</strong> {c.body}</span>
            </motion.li>
          ))}
        </ul>
      </section>

      <RuneDivider />

      <section className="mb-10">
        <h3 className="font-display text-2xl text-gold-300/90 mb-3">The creator</h3>
        <p className="font-serif text-parchment-100/85 leading-relaxed">
          Tusk's Vault is built by <a href="https://github.com/KochiTusker" target="_blank" rel="noopener noreferrer" className="text-gold-300 underline">@KochiTusker</a>{" "}
          — a Dungeon Master who got tired of losing thirty minutes a session digging through campaign notes.
        </p>
        <p className="font-serif text-parchment-100/70 italic mt-3">
          Contributions, bug reports, and feedback welcome at{" "}
          <a href="https://github.com/KochiTusker/Tusks-Vault" target="_blank" rel="noopener noreferrer" className="text-gold-300 underline">
            github.com/KochiTusker/Tusks-Vault
          </a>.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
        <a
          href="https://github.com/KochiTusker/Tusks-Vault"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 p-4 bg-ink-800/40 border border-gold-400/20 hover:border-gold-400/50 rounded-xl transition-colors gold-hover"
        >
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gold-400/60">Source</p>
            <p className="font-serif text-gold-200 text-sm">GitHub repository</p>
          </div>
          <ExternalLink size={16} className="text-gold-400/60" />
        </a>
        <a
          href="https://opensource.org/license/mit/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 p-4 bg-ink-800/40 border border-gold-400/20 hover:border-gold-400/50 rounded-xl transition-colors gold-hover"
        >
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gold-400/60">License</p>
            <p className="font-serif text-gold-200 text-sm">MIT — fully open source</p>
          </div>
          <ExternalLink size={16} className="text-gold-400/60" />
        </a>
        <div className="flex items-center justify-between gap-3 p-4 bg-ink-800/40 border border-gold-400/20 rounded-xl">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gold-400/60">Version</p>
            <p className="font-serif text-gold-200 text-sm">{version ? `v${version}` : "—"}</p>
          </div>
        </div>
      </section>

      {/* Feedback and support, kept subtle at the foot of the page.
          Feedback sits FIRST and coffee second on purpose: the thing the
          project actually needs from an early user is a report, not a pound. */}
      <motion.footer
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.5 }}
        className="text-center pt-8 border-t border-gold-400/15"
      >
        <p className="font-serif text-parchment-100/60 italic text-sm mb-4 flex items-center justify-center gap-2">
          <Heart size={14} className="text-crimson-400" />
          Tell me what broke, what you wish it did, or buy me a coffee.
          <Heart size={14} className="text-crimson-400" />
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href={FEEDBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold-400/15 hover:bg-gold-400/25 border border-gold-400/40 text-parchment-100 font-semibold text-sm rounded-lg transition-all hover:scale-[1.03]"
          >
            <MessageSquare size={16} />
            Share feedback
          </a>
          <a
            href={BMC_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#FFDD00]/85 hover:bg-[#FFDD00] text-black font-bold text-sm rounded-lg transition-all hover:scale-[1.03]"
          >
            <Coffee size={16} />
            Buy me a coffee
          </a>
        </div>
        <p className="font-serif text-[11px] text-parchment-100/40 mt-3">
          Feedback goes to a shared form for Tusk's Vault and Tusk's Tomes — it gets read, and it
          gets things seen faster than anything else. It isn't a support desk, so nothing is
          promised. Tusk's Vault is MIT-licensed and free to use forever; donations are entirely
          optional.
        </p>
      </motion.footer>
    </motion.div>
  );
}
