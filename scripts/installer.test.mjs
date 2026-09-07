// The one-file installers are the first code a stranger runs on their own
// machine, and they are downloaded rather than read. That makes a few of their
// properties contracts rather than preferences.
//
// Two of these would be genuine incidents if they regressed: pointing the clone
// at the wrong remote, and teaching users to pipe a remote script into a shell.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_REPO = "https://github.com/KochiTusker/Tusks-Vault.git";

const SCRIPTS = {
  windows: fs.readFileSync(path.join(REPO_ROOT, "install-tusks-vault.bat"), "utf-8"),
  unix: fs.readFileSync(path.join(REPO_ROOT, "install-tusks-vault.sh"), "utf-8"),
};

describe.each(Object.entries(SCRIPTS))("%s installer", (_name, src) => {
  it("clones the public repository", () => {
    expect(src).toContain(PUBLIC_REPO);
  });

  it("reaches no GitHub URL other than the public repository", () => {
    // Asserted as an allow-list rather than a denial of one specific remote:
    // any *other* GitHub URL appearing here is worth a human look, whether or
    // not anyone anticipated it.
    const urls = [...src.matchAll(/https:\/\/github\.com\/[^\s"'`)]+/g)].map(m => m[0]);
    // The clone URL and the human-facing repo page are both legitimate; any
    // OTHER GitHub URL here is worth a human look.
    const allowed = new Set([PUBLIC_REPO, PUBLIC_REPO.replace(".git", "")]);
    for (const url of urls) expect([url, allowed.has(url)]).toEqual([url, true]);
  });

  it("clones rather than downloading an archive", () => {
    // The in-app updater runs `git pull --ff-only`. An archive install produces
    // a Vault that can never update itself, which the user would not discover
    // for weeks.
    expect(src).toMatch(/git clone/);
    // Matched against URLs rather than prose — the prose in these scripts
    // explains why an archive install is wrong, and must be allowed to.
    expect(src).not.toMatch(/https?:\/\/\S+\.(?:zip|tar\.gz)/i);
  });

  it("never pipes a remote script into a shell", () => {
    // The most-copied installer pattern, and the one this project's release
    // gate and secret scanners exist to be inconsistent with. Whatever else
    // changes here, this must not.
    expect(src).not.toMatch(/\|\s*(iex|bash|sh)\b/i);
    expect(src).not.toMatch(/\b(irm|iwr|Invoke-WebRequest|Invoke-RestMethod)\b/i);
    expect(src).not.toMatch(/curl[^\n]*\|/i);
  });

  it("resolves the default location from the environment, never a literal path", () => {
    expect(src).toMatch(/%USERPROFILE%|\$HOME/);
    // A drive-letter path with a user folder in it would mean someone pasted
    // their own machine's layout in.
    expect(src).not.toMatch(/[A-Z]:\\Users\\[A-Za-z0-9._-]+/);
    expect(src).not.toMatch(/\/(?:home|Users)\/[A-Za-z0-9._-]+/);
  });

  it("checks Node and git before it clones anything", () => {
    // Written against markers rather than one literal expression: the Windows
    // script does its check in a subroutine defined at the bottom of the file,
    // so "where the version string appears" says nothing about run order.
    const clone = src.indexOf("git clone");
    expect(clone).toBeGreaterThan(-1);
    expect(src).toContain("process.versions.node");
    const positions = ["NEED_NODE", "NEED_GIT", "check_node", "node -p"]
      .map(marker => src.indexOf(marker))
      .filter(index => index >= 0);
    expect(positions.length).toBeGreaterThan(0);
    expect(Math.min(...positions)).toBeLessThan(clone);
  });

  it("requires Node 20 or newer, matching package.json engines", () => {
    const engines = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8")).engines.node;
    const declared = engines.match(/(\d+)/)[1];
    expect(src).toContain(`${declared}`);
    expect(src).toMatch(/LSS 20|-lt 20/);
  });

  it("asks before installing a prerequisite", () => {
    // Missing Node or git produces a prompt and the exact command, never a
    // silent system change.
    // Both scripts PRINT the command first, then ask, then run it — so the
    // invariant is that the prompt precedes the last occurrence (the actual
    // invocation), not the first (which is the one shown to the user).
    const shown = src.search(/winget install|brew install/);
    const run = Math.max(src.lastIndexOf("winget install"), src.lastIndexOf("brew install"));
    expect(shown).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(shown);
    // Scoped to the span between showing the command and running it. Both files
    // prompt elsewhere too, so an unscoped search proves nothing about THIS
    // decision.
    expect(src.slice(shown, run)).toMatch(/\[Y\/n\]|\[y\/N\]/);
  });

  it("offers a non-default install location", () => {
    // The whole point of the menu: the default is a recommendation, not a
    // decision made for the user.
    expect(src).toMatch(/Type a path/);
    expect(src).toMatch(/\[Q\]/);
  });

  it("refuses to overwrite a non-empty folder", () => {
    expect(src).toMatch(/not empty/i);
  });

  it("shows the full plan and confirms before it clones", () => {
    // The headline promise: a user who declines has changed nothing. If the
    // clone ever moves above the confirmation, that promise is silently gone.
    const plan = src.search(/What this will do|installed to/i);
    const confirm = src.search(/Continue\? \[Y\/n\]/);
    const clone = src.indexOf("git clone");
    expect(plan).toBeGreaterThan(-1);
    expect(plan).toBeLessThan(confirm);
    expect(confirm).toBeLessThan(clone);
  });

  it("names every location it writes to", () => {
    // "Explicitly tell the user what is installed where" — the install folder,
    // the dependency folder, and the settings folder that lives outside it.
    expect(src).toMatch(/node_modules/);
    expect(src).toMatch(/models/);
    expect(src).toMatch(/tusks-vault[\/]Config|\.config|APPDATA|HOME/);
  });

  it("verifies the clone actually produced the program", () => {
    // `git clone` reports success for a repository with no commits, leaving a
    // folder containing only .git. Without this check the next failure is a
    // baffling "setup.bat is not recognized".
    expect(src).toMatch(/run\.sh|run\.bat/);
    expect(src).toMatch(/empty|no published release/i);
  });

  it("contains no stray control characters", () => {
    // The run.bat path literal in the Windows installer once had its
    // backslash replaced by a raw 0x0D. cmd.exe can never match a path
    // containing a control character, so the post-clone check above failed on
    // every single run and the installer deleted the clone it had just made.
    // The token test directly above passed anyway, because run.bat also
    // appears in four other lines of the same file.
    //
    // A raw NUL byte elsewhere in the tree caused the same shape of
    // problem: an escape sequence resolved into the byte it names
    // somewhere along the write path. Tokens cannot see that, so assert
    // on the bytes.
    let bad = -1;
    for (let i = 0; i < src.length; i++) {
      const c = src.charCodeAt(i);
      const strayCr = c === 13 && src.charCodeAt(i + 1) !== 10;
      const otherCtrl = c < 32 && c !== 10 && c !== 13 && c !== 9;
      if (strayCr || otherCtrl) { bad = i; break; }
    }
    const found = bad === -1 ? "none" : "0x" + src.charCodeAt(bad).toString(16) + " at index " + bad;
    expect(found).toBe("none");
  });
});

describe("windows installer", () => {
  it("offers the native folder browser", () => {
    expect(SCRIPTS.windows).toContain("FolderBrowserDialog");
  });

  it("never guards a goto with an ampersand after a set", () => {
    // cmd splits on "&" at the top level, so `if X set A & goto B` runs the
    // goto unconditionally. This shipped once and made every menu choice fall
    // through to the default. Written without regex so the assertion itself
    // cannot be mangled by escaping.
    const offending = SCRIPTS.windows
      .split(String.fromCharCode(10))
      .map(line => line.trim())
      .filter(line => line.toLowerCase().startsWith("if ")
        && line.includes("set ")
        && line.includes("& goto"));
    expect(offending).toEqual([]);
  });

  it("steers away from system-protected and sync-backed folders", () => {
    // Each of these produces an npm failure much later and much less legibly.
    expect(SCRIPTS.windows).toMatch(/Program Files/);
    expect(SCRIPTS.windows).toMatch(/OneDrive/);
  });
});

describe("unix installer", () => {
  it("refuses to run as root", () => {
    // A root-owned clone locks the regular user out of every future update —
    // the same trap setup.sh guards against.
    expect(SCRIPTS.unix).toMatch(/id -u/);
    expect(SCRIPTS.unix).toMatch(/sudo/i);
  });

  it("hands off to run.sh rather than reimplementing the first start", () => {
    expect(SCRIPTS.unix).toMatch(/run\.sh/);
  });
});
