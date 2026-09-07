import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addKey,
  deleteKey,
  getActiveKey,
  getKeyById,
  listKeys,
  listKeysPublic,
  resolveKeyForProvider,
  setActiveKey,
} from "./store";

// keys/store.ts persists ENCRYPTED to the platform config dir, resolved
// lazily through TUSKS_VAULT_CONFIG_DIR — so each test points that at a
// tmpdir. cwd is swapped too, so nothing here can touch the real repo.
let tmpDir: string;
let originalCwd: string;
let originalConfigDir: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-vault-keys-"));
  originalCwd = process.cwd();
  originalConfigDir = process.env.TUSKS_VAULT_CONFIG_DIR;
  process.env.TUSKS_VAULT_CONFIG_DIR = tmpDir;
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalConfigDir === undefined) delete process.env.TUSKS_VAULT_CONFIG_DIR;
  else process.env.TUSKS_VAULT_CONFIG_DIR = originalConfigDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("addKey", () => {
  it("creates a key with a generated UUID id and ISO createdAt", () => {
    const k = addKey({ provider: "openrouter", label: "test", tier: "paid", key: "sk-abc123XYZ789" });
    expect(k.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(k.provider).toBe("openrouter");
    expect(k.label).toBe("test");
    expect(k.tier).toBe("paid");
    expect(k.key).toBe("sk-abc123XYZ789");
    expect(new Date(k.createdAt).toString()).not.toBe("Invalid Date");
  });

  it("falls back to a default label when the input is empty/whitespace", () => {
    const k = addKey({ provider: "openrouter", label: "   ", tier: "paid", key: "sk-xxxxxxxxxxxx" });
    expect(k.label).toBe("openrouter key");
  });

  it("trims surrounding whitespace from the raw key before persisting", () => {
    const k = addKey({ provider: "openrouter", label: "t", tier: "paid", key: "  sk-yyyyyyyyyyyy\t" });
    expect(k.key).toBe("sk-yyyyyyyyyyyy");
  });

  it("auto-activates the first key added (no 'no-active gap' for new users)", () => {
    const k = addKey({ provider: "gemini", label: "first", tier: "paid", key: "AIza-xxxxxxxxx" });
    expect(getActiveKey()?.id).toBe(k.id);
  });

  it("does NOT steal the active slot when a second key is added", () => {
    const first = addKey({ provider: "gemini", label: "first", tier: "paid", key: "AIza-aaaa" });
    const second = addKey({ provider: "openrouter", label: "second", tier: "paid", key: "sk-bbbb" });
    expect(getActiveKey()?.id).toBe(first.id);
    expect(second.id).not.toBe(first.id);
  });
});

describe("listKeysPublic — masking invariant", () => {
  it("NEVER returns the raw `key` field (regression guard against secret leaks)", () => {
    addKey({ provider: "openrouter", label: "t", tier: "paid", key: "sk-1234567890ABCDEFGH" });
    const rows = listKeysPublic();
    expect(rows).toHaveLength(1);
    // The compiled type already excludes `key`, but a future regression could
    // accidentally include it. Assert at runtime too — this is a security boundary.
    expect((rows[0] as unknown as Record<string, unknown>).key).toBeUndefined();
    expect(rows[0].maskedKey).toBe("sk-1...EFGH");
  });

  it("masks short keys (<8 chars) as '***' so we never reveal half of a tiny key", () => {
    addKey({ provider: "openrouter", label: "tiny", tier: "paid", key: "abc" });
    expect(listKeysPublic()[0].maskedKey).toBe("***");
  });

  it("shows first-4 + last-4 for keys ≥ 8 chars", () => {
    addKey({ provider: "openrouter", label: "t", tier: "paid", key: "12345678" });
    expect(listKeysPublic()[0].maskedKey).toBe("1234...5678");
  });
});

describe("deleteKey", () => {
  it("removes the key from the persisted list", () => {
    const a = addKey({ provider: "openrouter", label: "a", tier: "n/a", key: "sk-aaaa1234aaaa" });
    const b = addKey({ provider: "openrouter", label: "b", tier: "paid", key: "sk-bbbb1234bbbb" });
    deleteKey(a.id);
    const remaining = listKeys();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(b.id);
  });

  it("falls back to the first remaining key when the active one is deleted", () => {
    const a = addKey({ provider: "openrouter", label: "a", tier: "n/a", key: "sk-aaaa1234aaaa" });
    const b = addKey({ provider: "openrouter", label: "b", tier: "paid", key: "sk-bbbb1234bbbb" });
    expect(getActiveKey()?.id).toBe(a.id);
    deleteKey(a.id);
    expect(getActiveKey()?.id).toBe(b.id);
  });

  it("leaves activeKeyId=null when the last key is deleted", () => {
    const a = addKey({ provider: "openrouter", label: "a", tier: "n/a", key: "sk-aaaa1234aaaa" });
    deleteKey(a.id);
    expect(getActiveKey()).toBeNull();
    expect(listKeys()).toEqual([]);
  });
});

describe("setActiveKey", () => {
  it("activates an existing key by id", () => {
    const a = addKey({ provider: "openrouter", label: "a", tier: "n/a", key: "sk-aaaa1234aaaa" });
    const b = addKey({ provider: "openrouter", label: "b", tier: "paid", key: "sk-bbbb1234bbbb" });
    expect(getActiveKey()?.id).toBe(a.id);
    setActiveKey(b.id);
    expect(getActiveKey()?.id).toBe(b.id);
  });

  it("throws on an unknown id (caller passed something stale)", () => {
    addKey({ provider: "openrouter", label: "a", tier: "n/a", key: "sk-aaaa1234aaaa" });
    expect(() => setActiveKey("not-a-real-id")).toThrow(/No key with id/);
  });

  it("allows clearing the active key (null)", () => {
    addKey({ provider: "openrouter", label: "a", tier: "n/a", key: "sk-aaaa1234aaaa" });
    setActiveKey(null);
    expect(getActiveKey()).toBeNull();
  });
});

describe("resolveKeyForProvider — precedence", () => {
  it("prefers the active key when its provider matches", () => {
    addKey({ provider: "openrouter", label: "a", tier: "paid", key: "sk-openai-aaaa" });
    const other = addKey({ provider: "openrouter", label: "b", tier: "n/a", key: "sk-or-bbbb" });
    setActiveKey(other.id);
    expect(resolveKeyForProvider("openrouter")).toBe("sk-or-bbbb");
  });

  it("falls back to the first stored key for the provider when the active key is for a different provider", () => {
    const gemini = addKey({ provider: "gemini", label: "a", tier: "paid", key: "AIza-aaaa" });
    addKey({ provider: "openrouter", label: "b", tier: "n/a", key: "sk-or-bbbb" });
    setActiveKey(gemini.id);
    expect(resolveKeyForProvider("openrouter")).toBe("sk-or-bbbb");
  });

  it("returns null when no key matches the provider", () => {
    addKey({ provider: "gemini", label: "a", tier: "paid", key: "AIza-aaaa1234" });
    expect(resolveKeyForProvider("openrouter")).toBeNull();
  });
});

describe("getKeyById", () => {
  it("returns the full key (including raw secret) for a known id", () => {
    const a = addKey({ provider: "openrouter", label: "a", tier: "n/a", key: "sk-aaaa1234aaaa" });
    const found = getKeyById(a.id);
    expect(found?.key).toBe("sk-aaaa1234aaaa");
  });

  it("returns null for an unknown id", () => {
    expect(getKeyById("nope")).toBeNull();
  });
});

describe("file permissions on disk", () => {
  it.skipIf(process.platform === "win32")(
    "locks keys.enc to owner-only (0o600) on POSIX",
    () => {
      addKey({ provider: "openrouter", label: "a", tier: "n/a", key: "sk-aaaa1234aaaa" });
      const mode = fs.statSync(path.join(tmpDir, "keys.enc")).mode & 0o777;
      expect(mode).toBe(0o600);
    },
  );
});

describe("atomic persistence", () => {
  it("leaves no stray .tmp file behind after a successful write", () => {
    addKey({ provider: "openrouter", label: "a", tier: "n/a", key: "sk-aaaa1234aaaa" });
    const stray = fs.readdirSync(tmpDir).filter(f => f.endsWith(".tmp"));
    expect(stray).toEqual([]);
  });
});

describe("encryption at rest", () => {
  it("the on-disk store never contains the raw key bytes", () => {
    addKey({ provider: "openrouter", label: "a", tier: "n/a", key: "sk-secretsecret9999" });
    const onDisk = fs.readFileSync(path.join(tmpDir, "keys.enc"), "utf-8");
    expect(onDisk).not.toContain("sk-secretsecret9999");
    // …but the store round-trips it faithfully.
    expect(resolveKeyForProvider("openrouter")).toBe("sk-secretsecret9999");
  });

  it("a corrupt store reads as empty, never throws", () => {
    addKey({ provider: "openrouter", label: "a", tier: "n/a", key: "sk-aaaa1234aaaa" });
    fs.writeFileSync(path.join(tmpDir, "keys.enc"), "not an encrypted document");
    expect(listKeys()).toEqual([]);
  });

  it("a tampered ciphertext fails GCM auth and reads as empty", () => {
    addKey({ provider: "openrouter", label: "a", tier: "n/a", key: "sk-aaaa1234aaaa" });
    const file = path.join(tmpDir, "keys.enc");
    const doc = JSON.parse(fs.readFileSync(file, "utf-8"));
    const bytes = Buffer.from(doc.ciphertext, "base64");
    bytes[0] ^= 0xff;
    doc.ciphertext = bytes.toString("base64");
    fs.writeFileSync(file, JSON.stringify(doc));
    expect(listKeys()).toEqual([]);
  });
});

