import { Router } from "express";
import { loopbackOnly } from "../util/loopback-only";
import fs from "fs";
import path from "path";
import {
  KNOWLEDGE_DIR,
  KNOWLEDGE_DIR_IS_EXTERNAL,
  KNOWLEDGE_DIR_REASON,
  LORE_ROOT_DIR,
  settingsPath,
  CLARIFICATIONS_PATH,
  LORE_GAPS_PATH,
  EMBEDDINGS_PATH,
  MODELS_CACHE_DIR,
  REPO_LORE_DIR,
} from "../config/paths";
import { keysPathForDiagnostics } from "../keys/store";
import { buildDiagnosticBundle } from "../diagnose/bundle";

export const diagnosticsRouter = Router();

// loopbackOnly, like every other route that acts on the HOST. This one earns
// it twice over: POST /api/diagnostics/bundle spawns `git` and writes two
// files, and GET /api/diagnostics returns every resolved absolute path —
// including the key store under the OS user's profile directory, which names
// the account. Under HOST=0.0.0.0 both were reachable by any LAN peer, and
// the guard above them only checks Origin when one is present, which a
// browser sends and curl does not.
//
// known-issues.md enumerates the host-acting routes that are gated. This was
// not on that list and should have been; the list is now true.
diagnosticsRouter.use("/api/diagnostics", loopbackOnly());

// Build a diagnostic bundle on demand. No UI calls this today — it is an
// HTTP-only escape hatch, alongside the automatic bundle a failed Discord
// reply writes. Returns the path so the user can @-reference it in a Claude
// Code session or attach it to a bug report.
diagnosticsRouter.post("/api/diagnostics/bundle", async (_req, res) => {
  try {
    const result = await buildDiagnosticBundle("manual (dashboard)");
    res.json({ ok: true, path: result.path, findings: result.findings });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// Surface the absolute paths Tusk's Vault uses, plus existence/size info.
// Helps debug "my keys disappeared" reports — users can see exactly where the
// server is reading and writing.
diagnosticsRouter.get("/api/diagnostics", (_req, res) => {
  const envLocal = path.join(process.cwd(), ".env.local");
  const stat = (p: string) => {
    try {
      if (!fs.existsSync(p)) return { exists: false, size: 0, modified: null };
      const s = fs.statSync(p);
      return { exists: true, size: s.size, modified: s.mtime.toISOString() };
    } catch {
      return { exists: false, size: 0, modified: null };
    }
  };
  res.json({
    cwd: process.cwd(),
    paths: {
      "keys.enc":               { path: keysPathForDiagnostics(), ...stat(keysPathForDiagnostics()) },
      ".env.local":             { path: envLocal,                  ...stat(envLocal) },
      "settings.json":          { path: settingsPath(),            ...stat(settingsPath()) },
      "clarifications.json":    { path: CLARIFICATIONS_PATH,       ...stat(CLARIFICATIONS_PATH) },
      "clarifications.embeddings.json": { path: EMBEDDINGS_PATH,    ...stat(EMBEDDINGS_PATH) },
      "lore_gaps.json":         { path: LORE_GAPS_PATH,            ...stat(LORE_GAPS_PATH) },
      "Lore/":                  {
        path: KNOWLEDGE_DIR,
        ...stat(KNOWLEDGE_DIR),
        resolution: KNOWLEDGE_DIR_REASON,
        isExternal: KNOWLEDGE_DIR_IS_EXTERNAL,
        repoLocalPath: REPO_LORE_DIR,
        loreRoot: LORE_ROOT_DIR,
        loreRootExists: fs.existsSync(LORE_ROOT_DIR),
      },
      "models/":                { path: MODELS_CACHE_DIR,          ...stat(MODELS_CACHE_DIR) },
    },
  });
});
