import fs from "fs";
import crypto from "crypto";
import { LlmProvider } from "../config/settings";
import { configFile, ensureConfigDir } from "../config/app-data";
import { writeFileAtomic } from "../util/atomic-write";
import { encryptJson, decryptJson } from "./crypto";

export type KeyTier = "free" | "paid" | "n/a";

export interface ApiKey {
  id: string;
  provider: LlmProvider;
  label: string;
  tier: KeyTier;
  key: string;        // raw key; at rest only inside the encrypted store
  createdAt: string;
}

interface KeyStoreFile {
  keys: ApiKey[];
  activeKeyId: string | null;
}

// Keys live ENCRYPTED in the platform config dir (see keys/crypto.ts for
// what the machine-bound encryption does and does not defend). Paths are
// resolved lazily per the repo convention — tests point the store at a
// tmpdir via TUSKS_VAULT_CONFIG_DIR.
function keysPath(): string {
  return configFile("keys.enc");
}
function saltPath(): string {
  return configFile("keys.salt");
}
export function keysPathForDiagnostics(): string {
  return keysPath();
}

// Diagnostic logging on the first load — surfaces the actual path the
// server is using so users can verify where their key store lives.
let firstLoad = true;

function load(): KeyStoreFile {
  try {
    if (fs.existsSync(keysPath())) {
      const raw = fs.readFileSync(keysPath(), "utf-8");
      const doc = decryptJson<Partial<KeyStoreFile>>(raw, saltPath());
      if (doc === null) {
        // Wrong machine (the store is machine-bound), or a corrupt file.
        // Either way the recovery is the same and must be said plainly.
        //
        // "the machine that wrote it" is stated as the LIKELY cause rather
        // than the certain one on purpose: it was once asserted outright while
        // a salt-clobbering bug in readOrCreateSalt could produce this exact
        // message on the original machine, sending the user to look for a
        // hardware change that had not happened. That bug is fixed; the
        // hedge stays, because a corrupt or truncated file reaches here too.
        if (firstLoad) {
          firstLoad = false;
          console.error(
            `[keys] Could not decrypt ${keysPath()} — most likely because the store is bound to the ` +
              `machine that wrote it, or the file (or its salt) is damaged. ` +
              `Re-enter your API keys in the dashboard (Settings → API keys).`
          );
        }
        return { keys: [], activeKeyId: null };
      }
      const state = { keys: doc.keys ?? [], activeKeyId: doc.activeKeyId ?? null };
      if (firstLoad) {
        firstLoad = false;
        console.log(`[keys] Loaded ${state.keys.length} key(s) from ${keysPath()}`);
      }
      return state;
    }

    if (firstLoad) {
      firstLoad = false;
      console.log(`[keys] No key store yet — will create ${keysPath()} when you add a key.`);
    }
  } catch (err) {
    console.error(`[keys] ERROR reading ${keysPath()}:`, err);
  }
  return { keys: [], activeKeyId: null };
}

function persist(state: KeyStoreFile): void {
  // Atomic, and atomic against a second PROCESS — see util/atomic-write.ts.
  // The stakes here are the highest in the app: a torn keys.enc does not
  // degrade, it loses every stored key. (audit:contracts asserts this call —
  // keep the write going through writeFileAtomic if refactoring.)
  //
  // mode 0o600 is applied to the temp file BEFORE the rename, so the live
  // file is never briefly world-readable.
  ensureConfigDir();
  const target = keysPath();
  writeFileAtomic(target, encryptJson(state, saltPath()), { mode: 0o600 });
  console.log(`[keys] Wrote ${state.keys.length} key(s) to ${target}`);
}

export function listKeys(): ApiKey[] {
  return load().keys;
}

// Masked view safe to return over the API. Never include `key` in responses.
export interface ApiKeyPublic {
  id: string;
  provider: LlmProvider;
  label: string;
  tier: KeyTier;
  maskedKey: string;
  createdAt: string;
}

export function listKeysPublic(): ApiKeyPublic[] {
  return listKeys().map(toPublic);
}

export function getActiveKey(): ApiKey | null {
  const state = load();
  if (!state.activeKeyId) return null;
  return state.keys.find(k => k.id === state.activeKeyId) ?? null;
}

export function getActiveKeyPublic(): ApiKeyPublic | null {
  const k = getActiveKey();
  return k ? toPublic(k) : null;
}

export function addKey(input: { provider: LlmProvider; label: string; tier: KeyTier; key: string }): ApiKey {
  const state = load();
  const created: ApiKey = {
    id: crypto.randomUUID(),
    provider: input.provider,
    label: input.label.trim() || `${input.provider} key`,
    tier: input.tier,
    key: input.key.trim(),
    createdAt: new Date().toISOString(),
  };
  state.keys.push(created);
  // First key added auto-activates so the user doesn't have a "no active" gap.
  if (!state.activeKeyId) state.activeKeyId = created.id;
  persist(state);
  return created;
}

export function deleteKey(id: string): void {
  const state = load();
  state.keys = state.keys.filter(k => k.id !== id);
  if (state.activeKeyId === id) {
    state.activeKeyId = state.keys[0]?.id ?? null;
  }
  persist(state);
}

/** Look up a stored key by id, including the raw secret. Used by the Test
 *  endpoint to spin up a temporary adapter without touching the active-key
 *  state. Returns null when no key with the given id is registered. */
export function getKeyById(id: string): ApiKey | null {
  return load().keys.find(k => k.id === id) ?? null;
}

export function setActiveKey(id: string | null): void {
  const state = load();
  if (id !== null && !state.keys.some(k => k.id === id)) {
    throw new Error(`No key with id ${id}`);
  }
  state.activeKeyId = id;
  persist(state);
}

// Look up a key for a provider, preferring the active key if it matches.
// Falls back to the first stored key for that provider; then to the env-var
// fallback (so users who hand-edit .env.local still work).
export function resolveKeyForProvider(provider: LlmProvider): string | null {
  return resolveKeyRecordForProvider(provider)?.key ?? null;
}

/**
 * The same resolution, returning the whole record.
 *
 * Callers that need the key's TIER — which probe slot describes it, say —
 * must not re-derive "which key would be used" themselves: two copies of that
 * rule drift, and the failure mode is a probe result attributed to the wrong
 * key, which is worse than none.
 */
export function resolveKeyRecordForProvider(provider: LlmProvider): ApiKey | null {
  const state = load();
  const active = state.activeKeyId ? state.keys.find(k => k.id === state.activeKeyId) : null;
  if (active?.provider === provider && active.key) return active;
  const fallback = state.keys.find(k => k.provider === provider);
  if (fallback?.key) return fallback;
  return null;
}

function toPublic(k: ApiKey): ApiKeyPublic {
  const raw = k.key ?? "";
  const masked = raw.length < 8 ? "***" : `${raw.substring(0, 4)}...${raw.substring(raw.length - 4)}`;
  return {
    id: k.id,
    provider: k.provider,
    label: k.label,
    tier: k.tier,
    maskedKey: masked,
    createdAt: k.createdAt,
  };
}
