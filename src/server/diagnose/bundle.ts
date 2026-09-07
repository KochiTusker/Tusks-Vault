// Diagnostic bundle — everything a diagnosis needs, in ONE file.
//
// When something misbehaves, the useful state is scattered: settings,
// key-store health, lore resolution, log tail, git position. This gathers
// it into a structured markdown file at .diagnose/latest.md so the user can
// paste one @-reference into a Claude Code session (or one attachment into
// a bug report) and get a one-round-trip diagnosis instead of twenty
// questions.
//
// PRIVACY IS THE LOAD-BEARING PART. A bundle is something users paste into
// chat windows — treat every byte as about to be published. Keys appear
// only as 6-char SHA-256 fingerprints; every free-text line (logs
// especially) passes through the same scrubber that guards live log
// display; lore CONTENT never appears, only counts and paths.

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFileSync } from "child_process";
import { getSettings } from "../config/settings";
import {
  KNOWLEDGE_DIR,
  LORE_ROOT_DIR,
  KNOWLEDGE_DIR_REASON,
  DEFAULT_SIBLING_LORE_PATH,
} from "../config/paths";
import { keysPathForDiagnostics, listKeys } from "../keys/store";
import { getClarifications, hasEmbedding } from "../clarifications/store";
import { logs } from "../util/log-capture";
import { scrubSecrets } from "../util/scrub-secrets";
import { isNodeModulesStale } from "../util/updater";
import { botState, discordClient } from "../discord/client";
import { runSignatures, type DiagnoseState } from "./signatures";

const DIAGNOSE_DIR = path.join(process.cwd(), ".diagnose");
const KEEP_BACKUPS = 10;
const LOG_TAIL = 80;

function fingerprint(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex").slice(0, 6);
}

function gitLine(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf-8" }).trim();
  } catch {
    return "(unavailable)";
  }
}

function countDocuments(dir: string): number {
  // Recursive, to match the knowledge loader's walk — a user whose docs all
  // sit in subfolders must not trip the empty-knowledge-base signature.
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter(e => e.isFile() && !e.name.startsWith(".")).length;
  } catch {
    return 0;
  }
}

export interface BundleResult {
  path: string;
  findings: number;
}

/**
 * Build and write the bundle. `trigger` records what prompted it (a manual
 * button, a Discord-reply error) so a bundle can be read in context.
 */
export async function buildDiagnosticBundle(trigger: string): Promise<BundleResult> {
  const settings = getSettings();
  const keys = listKeys();
  const clarifications = getClarifications().map(c => ({ id: c.id, embedded: hasEmbedding(c.id) }));
  const nodeModulesStale = await isNodeModulesStale().catch(() => false);
  const documentCount = countDocuments(KNOWLEDGE_DIR);

  const state: DiagnoseState = {
    clarifications,
    lore: {
      resolution: KNOWLEDGE_DIR_REASON,
      loreRootExists: fs.existsSync(LORE_ROOT_DIR),
      defaultSiblingExists: fs.existsSync(DEFAULT_SIBLING_LORE_PATH),
      documentCount,
    },
    // Live key probing belongs to the smoke test / the dashboard Test
    // button; the bundle stays offline-safe and reports none.
    keyTests: [],
    nodeModulesStale,
    modelReachability: { proModel: settings.proModel, flashModel: settings.flashModel, listed: null },
    botStatus: botState.status,
    discordTokenConfigured: Boolean((process.env.DISCORD_TOKEN ?? "").trim()),
  };
  const findings = runSignatures(state);

  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push(`# Tusk's Vault diagnostic bundle`);
  push("");
  push(`- **Generated:** ${new Date().toISOString()}`);
  push(`- **Trigger:** ${scrubSecrets(trigger)}`);
  push(`- **Platform:** ${process.platform} ${os.release()} · node ${process.version}`);
  push(`- **Git:** ${gitLine(["rev-parse", "--short", "HEAD"])} on ${gitLine(["rev-parse", "--abbrev-ref", "HEAD"])}${gitLine(["status", "--porcelain"]) ? " (dirty)" : " (clean)"}`);
  push("");

  push(`## Soft-error signatures`);
  push("");
  if (findings.length === 0) {
    push(`No signature matched — the quiet failure modes all look clean.`);
  } else {
    for (const f of findings) {
      push(`### ${f.title} (\`${f.id}\`)`);
      push("");
      push(f.detail);
      push("");
    }
  }
  push("");

  push(`## Provider + keys`);
  push("");
  push(`- Active provider (settings): \`${settings.provider}\` · pro \`${settings.proModel}\` · flash \`${settings.flashModel}\` · default tier \`${settings.defaultTier}\``);
  push(`- Key store: \`${keysPathForDiagnostics()}\``);
  for (const k of keys) {
    push(`  - ${k.provider} "${k.label}" (${k.tier}) — fingerprint \`${fingerprint(k.key)}\``);
  }
  if (keys.length === 0) push(`  - (no stored keys — env-var fallback only)`);
  push("");

  push(`## Lore`);
  push("");
  push(`- Root: \`${LORE_ROOT_DIR}\` (resolution: ${KNOWLEDGE_DIR_REASON}, exists: ${state.lore.loreRootExists})`);
  push(`- Knowledge dir: \`${KNOWLEDGE_DIR}\` — ${documentCount} document(s)`);
  push(`- Clarifications: ${clarifications.length} (${clarifications.filter(c => !c.embedded).length} unembedded)`);
  push("");

  push(`## Discord`);
  push("");
  push(`- Status: ${botState.status} · guilds: ${discordClient.guilds.cache.size} · token configured: ${state.discordTokenConfigured}`);
  push(`- Bot paused: ${settings.botPaused}`);
  push("");

  push(`## Log tail (last ${LOG_TAIL}, scrubbed)`);
  push("");
  push("```");
  for (const line of logs.slice(-LOG_TAIL)) {
    push(scrubSecrets(line));
  }
  push("```");
  push("");

  // Write latest + a timestamped backup, pruning old ones.
  fs.mkdirSync(DIAGNOSE_DIR, { recursive: true });
  const content = lines.join("\n");
  const latest = path.join(DIAGNOSE_DIR, "latest.md");
  const stamped = path.join(DIAGNOSE_DIR, `bundle-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  fs.writeFileSync(latest, content, "utf-8");
  fs.writeFileSync(stamped, content, "utf-8");
  const backups = fs
    .readdirSync(DIAGNOSE_DIR)
    .filter(f => f.startsWith("bundle-"))
    .sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - KEEP_BACKUPS))) {
    fs.rmSync(path.join(DIAGNOSE_DIR, old), { force: true });
  }

  return { path: latest, findings: findings.length };
}
