// The salt is the one irreplaceable byte-string in the key store.
//
// `keys.enc` is recoverable in the sense that the user can re-enter their keys.
// `keys.salt` is 16 random bytes stored nowhere else, and the derived key
// depends on it — so overwriting it does not "reset" the store, it silently and
// permanently destroys every key already in it, on a machine that has not
// changed. readOrCreateSalt used a bare `catch`, so any read failure at all
// took that branch: an antivirus or backup agent holding a transient lock on a
// 16-byte file in %LOCALAPPDATA% was enough, with no attacker and no unusual
// configuration.
//
// These tests pin the distinction the fix turns on: ENOENT may mint a salt,
// and nothing else may.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { encryptJson, decryptJson } from "./crypto";

let tmpDir: string;

// Each test gets its own salt path. deriveKey caches by saltPath for the
// process lifetime, so a shared one would let an earlier test's cached key
// answer a later test and hide exactly what is under test here.
let counter = 0;
const freshSaltPath = () => path.join(tmpDir, `keys-${counter++}.salt`);

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-vault-crypto-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("salt handling", () => {
  it("mints a salt when there is none (ENOENT is the only case that may)", () => {
    const saltPath = freshSaltPath();
    expect(fs.existsSync(saltPath)).toBe(false);

    const raw = encryptJson({ hello: "world" }, saltPath);

    expect(fs.existsSync(saltPath)).toBe(true);
    expect(fs.readFileSync(saltPath)).toHaveLength(16);
    expect(decryptJson(raw, saltPath)).toEqual({ hello: "world" });
  });

  it("does NOT overwrite an existing salt when the read fails for any other reason", () => {
    const saltPath = freshSaltPath();
    const original = Buffer.from("0123456789abcdef", "utf-8");
    fs.writeFileSync(saltPath, original);

    // A lock of exactly the kind Defender / OneDrive / a backup agent takes.
    const busy = Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor) => {
      if (String(p) === saltPath) throw busy;
      return Buffer.alloc(0);
    }) as typeof fs.readFileSync);

    // The failure must surface rather than be papered over with a new salt.
    expect(() => encryptJson({ hello: "world" }, saltPath)).toThrow(/EBUSY/);

    spy.mockRestore();

    // The load-bearing assertion: the salt on disk is untouched, so the keys
    // encrypted under it are still decryptable once the lock clears.
    expect(fs.readFileSync(saltPath)).toEqual(original);
  });

  it("keeps a store readable when a boot hits a transient lock", async () => {
    const saltPath = freshSaltPath();
    const stored = encryptJson({ apiKey: "sk-not-a-real-key" }, saltPath);
    const saltBefore = fs.readFileSync(saltPath);

    // The lock has to be modelled on a FRESH PROCESS, not this one. deriveKey
    // caches the key per salt path for the process lifetime, so once a key is
    // cached the salt is never read again and no lock can be observed — which
    // is why this only ever bit on startup. resetModules gives a new cache,
    // which is the same thing a restart gives.
    vi.resetModules();
    const rebooted = await import("./crypto");

    const locked = Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((
      p: fs.PathOrFileDescriptor
    ) => {
      if (String(p) === saltPath) throw locked;
      return Buffer.alloc(0);
    }) as typeof fs.readFileSync);

    // decryptJson never throws into a request path — it reports "unreadable".
    // Recoverable, and above all not destructive.
    expect(rebooted.decryptJson(stored, saltPath)).toBeNull();
    spy.mockRestore();

    // The load-bearing pair: the salt survived the locked boot...
    expect(fs.readFileSync(saltPath)).toEqual(saltBefore);

    // ...so the next boot still decrypts the store. Before the fix, the locked
    // boot replaced the salt and this returned null forever.
    vi.resetModules();
    const nextBoot = await import("./crypto");
    expect(nextBoot.decryptJson(stored, saltPath)).toEqual({ apiKey: "sk-not-a-real-key" });
  });

  it("does not clobber a salt written by another process between read and write", () => {
    const saltPath = freshSaltPath();
    const winner = Buffer.from("fedcba9876543210", "utf-8");

    // First read says "absent"; by the time we go to write, a racing process
    // has created it. `wx` must lose the race rather than overwrite.
    let readCount = 0;
    const realRead = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(((
      p: fs.PathOrFileDescriptor,
      ...rest: unknown[]
    ) => {
      if (String(p) === saltPath && readCount++ === 0) {
        fs.writeFileSync(saltPath, winner);
        throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
      }
      return (realRead as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.readFileSync);

    encryptJson({ hello: "world" }, saltPath);
    vi.restoreAllMocks();

    expect(fs.readFileSync(saltPath)).toEqual(winner);
  });
});
