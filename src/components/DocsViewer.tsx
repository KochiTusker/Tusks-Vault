import React, { useCallback, useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { ArrowLeft, BookOpen, FileText, Folder } from "lucide-react";
import { HelpLanding } from "./HelpLanding";
import { FlameLoader } from "./FlameLoader";
import { wrapH2SectionsInDetails } from "../lib/collapsibleMarkdown";
import { renderDocsAlerts } from "../lib/docsAlerts";

const HELP_DOC_EVENT = "tusksvault:open-doc";

type DocEntry = {
  slug: string;
  title: string;
  path: string;
};

type DocContent = DocEntry & { content: string };

export function DocsViewer() {
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<DocContent | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load doc list on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/docs");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { docs: list } = (await res.json()) as { docs: DocEntry[] };
        if (cancelled) return;
        setDocs(list);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cross-tab deep-link.
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent).detail as { slug?: string } | undefined;
      if (detail?.slug) setActiveSlug(detail.slug);
    }
    window.addEventListener(HELP_DOC_EVENT, handler);
    return () => window.removeEventListener(HELP_DOC_EVENT, handler);
  }, []);

  // Load the active doc whenever the slug changes. Pre-process the
  // markdown to wrap H2 sections in <details> blocks so each section
  // becomes a collapsible card (closed by default).
  useEffect(() => {
    if (!activeSlug) {
      setActiveDoc(null);
      return;
    }
    let cancelled = false;
    setLoadingDoc(true);
    (async () => {
      try {
        const res = await fetch(`/api/docs/${encodeURIComponent(activeSlug)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as DocContent;
        if (!cancelled) {
          // Alerts first, then the collapsible wrap. Order matters: the
          // alert rewrite consumes blockquote lines, and wrapping H2 sections
          // first would put a <details> boundary in the middle of one.
          //
          // The static site generator applies the identical rewrite, and
          // src/lib/docsAlerts.test.ts pins the two to the same class names —
          // the whole point being that a doc reads the same here, on the
          // published site, and on GitHub, which renders this syntax natively.
          setActiveDoc({
            ...body,
            content: wrapH2SectionsInDetails(renderDocsAlerts(body.content)),
          });
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoadingDoc(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSlug]);

  const tree = useMemo(() => groupDocs(docs), [docs]);

  const select = useCallback((slug: string) => {
    setActiveSlug(slug);
    setError(null);
  }, []);

  const backToLanding = () => {
    setActiveSlug(null);
    setActiveDoc(null);
  };

  return (
    <section className="scriptorium-card rounded-2xl p-6 parchment">
      <header className="flex items-start gap-3 mb-4">
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-primary">
          <BookOpen size={20} />
        </div>
        <div className="flex-1">
          <h2 className="font-display text-xl tracking-wider text-foreground-strong">
            Help &amp; Documentation
          </h2>
          <p className="font-serif italic text-foreground/60 text-sm">
            Browse the same docs that live in the GitHub repo, without leaving the
            app. Each section is collapsible — click to open.
          </p>
        </div>
      </header>

      {loadingList ? (
        <div className="flex items-center gap-2 text-sm text-foreground/60">
          <FlameLoader size={14} /> Loading docs…
        </div>
      ) : docs.length === 0 ? (
        <p className="text-sm text-foreground/60">No docs found.</p>
      ) : !activeSlug ? (
        // Landing — tile grid + search.
        <HelpLanding docs={docs} onSelect={select} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={backToLanding}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface/40 hover:bg-surface/70 border border-border/30 text-xs font-display tracking-wider uppercase transition-colors"
            >
              <ArrowLeft size={14} /> All docs
            </button>
            {activeDoc && (
              <span className="font-display text-xs uppercase tracking-[0.2em] text-foreground/45">
                {activeDoc.path}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <nav className="space-y-3 border-border/20 md:border-r md:pr-4">
              {tree.map((group) => (
                <div key={group.label} className="space-y-1">
                  <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-foreground/45">
                    {group.label === "/" ? null : <Folder className="h-3 w-3" />}
                    {group.label === "/" ? "Top level" : group.label}
                  </div>
                  <ul className="space-y-0.5">
                    {group.entries.map((doc) => (
                      <li key={doc.slug}>
                        <button
                          type="button"
                          onClick={() => select(doc.slug)}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-surface/60 ${
                            activeSlug === doc.slug
                              ? "bg-surface/70 text-foreground font-medium"
                              : "text-foreground/55"
                          }`}
                        >
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="truncate">{doc.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
            <article className="min-w-0">
              {error && (
                <div className="mb-3 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
                  {error}
                </div>
              )}
              {loadingDoc ? (
                <div className="flex items-center gap-2 text-sm text-foreground/60">
                  <FlameLoader size={14} /> Loading…
                </div>
              ) : activeDoc ? (
                // Style markdown elements via Tailwind child selectors —
                // no @tailwindcss/typography dependency. rehypeRaw lets
                // inline HTML (badges, banners, <details> blocks) render.
                <div className="text-sm leading-relaxed
                  [&_h1]:mt-0 [&_h1]:mb-3 [&_h1]:font-display [&_h1]:text-2xl [&_h1]:tracking-wider
                  [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-xl [&_h2]:tracking-wider
                  [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:font-display [&_h3]:text-base [&_h3]:tracking-wide
                  [&_p]:my-2
                  [&_a]:text-primary [&_a]:underline
                  [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5
                  [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5
                  [&_li]:my-0.5
                  [&_img]:inline-block [&_img]:my-1
                  [&_code]:rounded [&_code]:bg-surface/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs
                  [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-surface/60 [&_pre]:p-3
                  [&_pre_code]:bg-transparent [&_pre_code]:p-0
                  [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border/40 [&_blockquote]:pl-3 [&_blockquote]:text-foreground/60
                  [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse
                  [&_th]:border [&_th]:border-border/40 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium
                  [&_td]:border [&_td]:border-border/40 [&_td]:px-2 [&_td]:py-1
                  [&_hr]:my-4 [&_hr]:border-border/40
                  [&_strong]:font-semibold">
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                  >
                    {activeDoc.content}
                  </Markdown>
                  <p className="mt-6 text-xs text-foreground/45">
                    Source: <code>{activeDoc.path}</code>
                  </p>
                </div>
              ) : (
                <p className="text-sm text-foreground/60">
                  Select a doc from the list.
                </p>
              )}
            </article>
          </div>
        </div>
      )}
    </section>
  );
}

function groupDocs(entries: DocEntry[]): Array<{ label: string; entries: DocEntry[] }> {
  const byGroup = new Map<string, DocEntry[]>();
  for (const entry of entries) {
    const lastSlash = entry.path.lastIndexOf("/");
    const label = lastSlash === -1 ? "/" : entry.path.slice(0, lastSlash);
    const list = byGroup.get(label) ?? [];
    list.push(entry);
    byGroup.set(label, list);
  }
  const labels = [...byGroup.keys()].sort((a, b) => {
    if (a === "/") return -1;
    if (b === "/") return 1;
    return a.localeCompare(b);
  });
  return labels.map((label) => ({ label, entries: byGroup.get(label) ?? [] }));
}
