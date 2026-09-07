import fs from "fs";
import path from "path";

// Resolved lazily so a test (or a launcher that chdir's after import) sees
// the current cwd. Production never chdir's after boot, so behaviour is
// unchanged for real users.
function envLocalPath(): string {
  return path.join(process.cwd(), ".env.local");
}

// Update or insert a KEY=VALUE line in .env.local, preserving comments and the
// rest of the file. Also updates process.env so the next consumer sees it.
export function setEnvVar(key: string, value: string): void {
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
    throw new Error(`Refusing to write invalid env key: ${key}`);
  }
  // Without this guard, a value containing `\n` would inject a second
  // env var on the following line (e.g. NODE_OPTIONS=--require=/tmp/evil.js).
  // NUL bytes break .env parsers in surprising ways. Reject both up front.
  if (typeof value !== "string" || /[\r\n\x00]/.test(value)) {
    throw new Error(`Refusing to write env value for ${key}: values may not contain newlines or NUL bytes.`);
  }

  const newLine = `${key}=${value}`;
  const existing = fs.existsSync(envLocalPath()) ? fs.readFileSync(envLocalPath(), "utf-8") : "";
  const lines = existing.split(/\r?\n/);

  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`${key}=`)) {
      lines[i] = newLine;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    // Ensure exactly one trailing newline.
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    lines.push(newLine);
  }
  lines.push(""); // trailing newline

  fs.writeFileSync(envLocalPath(), lines.join("\n"));
  // .env.local holds the Discord bot token (and any future secrets). Lock to
  // owner-only on POSIX. Windows: skip — fs.chmodSync only toggles the
  // readonly attribute there, which is wrong semantics.
  if (process.platform !== "win32") {
    try { fs.chmodSync(envLocalPath(), 0o600); } catch { /* best-effort */ }
  }
  process.env[key] = value;
}

export function readEnvVar(key: string): string {
  return process.env[key]?.trim() ?? "";
}
