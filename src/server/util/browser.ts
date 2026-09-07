import { exec } from "child_process";

// Best-effort browser open. Gated by TUSKS_VAULT_OPEN_BROWSER=1 so dev workflows
// that don't want this (e.g. `npm run dev` from a terminal) aren't surprised.
export function openBrowser(url: string): void {
  if (process.env.TUSKS_VAULT_OPEN_BROWSER !== "1") return;
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, err => {
    if (err) console.warn(`Could not auto-open browser: ${err.message}`);
  });
}
