// Pre-processes a markdown string so that every H2 section is wrapped in
// a <details><summary><h2>...</h2></summary><div>...</div></details> block.
// Combined with react-markdown + rehype-raw, this gives us collapsible
// sections that work identically on GitHub (which renders <details>
// natively) and in-app (where the same elements get styled as cards via
// CSS in index.css under `details.docs-section { ... }`).
//
// Mirrored verbatim from Tusk's Tomes' src/lib/collapsibleMarkdown.ts so
// the two apps render docs the same way. Files that already contain
// <details> blocks pass through unchanged so hand-authored collapse
// structure is preserved.

const FENCE_RE = /^```/;

export function wrapH2SectionsInDetails(md: string): string {
  if (/<details[\s>]/i.test(md)) return md;

  const lines = md.split("\n");
  const out: string[] = [];
  let inFence = false;
  let sectionDepth = 0;

  const closeSection = () => {
    if (sectionDepth > 0) {
      out.push("", "</div>", "</details>", "");
      sectionDepth = 0;
    }
  };

  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    const h2 = !inFence && line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      closeSection();
      const heading = h2[1].replace(/</g, "&lt;").replace(/>/g, "&gt;");
      out.push('<details class="docs-section">');
      out.push(`<summary><h2>${heading}</h2></summary>`);
      out.push('<div class="docs-section-body">');
      out.push("");
      sectionDepth = 1;
    } else {
      out.push(line);
    }
  }
  closeSection();
  return out.join("\n");
}
