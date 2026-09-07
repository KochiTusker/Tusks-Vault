import fs from "fs";
import path from "path";
import { Router } from "express";
import express from "express";
import { getSettings } from "../config/settings";
import {
  probeTomes,
  scanChronicles,
  importChronicles,
} from "../integrations/tomes";
import {
  DEFAULT_SIBLING_LORE_PATH,
  KNOWLEDGE_DIR,
  KNOWLEDGE_DIR_IS_EXTERNAL,
  KNOWLEDGE_DIR_REASON,
  LORE_ROOT_DIR,
  SESSIONS_SUBDIR,
} from "../config/paths";
import { loopbackOnly } from "../util/loopback-only";

export const integrationsRouter = Router();

// Every route here acts on the HOST filesystem: it enumerates a directory the
// user named, copies files out of it into the knowledge corpus, or creates a
// folder on disk. Under HOST=0.0.0.0 a LAN visitor reaches this router by
// design, so it carries the same prefix-level gate as /api/obsidian/*.
//
// Gating at the PREFIX rather than per route is the point: the Obsidian side
// got /api/obsidian/browse covered for free precisely because the gate sits on
// the mount, and a new route here should be protected the day it is added
// rather than the day someone remembers.
integrationsRouter.use("/api/integrations", loopbackOnly());

// GET /api/integrations/tomes — probe + chronicle list in one call so the
// UI only needs to round-trip once to render the section.
integrationsRouter.get("/api/integrations/tomes", (_req, res) => {
  const settings = getSettings();
  const probe = probeTomes(settings.tomesSessionsPath ?? null);
  const chronicles = probe.sessionsPath ? scanChronicles(probe.sessionsPath) : [];
  res.json({ probe, chronicles });
});

// POST /api/integrations/tomes/sync — copy every non-yet-imported chronicle
// from the resolved Tomes Sessions folder into Vault's Lore/.
integrationsRouter.post("/api/integrations/tomes/sync", express.json({ limit: "10kb" }), (_req, res) => {
  const settings = getSettings();
  const probe = probeTomes(settings.tomesSessionsPath ?? null);
  if (!probe.found || !probe.sessionsPath) {
    res.status(404).json({
      error: "Tusk's Tomes Sessions folder not found.",
      candidatesChecked: probe.candidatesChecked,
    });
    return;
  }
  const chronicles = scanChronicles(probe.sessionsPath);
  const result = importChronicles(chronicles);
  res.json({ ok: true, sessionsPath: probe.sessionsPath, ...result });
});

// ─── Tusks-Lore folder (shared between Vault + Tomes) ─────────────────────

const TUSKS_LORE_README = `# Tusks-Lore

Shared knowledge folder for the Tusks toolchain.

This folder lives next to \`Tusks-Vault\` and \`Tusks-Tomes\`. Both projects
read from and write to it, so your campaign documents and Tomes-managed
metadata live in one place — independent of either project's source code.

## Layout

\`\`\`
Tusks-Lore/
├── tusks-lore.json     Tomes' consolidated metadata (glossary + speakers)
└── Sessions/           Tomes writes session chronicles here by default.
    └── <campaign>/     One sub-folder per campaign.
        ├── Session-01-2026-05-19-full.docx
        └── Session-01-2026-05-19-condensed.docx
\`\`\`

Drop your own lore documents anywhere inside this folder — at the root,
or in any sub-directory you like (e.g. \`Worldbuilding/\`,
\`Characters/\`). Vault walks the tree recursively, so files at any
depth are indexed for grounding. The dashboard's listing shows each
file with its relative path so you can tell session chronicles apart
from world-building notes.

The Tomes-managed file (\`tusks-lore.json\`) is skipped from generic
ingestion — a future Vault release will use it as authoritative
glossary/speaker context for the LLM.

You can also point Vault at a different location: set
\`loreFolderPath\` in \`settings.json\` or the
\`TUSKS_VAULT_LORE_PATH\` env var. Restart the server for changes to
take effect.
`;

/** GET /api/integrations/tusks-lore
 *  Detection-only endpoint for the dashboard's Tusks-Lore card. Surfaces
 *  the boot-time resolution decision plus a live-recomputed default-sibling
 *  existence check so the "Create" button knows what to render right now. */
integrationsRouter.get("/api/integrations/tusks-lore", (_req, res) => {
  const defaultSibling = DEFAULT_SIBLING_LORE_PATH;
  const defaultSiblingExists = (() => {
    try {
      return fs.existsSync(defaultSibling) && fs.statSync(defaultSibling).isDirectory();
    } catch {
      return false;
    }
  })();
  res.json({
    resolution: KNOWLEDGE_DIR_REASON,
    isExternal: KNOWLEDGE_DIR_IS_EXTERNAL,
    loreRoot: LORE_ROOT_DIR,
    loreRootExists: fs.existsSync(LORE_ROOT_DIR),
    knowledgeDir: KNOWLEDGE_DIR,
    defaultSibling,
    defaultSiblingExists,
  });
});

/** POST /api/integrations/tusks-lore/create
 *  Idempotently creates the default sibling Tusks-Lore folder and its
 *  sources/ subdirectory, plus a starter README at the root. Returns the
 *  paths it created (or already existed). The user must restart the
 *  server for the new path to become the active KNOWLEDGE_DIR — the
 *  client surfaces a "Restart required" prompt when the response comes
 *  back. */
integrationsRouter.post("/api/integrations/tusks-lore/create", express.json({ limit: "10kb" }), (_req, res) => {
  const targetRoot = DEFAULT_SIBLING_LORE_PATH;
  const targetSessions = path.join(targetRoot, SESSIONS_SUBDIR);
  const targetReadme = path.join(targetRoot, "README.md");
  try {
    // mkdir Sessions/ (and recursively the root) so Tomes can write
    // chronicles immediately without extra setup. Sessions/<campaign>/ is
    // created by Tomes on first session-write.
    fs.mkdirSync(targetSessions, { recursive: true });
    const readmeExisted = fs.existsSync(targetReadme);
    if (!readmeExisted) {
      fs.writeFileSync(targetReadme, TUSKS_LORE_README, "utf-8");
    }
    res.json({
      ok: true,
      created: !readmeExisted,
      loreRoot: targetRoot,
      sessionsDir: targetSessions,
      readmePath: targetReadme,
      restartRequired: !KNOWLEDGE_DIR_IS_EXTERNAL || LORE_ROOT_DIR !== targetRoot,
    });
  } catch (err) {
    console.error("[tusks-lore] folder create failed:", err);
    res.status(500).json({
      error: "Could not create Tusks-Lore folder",
      detail: err instanceof Error ? err.message : String(err),
      target: targetRoot,
    });
  }
});
