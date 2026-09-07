// The app's own version, read once from package.json.
//
// Not `process.env.npm_package_version`: that is only populated when the
// process was started through an npm script, so a direct `node`/`tsx` launch —
// or a packaged install — silently reports the fallback instead. The version is
// shown to users and returned on a pre-auth endpoint, so a quietly wrong value
// is worse than a loud failure to read one.
import { readFileSync } from "fs";
import path from "path";

let cached: string | null = null;

export function appVersion(): string {
  if (cached !== null) return cached;
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf-8")
    ) as { version?: unknown };
    cached = typeof pkg.version === "string" && pkg.version ? pkg.version : "unknown";
  } catch {
    // A missing or unreadable package.json means the install is not intact.
    // "unknown" is honest; a plausible-looking number would not be.
    cached = "unknown";
  }
  return cached;
}
