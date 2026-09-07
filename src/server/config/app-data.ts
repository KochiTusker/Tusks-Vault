// Per-install app-data locations — one module that answers "where does X
// live" for state that is NOT campaign state.
//
// The split matters: campaign state (clarifications, embeddings, lore gaps)
// lives in the resolved Tusks-Lore/ folder so it survives clean reinstalls
// and follows the campaign. Everything here is the opposite — per-install,
// per-machine data (encrypted keys, catalogue caches) that should NOT
// follow a campaign folder around and is rebuildable or machine-bound.
//
// Resolved lazily per the repo convention (tests override via env), with
// TUSKS_VAULT_CONFIG_DIR as the escape hatch for portable installs and for
// tests that must not touch the real user profile.

import path from "path";
import fs from "fs";
import envPaths from "env-paths";

export function configDir(): string {
  const override = (process.env.TUSKS_VAULT_CONFIG_DIR ?? "").trim();
  if (override) return override;
  return envPaths("tusks-vault", { suffix: "" }).config;
}

/** configDir(), created if absent. For call sites about to write. */
export function ensureConfigDir(): string {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function configFile(name: string): string {
  return path.join(configDir(), name);
}
