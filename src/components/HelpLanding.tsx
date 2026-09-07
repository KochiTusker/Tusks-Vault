import React, { useMemo, useState } from "react";
import {
  BookOpen,
  BookText,
  ScrollText,
  Map as MapIcon,
  ListChecks,
  Sparkles,
  ShieldCheck,
  Compass,
  HelpCircle,
  Layers,
  Cog,
  Plug,
  Library,
  Cpu,
  GitCompare,
  Search,
  AlertTriangle,
  Scale,
  Heart,
} from "lucide-react";

type DocEntry = {
  slug: string;
  title: string;
  path: string;
};

interface HelpLandingProps {
  docs: DocEntry[];
  onSelect: (slug: string) => void;
}

// Mirrors the HelpLanding in Tusk's Tomes — same shape, Vault-specific
// slug map. Per-doc icon + 1-line blurb + tone (gold/arcane/ember/moon)
// so the tiles read at a glance and the Help tab opens to a landing
// page instead of a long-form README.
type Meta = {
  icon: typeof BookOpen;
  blurb: string;
  tone: "gold" | "ember" | "crimson" | "moon";
};

// One entry per doc, keyed by the slug src/server/routes/docs.ts derives from
// the file path. Blurbs answer "why would I open this", not "what is it
// called" -- the title is already on the tile.
const META: Record<string, Meta> = {
  // Root-level project docs
  readme: {
    icon: ScrollText,
    blurb: "Start here. What Tusk's Vault is, and what it refuses to do.",
    tone: "gold",
  },
  contributing: {
    icon: GitCompare,
    blurb: "Filing issues, sending PRs, running the suite.",
    tone: "moon",
  },
  roadmap: {
    icon: MapIcon,
    blurb: "Shipped, next, and deliberately not planned.",
    tone: "ember",
  },
  security: {
    icon: ShieldCheck,
    blurb: "What counts as a vulnerability here, and how to report one.",
    tone: "crimson",
  },
  "code-of-conduct": {
    icon: Heart,
    blurb: "How we behave around the table, and around the codebase.",
    tone: "moon",
  },

  // docs/getting-started
  "docs-getting-started-installation": {
    icon: Compass,
    blurb: "Clone to first cited answer, including what to do when it stalls.",
    tone: "gold",
  },
  "docs-getting-started-choosing-a-provider": {
    icon: Cpu,
    blurb: "OpenRouter, Gemini, Claude Code, Ollama -- cost, privacy, quality.",
    tone: "ember",
  },

  // docs/surfaces
  "docs-surfaces-discord": {
    icon: Plug,
    blurb: "Put the bot in your server. Four portal steps, then one paste.",
    tone: "gold",
  },
  "docs-surfaces-foundry-vtt": {
    icon: Sparkles,
    blurb: "Ask from the game's chat bar mid-session, and who is allowed to.",
    tone: "ember",
  },

  // docs/lore
  "docs-lore-obsidian-vault": {
    icon: Library,
    blurb: "Point Vault at a vault you already keep. Read-only, always.",
    tone: "gold",
  },
  "docs-lore-tusks-tomes": {
    icon: BookText,
    blurb: "The companion that records sessions and writes the chronicles.",
    tone: "moon",
  },

  // docs/security
  "docs-security-privacy": {
    icon: ShieldCheck,
    blurb: "What stays on disk, what reaches a provider, what is never sent.",
    tone: "crimson",
  },

  // docs/troubleshooting
  "docs-troubleshooting-faq": {
    icon: HelpCircle,
    blurb: "The questions that come up first, answered against the code.",
    tone: "gold",
  },
  "docs-troubleshooting-known-issues": {
    icon: AlertTriangle,
    blurb: "What is broken or missing today, stated plainly.",
    tone: "crimson",
  },

  // docs/about
  "docs-about-how-its-built": {
    icon: Layers,
    blurb: "Retrieval, prompt assembly, and where every network call goes.",
    tone: "moon",
  },
  "docs-about-use-cases": {
    icon: ListChecks,
    blurb: "Six workflows, start to finish, on the surfaces you already use.",
    tone: "gold",
  },
  "docs-about-comparison": {
    icon: Scale,
    blurb: "Against hosted bots, wiki SaaS, and just pasting into a chatbot.",
    tone: "moon",
  },
  "docs-about-dependencies": {
    icon: Cog,
    blurb: "Every library, why it earns its place, and what it costs you.",
    tone: "moon",
  },

  // docs/tooling -- interface documentation, not user documentation. Kept off
  // the public site for that reason; shown here because a self-hosted app's
  // Help tab is read by the person running it, who may well be building on it.
  "docs-tooling-foundry-contract": {
    icon: Plug,
    blurb: "The wire contract the Foundry module depends on, both directions.",
    tone: "ember",
  },
  "docs-tooling-design-system": {
    icon: Sparkles,
    blurb: "The tokens and surfaces the dashboard is built from.",
    tone: "ember",
  },
};

const FALLBACK_META: Meta = {
  icon: BookText,
  blurb: "Documentation.",
  tone: "moon",
};

// Vault is the warm half of the pair: ember primary, crimson accent. There is
// no violet here on purpose -- that is Tomes' field, and a tile borrowing it
// makes this app look like a recolour of the other one. See src/index.css.
const TONE_CLASSES: Record<
  Meta["tone"],
  { ring: string; iconBg: string; iconFg: string }
> = {
  gold:    { ring: "hover:border-amber-400/50",   iconBg: "bg-amber-500/10",   iconFg: "text-amber-300" },
  ember:   { ring: "hover:border-orange-400/55",  iconBg: "bg-orange-500/15",  iconFg: "text-orange-300" },
  crimson: { ring: "hover:border-rose-400/50",    iconBg: "bg-rose-500/12",    iconFg: "text-rose-300" },
  moon:    { ring: "hover:border-slate-300/45",   iconBg: "bg-slate-500/15",   iconFg: "text-slate-200" },
};

function getMeta(slug: string): Meta {
  return META[slug] ?? FALLBACK_META;
}

type Group = { label: string; entries: DocEntry[] };

// Shelf labels, keyed by the docs/ folder the file sits in. These are the same
// shelves, in the same order, as the published site's nav -- both read the
// folder structure rather than keeping a hand-maintained list, so the two
// cannot drift apart. Renaming a folder renames the shelf in both places.
const FOLDER_LABELS: Array<[string, string]> = [
  ["docs/getting-started", "Getting started"],
  ["docs/surfaces", "Asking from your table"],
  ["docs/lore", "Your lore"],
  ["docs/security", "Privacy & safety"],
  ["docs/troubleshooting", "Help"],
  ["docs/about", "About Tusk's Vault"],
  ["docs/tooling", "Building against Vault"],
];

// Root-level docs have no folder, so they are placed by hand into the shelf a
// reader would look for them on.
const ROOT_SHELF: Record<string, string> = {
  readme: "About Tusk's Vault",
  roadmap: "About Tusk's Vault",
  contributing: "About Tusk's Vault",
  "code-of-conduct": "About Tusk's Vault",
  security: "Privacy & safety",
};

function shelfFor(doc: DocEntry): string {
  if (!doc.path.includes("/")) return ROOT_SHELF[doc.slug] ?? "About Tusk's Vault";
  const hit = FOLDER_LABELS.find(([prefix]) => doc.path.startsWith(prefix + "/"));
  return hit ? hit[1] : doc.path.slice(0, doc.path.lastIndexOf("/"));
}

function groupForLanding(docs: DocEntry[]): Group[] {
  const buckets = new Map<string, DocEntry[]>();
  for (const d of docs) {
    const key = shelfFor(d);
    const list = buckets.get(key) ?? [];
    list.push(d);
    buckets.set(key, list);
  }
  const ordered: Group[] = [];
  for (const [, label] of FOLDER_LABELS) {
    if (buckets.has(label)) {
      ordered.push({ label, entries: buckets.get(label)! });
      buckets.delete(label);
    }
  }
  // Anything unplaced (a new folder, a stray file) still shows, last.
  for (const key of [...buckets.keys()].sort()) {
    ordered.push({ label: key, entries: buckets.get(key)! });
  }
  return ordered;
}


export function HelpLanding({ docs, onSelect }: HelpLandingProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => {
      const m = getMeta(d.slug);
      return (
        d.title.toLowerCase().includes(q) ||
        d.path.toLowerCase().includes(q) ||
        d.slug.toLowerCase().includes(q) ||
        m.blurb.toLowerCase().includes(q)
      );
    });
  }, [docs, query]);

  const groups = useMemo(() => groupForLanding(filtered), [filtered]);

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search docs by title, path, or topic…"
          className="w-full rounded-lg border border-border/30 bg-surface/60 py-2 pl-10 pr-3 text-sm placeholder:text-foreground/40 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-foreground/60">No docs match &ldquo;{query}&rdquo;.</p>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="space-y-3">
            <h3 className="text-xs font-display uppercase tracking-[0.2em] text-foreground/45">
              {group.label}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.entries.map((doc) => {
                const meta = getMeta(doc.slug);
                const tone = TONE_CLASSES[meta.tone];
                const Icon = meta.icon;
                return (
                  <button
                    key={doc.slug}
                    type="button"
                    onClick={() => onSelect(doc.slug)}
                    className={`group relative flex flex-col gap-2 rounded-xl border border-border/30 bg-surface/40 p-4 text-left transition-all gold-hover ${tone.ring} hover:-translate-y-0.5`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.iconBg} ${tone.iconFg}`}
                      >
                        <Icon size={18} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-display text-sm tracking-wide text-foreground line-clamp-2">
                          {doc.title}
                        </h4>
                        {/* The card already sits under its folder heading, so
                            repeating the folder here only pushed the part that
                            identifies the file out of the truncation — cards
                            read "DOCS/TROUBLESHOOTING/KNOWN-ISSUE…", which is
                            the least useful half. Filename on the card, whole
                            path on hover. */}
                        <p
                          className="mt-0.5 truncate text-[10px] font-mono uppercase tracking-wider text-foreground/45"
                          title={doc.path}
                        >
                          {doc.path.slice(doc.path.lastIndexOf("/") + 1)}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs leading-relaxed text-foreground/65">
                      {meta.blurb}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
