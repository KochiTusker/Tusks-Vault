import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { configDir, ensureConfigDir } from "../config/app-data";
import { writeFileAtomic } from "../util/atomic-write";
import { DEFAULT_ACTIVE_PERSONA_ID, PERSONA_PRESETS, PersonaPreset, getPresetById } from "./presets";

// On-disk shape, at `<configDir>/personas.user.json` — per-install state,
// so it belongs beside the other config-dir files rather than inside the
// campaign's Tusks-Lore folder. We persist:
//   - activePersonaId: which persona the Discord handler swaps in. Preset
//     ids ("chronicler", "champion", …) and user-created ids are both valid.
//   - userPersonas: full list of personas authored / forked by the user.
// Presets are NOT written to disk; they're shipped in code (presets.ts) and
// merged with user personas at read time. That way a preset tweak in a future
// release reaches existing installs without any migration.
interface PersonasStoreFile {
  version: number;
  activePersonaId: string;
  userPersonas: UserPersona[];
}

export interface UserPersona {
  id: string;
  name: string;
  description: string;
  prompt: string;
  createdAt: number;
  updatedAt: number;
}

// Full persona row as exposed to the UI. `builtin: true` means "ships in code,
// can't be edited or deleted, but can be set active and copied to a user row".
export interface PersonaRow {
  id: string;
  name: string;
  description: string;
  prompt: string;
  builtin: boolean;
  createdAt?: number;
  updatedAt?: number;
}

const STORE_VERSION = 1;
const STORE_FILENAME = "personas.user.json";

function storePath(): string {
  return path.join(configDir(), STORE_FILENAME);
}

function emptyStore(): PersonasStoreFile {
  return {
    version: STORE_VERSION,
    activePersonaId: DEFAULT_ACTIVE_PERSONA_ID,
    userPersonas: [],
  };
}

function readStore(): PersonasStoreFile {
  const p = storePath();
  if (!fs.existsSync(p)) return emptyStore();
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<PersonasStoreFile>;
    const userPersonas = Array.isArray(raw.userPersonas) ? raw.userPersonas.filter(isValidUserPersona) : [];
    const activePersonaId = typeof raw.activePersonaId === "string" && raw.activePersonaId
      ? raw.activePersonaId
      : DEFAULT_ACTIVE_PERSONA_ID;
    return { version: STORE_VERSION, activePersonaId, userPersonas };
  } catch (err) {
    console.warn("[personas] store read failed, returning empty:", err);
    return emptyStore();
  }
}

function isValidUserPersona(p: unknown): p is UserPersona {
  if (!p || typeof p !== "object") return false;
  const x = p as Record<string, unknown>;
  return (
    typeof x.id === "string" &&
    typeof x.name === "string" &&
    typeof x.description === "string" &&
    typeof x.prompt === "string" &&
    typeof x.createdAt === "number" &&
    typeof x.updatedAt === "number"
  );
}

function writeStore(store: PersonasStoreFile): void {
  const dir = configDir();
  ensureConfigDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeFileAtomic(storePath(), JSON.stringify(store, null, 2));
}

// ─── Read API ──────────────────────────────────────────────────────────────

/** Returns presets + user-authored personas merged into one ordered list. */
export function listPersonas(): PersonaRow[] {
  const store = readStore();
  const presetRows: PersonaRow[] = PERSONA_PRESETS.map((p: PersonaPreset) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    prompt: p.prompt,
    builtin: true,
  }));
  const userRows: PersonaRow[] = store.userPersonas.map(u => ({
    id: u.id,
    name: u.name,
    description: u.description,
    prompt: u.prompt,
    builtin: false,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  }));
  return [...presetRows, ...userRows];
}

export function getActivePersonaId(): string {
  return readStore().activePersonaId;
}

export function getActivePersona(): PersonaRow | undefined {
  const id = getActivePersonaId();
  return listPersonas().find(p => p.id === id);
}

export function findPersona(id: string): PersonaRow | undefined {
  return listPersonas().find(p => p.id === id);
}

// ─── Write API ─────────────────────────────────────────────────────────────

export interface CreatePersonaInput {
  name: string;
  description?: string;
  prompt: string;
}

export function createUserPersona(input: CreatePersonaInput): PersonaRow {
  const store = readStore();
  const now = Date.now();
  const persona: UserPersona = {
    id: randomUUID(),
    name: input.name.trim() || "Untitled persona",
    description: (input.description ?? "").trim(),
    prompt: input.prompt.trim(),
    createdAt: now,
    updatedAt: now,
  };
  store.userPersonas.push(persona);
  writeStore(store);
  return {
    id: persona.id,
    name: persona.name,
    description: persona.description,
    prompt: persona.prompt,
    builtin: false,
    createdAt: persona.createdAt,
    updatedAt: persona.updatedAt,
  };
}

export interface UpdatePersonaInput {
  name?: string;
  description?: string;
  prompt?: string;
}

export class PersonaNotFoundError extends Error {
  constructor(id: string) {
    super(`Persona not found: ${id}`);
    this.name = "PersonaNotFoundError";
  }
}

export class BuiltinPersonaError extends Error {
  constructor(action: string) {
    super(`Built-in personas cannot be ${action}. Duplicate the preset first to customise it.`);
    this.name = "BuiltinPersonaError";
  }
}

export function updateUserPersona(id: string, input: UpdatePersonaInput): PersonaRow {
  if (getPresetById(id)) throw new BuiltinPersonaError("edited");
  const store = readStore();
  const idx = store.userPersonas.findIndex(p => p.id === id);
  if (idx === -1) throw new PersonaNotFoundError(id);
  const current = store.userPersonas[idx];
  const updated: UserPersona = {
    ...current,
    name: input.name !== undefined ? input.name.trim() || current.name : current.name,
    description: input.description !== undefined ? input.description.trim() : current.description,
    prompt: input.prompt !== undefined ? input.prompt.trim() || current.prompt : current.prompt,
    updatedAt: Date.now(),
  };
  store.userPersonas[idx] = updated;
  writeStore(store);
  return {
    id: updated.id,
    name: updated.name,
    description: updated.description,
    prompt: updated.prompt,
    builtin: false,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

export function deleteUserPersona(id: string): void {
  if (getPresetById(id)) throw new BuiltinPersonaError("deleted");
  const store = readStore();
  const before = store.userPersonas.length;
  store.userPersonas = store.userPersonas.filter(p => p.id !== id);
  if (store.userPersonas.length === before) throw new PersonaNotFoundError(id);
  // If the deleted persona was active, fall back to the default Chronicler so
  // the next Discord call still has a valid prompt to swap in.
  if (store.activePersonaId === id) store.activePersonaId = DEFAULT_ACTIVE_PERSONA_ID;
  writeStore(store);
}

export function setActivePersona(id: string): PersonaRow {
  const persona = listPersonas().find(p => p.id === id);
  if (!persona) throw new PersonaNotFoundError(id);
  const store = readStore();
  store.activePersonaId = id;
  writeStore(store);
  return persona;
}

// ─── Test helpers ──────────────────────────────────────────────────────────

/** Wipes the on-disk store. Used by tests; not surfaced via the API. */
export function _resetStoreForTests(): void {
  const p = storePath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
