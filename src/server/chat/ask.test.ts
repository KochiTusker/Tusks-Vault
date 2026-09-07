import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { answerGate } from "./ask";
import { getSettings, saveSettings } from "../config/settings";

// getSettings resolves settings.json from cwd, so each test gets its own.
let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-ask-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a settings file and return the coerced result. */
function withSettings(mutate: (s: ReturnType<typeof getSettings>) => void) {
  const s = getSettings();
  mutate(s);
  saveSettings(s);
}

describe("answerGate", () => {
  // This gate exists so a surface can be silent BEFORE it does anything
  // observable. Discord's original handler checked pause before sendTyping
  // precisely so a paused bot produces no "typing…" flicker and no reply to a
  // bare mention; an earlier version of the surfaces refactor moved that check
  // inside ask(), which is too late — the indicator was already up. These
  // tests pin the mechanism that makes early silence possible.

  it("allows an enabled surface when the bot is running", () => {
    withSettings(s => {
      s.botPaused = false;
      s.surfaces.discord.enabled = true;
    });
    expect(answerGate("discord")).toEqual({ allowed: true });
  });

  it("refuses every surface when the bot is paused", () => {
    withSettings(s => {
      s.botPaused = true;
      s.surfaces.discord.enabled = true;
      s.surfaces.foundry.enabled = true;
    });
    expect(answerGate("discord")).toEqual({ allowed: false, reason: "paused" });
    expect(answerGate("foundry")).toEqual({ allowed: false, reason: "paused" });
  });

  it("reports pause and disabled as DIFFERENT reasons", () => {
    // A surface renders them differently: pause is the user's own switch and
    // deserves silence; disabled may warrant a one-time hint. Collapsing them
    // into a bare boolean loses that.
    withSettings(s => {
      s.botPaused = false;
      s.surfaces.foundry.enabled = false;
    });
    expect(answerGate("foundry").reason).toBe("disabled");
  });

  it("puts pause ahead of the per-surface switch", () => {
    // Both false — the reason should be the global one, because that is the
    // switch the user most recently flipped and the one they will look at.
    withSettings(s => {
      s.botPaused = true;
      s.surfaces.discord.enabled = false;
    });
    expect(answerGate("discord").reason).toBe("paused");
  });

  it("refuses a surface the settings file has never heard of", () => {
    withSettings(s => {
      s.botPaused = false;
    });
    expect(answerGate("mcp").allowed).toBe(false);
  });

  it("reads settings live, so flipping pause takes effect without a restart", () => {
    // The Home-tab pause card promises instant effect. A gate that cached
    // settings at import would keep answering for the rest of the session.
    withSettings(s => {
      s.botPaused = false;
      s.surfaces.discord.enabled = true;
    });
    expect(answerGate("discord").allowed).toBe(true);
    withSettings(s => {
      s.botPaused = true;
    });
    expect(answerGate("discord").allowed).toBe(false);
  });
});
