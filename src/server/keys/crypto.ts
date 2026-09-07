// Machine-bound encryption for the API-key store.
//
// Algorithm: AES-256-GCM. Key derivation: scrypt over a stable machine
// identity (hostname + username + platform) salted by a per-machine random
// value stored alongside the ciphertext. Be honest about what this is:
// OBFUSCATION with authenticated encryption, not high-grade cryptography —
// anything running as this user on this machine can derive the key. What it
// defeats is the actual threat: a cloud-backup client, a sync folder, a
// screen-share, or a support bundle picking up a file that used to be
// literally named api-keys.json containing literally sk-ant-…. That is a
// far more likely path to a leaked key than a local attacker.
//
// Consequence of the machine binding, documented for support: copying an
// install to a new machine makes the store undecryptable. The store treats
// that as "no keys yet — re-enter them", never as a crash.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

interface EncryptedDocument {
  version: 1;
  iv: string;
  authTag: string;
  ciphertext: string;
}

function readOrCreateSalt(saltPath: string): Buffer {
  try {
    return fs.readFileSync(saltPath);
  } catch (err) {
    // ONLY "there is no salt yet" may mint one.
    //
    // This used to be a bare `catch`, which meant ANY read failure — an
    // antivirus or backup agent holding a transient lock (EBUSY/EPERM), a
    // permissions change (EACCES), fd exhaustion (EMFILE) — overwrote the
    // existing salt with a fresh one. The old salt is 16 random bytes stored
    // nowhere else, so that single write permanently destroyed every stored
    // key: the derived key no longer matches, GCM authentication fails, and
    // the store reports "bound to the machine that wrote it — re-enter your
    // API keys", which is a misdiagnosis. The machine had not changed.
    //
    // Windows is a primary target and %LOCALAPPDATA% is exactly where
    // Defender, OneDrive and backup agents take short-lived locks, so this
    // needed no attacker and no unusual configuration.
    //
    // Every other error is transient or fixable, and rethrowing keeps it that
    // way: decryptJson turns a throw into "no keys this boot" (recoverable on
    // the next one) and encryptJson propagates it, so a write fails loudly
    // rather than persisting under a salt it could not confirm.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const fresh = crypto.randomBytes(16);
  fs.mkdirSync(path.dirname(saltPath), { recursive: true });
  try {
    // `wx` fails if the file appeared between the read and now — another
    // process winning the race must not have its salt overwritten either.
    fs.writeFileSync(saltPath, fresh, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return fs.readFileSync(saltPath);
    throw err;
  }
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(saltPath, 0o600);
    } catch {
      /* best-effort */
    }
  }
  return fresh;
}

// scrypt is deliberately expensive, and the derived key is stable for the
// process lifetime (machine identity + salt don't change), so cache it —
// the store re-reads on every key lookup and must not pay ~50ms each time.
let cachedKey: { saltPath: string; key: Buffer } | null = null;

function deriveKey(saltPath: string): Buffer {
  if (cachedKey && cachedKey.saltPath === saltPath) return cachedKey.key;
  const salt = readOrCreateSalt(saltPath);
  const identity = `${os.hostname()}::${os.userInfo().username}::${process.platform}`;
  const key = crypto.scryptSync(identity, salt, 32);
  cachedKey = { saltPath, key };
  return key;
}

export function encryptJson(value: unknown, saltPath: string): string {
  const key = deriveKey(saltPath);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf-8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const doc: EncryptedDocument = {
    version: 1,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return JSON.stringify(doc);
}

/**
 * Decrypt a document produced by encryptJson. Returns null on ANY failure —
 * wrong machine, corrupt file, tampered ciphertext (GCM auth), bad JSON.
 * The caller decides what an unreadable store means; here it must never
 * throw into a request path.
 */
export function decryptJson<T>(raw: string, saltPath: string): T | null {
  try {
    const doc = JSON.parse(raw) as EncryptedDocument;
    if (doc.version !== 1 || !doc.iv || !doc.authTag || !doc.ciphertext) return null;
    const key = deriveKey(saltPath);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(doc.iv, "base64"));
    decipher.setAuthTag(Buffer.from(doc.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(doc.ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf-8")) as T;
  } catch {
    return null;
  }
}
