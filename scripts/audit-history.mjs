#!/usr/bin/env node
/**
 * Walk every commit on every branch and report any line that matches a
 * known secret-shape regex. Uses two layers:
 *
 *   1. Custom regex patterns (scripts/audit-patterns.mjs) — always runs.
 *      ~10 high-confidence shapes (LLM provider keys, Discord, GitHub,
 *      AWS, Stripe, JWT, PEM private keys).
 *
 *   2. gitleaks (if installed at .bin/gitleaks or on PATH) — runs after
 *      layer 1. Adds ~150 community-maintained patterns + entropy-based
 *      detection. To install for Vault, match Tusks-Tomes' 8.30.1:
 *        curl -L -o .bin/gitleaks.exe https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip
 *      (then unzip and chmod +x). See find-gitleaks.mjs for the path
 *      resolution order.
 *
 * Usage:
 *   node scripts/audit-history.mjs
 *
 * Output: one line per finding for layer 1, then gitleaks's own report.
 * Exit code: 0 if both layers clean, 1 if either reports a finding.
 */
import { execSync, spawnSync } from "node:child_process";
import { PATTERNS, maskMatch, shouldSuppress } from "./audit-patterns.mjs";
import { findGitleaks, gitleaksVersion } from "./find-gitleaks.mjs";

// ─── Layer 1: custom regex patterns ────────────────────────────────────────

console.log("Layer 1: scanning history with custom patterns...");

const log = execSync("git log --all -p --no-color", {
  encoding: "utf-8",
  maxBuffer: 500 * 1024 * 1024,
});

let currentCommit = "";
let currentFile = "";
const findings = [];

for (const line of log.split("\n")) {
  if (line.startsWith("commit ")) {
    currentCommit = line.slice(7, 14);
  } else if (line.startsWith("+++ b/")) {
    currentFile = line.slice(6);
  } else if (line.startsWith("+") && !line.startsWith("+++")) {
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        if (shouldSuppress(name, line)) continue;
        findings.push({
          commit: currentCommit,
          file: currentFile,
          pattern: name,
          mask: maskMatch(m[0]),
        });
      }
    }
  }
}

let layer1Failed = false;
if (findings.length === 0) {
  console.log("  ✓ No matches.");
  console.log(`    (Patterns: ${PATTERNS.map(p => p.name).join(", ")})`);
} else {
  layer1Failed = true;
  console.log(`  ⚠  ${findings.length} potential secret(s):\n`);
  const seen = new Set();
  for (const f of findings) {
    const key = `${f.commit}|${f.file}|${f.pattern}|${f.mask}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`    ${f.commit}  ${f.file}  [${f.pattern}]  ${f.mask}`);
  }
}

// ─── Layer 2: gitleaks (optional) ──────────────────────────────────────────

console.log("");
console.log("Layer 2: gitleaks (community patterns + entropy)...");

const gitleaks = findGitleaks();
let layer2Failed = false;
if (!gitleaks) {
  console.log("  ⚠  gitleaks not found at .bin/gitleaks(.exe) or on PATH.");
  console.log("     Layer 2 SKIPPED. Custom patterns above are still active.");
  console.log("     To enable layer 2, install gitleaks 8.30.1 to match Tusks-Tomes:");
  console.log("       https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1");
} else {
  const version = gitleaksVersion(gitleaks);
  console.log(`  Using ${gitleaks} (version ${version ?? "unknown"})`);
  // `gitleaks git` scans the full git history. --redact masks findings in
  // the printed report so this doesn't itself become a leak vector if the
  // output is piped/shared/logged.
  const result = spawnSync(gitleaks, ["git", "--redact", "--no-banner"], {
    stdio: "inherit",
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    layer2Failed = true;
  } else {
    console.log("  ✓ gitleaks reports clean.");
  }
}

// ─── Combined verdict ──────────────────────────────────────────────────────

console.log("");
if (!layer1Failed && !layer2Failed) {
  console.log("───────────────────────────────────────────────────────────");
  console.log("✓ Both layers clean. Dev history shows no known secret shapes.");
  process.exit(0);
}

console.log("───────────────────────────────────────────────────────────");
console.log("⚠  At least one layer reported findings. Review the output above.");
console.log("");
console.log("Next steps:");
console.log("  1. Rotate any real credentials shown above. The dev repo is");
console.log("     private but collaborators (and your own future-self) can see them.");
console.log("  2. The orphan-branch publish workflow already prevents these from");
console.log("     reaching public — they stay in dev history only.");
process.exit(1);
