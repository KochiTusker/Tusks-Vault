#!/usr/bin/env node
/**
 * Documentation tone linter.
 *
 * The docs are written in one deliberate voice: a GM who built a tool for
 * their own table, talking to other GMs. Understated, Commonwealth English,
 * honest about limitations, and — the part that's easy to lose — NOT
 * selling anything.
 *
 * That voice degrades one word at a time. Someone adds "seamlessly",
 * someone else adds "unlock the power of", and six months later it reads
 * like a landing page. This flags the specific vocabulary that signals the
 * drift, so it's caught in review rather than noticed a year later.
 *
 * Advisory: prints findings and exits 0 unless --strict is passed. Tone is
 * a judgement call and a linter should not be the final authority on it —
 * but it is very good at spotting "leverage" and "effortless".
 *
 *   node scripts/docs-tone.mjs            # report
 *   node scripts/docs-tone.mjs --strict   # non-zero exit if anything is flagged
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const STRICT = process.argv.includes("--strict");

/** Marketing vocabulary. Each entry is a phrase and why it's off-voice. */
const SALES_SPEAK = [
  { re: /\bseamless(ly)?\b/i, why: "nothing is seamless; say what actually happens" },
  { re: /\bunlock (the )?(power|potential|full)\b/i, why: "landing-page verb" },
  { re: /\beffortless(ly)?\b/i, why: "it took effort to build and takes effort to run" },
  { re: /\bleverage[ds]?\b/i, why: '"use"' },
  { re: /\bgame-?chang(er|ing)\b/i, why: "let the reader decide" },
  { re: /\brevolutioni[sz]e/i, why: "it's a Discord bot" },
  { re: /\bsupercharge/i, why: "landing-page verb" },
  { re: /\bblazing(ly)?[- ]fast\b/i, why: "quote a number or say nothing" },
  { re: /\bbest[- ]in[- ]class\b/i, why: "compared against what, measured how?" },
  { re: /\bcutting[- ]edge\b/i, why: "everything is, briefly" },
  { re: /\bstate[- ]of[- ]the[- ]art\b/i, why: "everything is, briefly" },
  { re: /\bempowers?\b/i, why: '"lets you"' },
  { re: /\belevate[sd]?\b/i, why: "landing-page verb" },
  { re: /\bproduction[- ]grade\b/i, why: "say what was tested instead" },
  { re: /\brobust(ly)?\b/i, why: "describe the failure handling instead of asserting it" },
  { re: /\bdelight(ful|ed)?\b/i, why: "the reader decides how they feel" },
  { re: /\btake .{0,20}to the next level\b/i, why: "landing-page phrase" },
  { re: /\bin today'?s (fast[- ]paced|digital|modern)\b/i, why: "AI-brochure opener" },
];

// Files whose voice is the user-facing one. Dev-only docs (CLAUDE.md,
// docs/dev/) hold engineering notes and are exempt; so is this script.
function docFiles() {
  const tracked = execFileSync("git", ["ls-files", "*.md"], { encoding: "utf-8" })
    .split("\n")
    .filter(Boolean)
    .map(f => f.replace(/\\/g, "/"));
  return tracked.filter(
    f =>
      !f.startsWith("docs/dev/") &&
      f !== "CLAUDE.md" &&
      !f.startsWith(".github/") &&
      f !== "SHIP_FIXES.md"
  );
}

const findings = [];
for (const file of docFiles()) {
  let content;
  try {
    content = readFileSync(path.resolve(file), "utf-8");
  } catch {
    continue;
  }
  let inFence = false;
  content.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence || /^\s{4,}/.test(line) || /https?:\/\//.test(line)) return;
    // Inline code spans are identifiers, not prose — `--color-surface-elevated`
    // must not read as the verb "elevate".
    const prose = line.replace(/`[^`]*`/g, "");
    for (const { re, why } of SALES_SPEAK) {
      const m = re.exec(prose);
      if (m) findings.push({ file, line: i + 1, phrase: m[0], why });
    }
  });
}

if (findings.length === 0) {
  console.log("✓ Docs tone holds — no sales-speak found.");
  process.exit(0);
}

console.log(`${findings.length} tone finding(s):\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  "${f.phrase}" — ${f.why}`);
}
console.log(
  "\nAdvisory: judge each in context — a quoted phrase or a deliberate usage can stay."
);
process.exit(STRICT ? 1 : 0);
