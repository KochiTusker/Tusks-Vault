import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BuiltinPersonaError,
  PersonaNotFoundError,
  _resetStoreForTests,
  createUserPersona,
  deleteUserPersona,
  findPersona,
  getActivePersona,
  getActivePersonaId,
  listPersonas,
  setActivePersona,
  updateUserPersona,
} from "./store";
import { DEFAULT_ACTIVE_PERSONA_ID, PERSONA_PRESETS } from "./presets";

// Each test gets its own config dir via TUSKS_VAULT_CONFIG_DIR — the same
// override keys/store.test.ts uses. Without it these tests read and write
// the real per-user config directory.
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-vault-personas-"));
  process.env.TUSKS_VAULT_CONFIG_DIR = tmpDir;
  _resetStoreForTests();
});

afterEach(() => {
  delete process.env.TUSKS_VAULT_CONFIG_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("listPersonas — preset visibility", () => {
  it("lists every built-in preset before any user-authored persona, in registry order", () => {
    const rows = listPersonas();
    const presetRows = rows.filter(r => r.builtin);
    expect(presetRows.map(p => p.id)).toEqual(PERSONA_PRESETS.map(p => p.id));
    // All preset rows are flagged builtin=true.
    expect(presetRows.every(r => r.builtin === true)).toBe(true);
  });

  it("keeps presets visible even when a user persona is also stored", () => {
    createUserPersona({ name: "Custom", description: "x", prompt: "be brief." });
    const rows = listPersonas();
    expect(rows.filter(r => r.builtin)).toHaveLength(PERSONA_PRESETS.length);
    expect(rows.filter(r => !r.builtin)).toHaveLength(1);
  });

  it("returns presets even when the store file is missing", () => {
    expect(fs.existsSync(path.join(tmpDir, "personas.user.json"))).toBe(false);
    expect(listPersonas().length).toBeGreaterThanOrEqual(PERSONA_PRESETS.length);
  });
});

describe("createUserPersona", () => {
  it("creates a non-builtin persona with a fresh UUID id and timestamps", () => {
    const created = createUserPersona({ name: "Bard", description: "musical", prompt: "rhyme everything." });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.builtin).toBe(false);
    expect(created.name).toBe("Bard");
    expect(created.description).toBe("musical");
    expect(created.prompt).toBe("rhyme everything.");
    expect(typeof created.createdAt).toBe("number");
    expect(typeof created.updatedAt).toBe("number");
  });

  it("falls back to 'Untitled persona' when name is whitespace", () => {
    const created = createUserPersona({ name: "   ", prompt: "be brief." });
    expect(created.name).toBe("Untitled persona");
  });

  it("trims surrounding whitespace from prompt and description", () => {
    const created = createUserPersona({ name: "X", description: "  d  ", prompt: "  do thing.  " });
    expect(created.description).toBe("d");
    expect(created.prompt).toBe("do thing.");
  });
});

describe("updateUserPersona", () => {
  it("updates name/description/prompt and bumps updatedAt", async () => {
    const created = createUserPersona({ name: "X", prompt: "old." });
    // Sleep one ms so updatedAt > createdAt despite Date.now() ticking only on ms boundaries.
    await new Promise(r => setTimeout(r, 2));
    const updated = updateUserPersona(created.id, { name: "Y", prompt: "new." });
    expect(updated.name).toBe("Y");
    expect(updated.prompt).toBe("new.");
    expect(updated.updatedAt).toBeGreaterThan(created.createdAt);
  });

  it("throws BuiltinPersonaError when targeting a preset id", () => {
    expect(() => updateUserPersona("chronicler", { name: "no" })).toThrow(BuiltinPersonaError);
    expect(() => updateUserPersona("champion", { name: "no" })).toThrow(BuiltinPersonaError);
  });

  it("throws PersonaNotFoundError when targeting an unknown id", () => {
    expect(() => updateUserPersona("not-a-real-id", { name: "x" })).toThrow(PersonaNotFoundError);
  });
});

describe("deleteUserPersona", () => {
  it("removes a user persona", () => {
    const a = createUserPersona({ name: "A", prompt: "a." });
    createUserPersona({ name: "B", prompt: "b." });
    deleteUserPersona(a.id);
    expect(findPersona(a.id)).toBeUndefined();
  });

  it("throws BuiltinPersonaError on preset ids", () => {
    expect(() => deleteUserPersona("chronicler")).toThrow(BuiltinPersonaError);
  });

  it("throws PersonaNotFoundError on unknown ids", () => {
    expect(() => deleteUserPersona("not-a-real-id")).toThrow(PersonaNotFoundError);
  });

  it("resets the active id to the default Chronicler when the active user persona is deleted", () => {
    const a = createUserPersona({ name: "A", prompt: "a." });
    setActivePersona(a.id);
    expect(getActivePersonaId()).toBe(a.id);
    deleteUserPersona(a.id);
    expect(getActivePersonaId()).toBe(DEFAULT_ACTIVE_PERSONA_ID);
  });

  it("leaves the active id alone when deleting a NON-active user persona", () => {
    const a = createUserPersona({ name: "A", prompt: "a." });
    const b = createUserPersona({ name: "B", prompt: "b." });
    setActivePersona(b.id);
    deleteUserPersona(a.id);
    expect(getActivePersonaId()).toBe(b.id);
  });
});

describe("setActivePersona", () => {
  it("activates a preset", () => {
    setActivePersona("champion");
    expect(getActivePersona()?.id).toBe("champion");
  });

  it("activates a user persona", () => {
    const created = createUserPersona({ name: "X", prompt: "x." });
    setActivePersona(created.id);
    expect(getActivePersona()?.id).toBe(created.id);
  });

  it("throws PersonaNotFoundError on unknown id", () => {
    expect(() => setActivePersona("not-a-real-id")).toThrow(PersonaNotFoundError);
  });
});

describe("readStore — corruption resilience", () => {
  it("returns presets + empty user list when personas.user.json is malformed JSON", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "personas.user.json"), "{ not valid json", "utf-8");
    const rows = listPersonas();
    expect(rows.filter(r => r.builtin).length).toBe(PERSONA_PRESETS.length);
    expect(rows.filter(r => !r.builtin).length).toBe(0);
  });

  it("silently drops user-persona entries with wrong field types", () => {
    fs.writeFileSync(
      path.join(tmpDir, "personas.user.json"),
      JSON.stringify({
        version: 1,
        activePersonaId: "chronicler",
        userPersonas: [
          // valid
          { id: "valid-id-1234", name: "OK", description: "", prompt: "p", createdAt: 1, updatedAt: 2 },
          // invalid (name not a string)
          { id: "bad", name: 42, description: "", prompt: "p", createdAt: 1, updatedAt: 2 },
        ],
      }),
      "utf-8",
    );
    const userRows = listPersonas().filter(r => !r.builtin);
    expect(userRows).toHaveLength(1);
    expect(userRows[0].name).toBe("OK");
  });
});
