import React from "react";
import { ScrollText } from "lucide-react";
import { IlluminatedTitle } from "./IlluminatedTitle";
import { PublisherMark } from "./PublisherMark";

// Slim top header for Tusk's Vault — mirrors Tusk's Tomes' layout: a single
// row with the brand mark + title on the left and the publisher's mark on
// the right, anchored above the main content. The wordmark uses the same
// IlluminatedTitle character-stagger entrance Tomes now uses; the lone
// "Fantasy Scribe" overline doubles as a small uppercase tag (parity with
// Tomes' campaign/session label cluster).
//
// Sized to match Tomes' header proportions: py-7 (~28px each side), title
// at text-2xl/3xl, sigil 48-56px. Old Vault header used py-10..14 and a
// 64-72px sigil; the slimmer version frees real estate for the actual
// content below.

interface HeaderProps {
  /** Forwarded to PublisherMark for the 5-tap dev-mode unlock. */
  onSecretTap?: () => void;
}

export function Header({ onSecretTap }: HeaderProps = {}) {
  return (
    <header className="relative border-b border-border/30">
      {/* Subtle rune-trace underline — drifting amethyst shimmer in place
          of a static seam, same idea as Tomes' .ornament-shimmer. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px rune-divider"
      />
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-primary font-mono text-xs tracking-[0.25em] uppercase">
            <ScrollText size={14} />
            <span>The Fantasy Scribe</span>
          </div>
          <IlluminatedTitle text="Tusk's Vault" />
          <p className="font-serif text-foreground/55 text-sm italic max-w-md">
            An archivist for your chronicle — local, source-grounded, and yours alone.
          </p>
        </div>
        <PublisherMark size={56} onSecretTap={onSecretTap} />
      </div>
    </header>
  );
}
