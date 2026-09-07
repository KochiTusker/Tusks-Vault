import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSettings, saveSettings } from "./settings";

// SETTINGS_PATH is cwd-based, so each test gets its own working directory.
let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-settings-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const settingsFile = () => path.join(tmpDir, "settings.json");

describe("getSettings — normal paths", () => {
  it("returns defaults when no file exists, without creating one", () => {
    const s = getSettings();
    expect(s.provider).toBeTruthy();
    expect(s.loreSource).toBe("folder");
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  it("reads a saved file back", () => {
    const s = getSettings();
    s.botName = "Chronicler";
    saveSettings(s);
    expect(getSettings().botName).toBe("Chronicler");
  });

  it("fills in fields an older file predates", () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ botName: "Tusk" }), "utf-8");
    const s = getSettings();
    expect(s.botName).toBe("Tusk");
    expect(s.loreSource).toBe("folder");
    expect(s.useVaultMap).toBe(true);
  });
});

describe("surfaces — the migration that matters", () => {
  it("defaults Discord ON for a settings file written before surfaces existed", () => {
    // THE regression to guard. Discord used to be implicitly on whenever a
    // token was configured. Defaulting it off would silently switch a working
    // bot off on upgrade and the user's table goes quiet with no explanation.
    fs.writeFileSync(settingsFile(), JSON.stringify({ botName: "Tusk", provider: "gemini" }), "utf-8");
    expect(getSettings().surfaces.discord.enabled).toBe(true);
  });

  it("defaults the new surfaces OFF", () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ botName: "Tusk" }), "utf-8");
    const s = getSettings();
    expect(s.surfaces.foundry.enabled).toBe(false);
    expect(s.surfaces.mcp.enabled).toBe(false);
  });

  it("defaults allowPlayers to false — the ceiling is opt-in", () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({}), "utf-8");
    expect(getSettings().surfaces.foundry.allowPlayers).toBe(false);
  });

  it("round-trips an explicit surface config", () => {
    const s = getSettings();
    s.surfaces.discord = { enabled: false, provider: "claudeCode", model: "haiku" };
    s.surfaces.foundry = { enabled: true, allowPlayers: true };
    saveSettings(s);
    const back = getSettings();
    expect(back.surfaces.discord).toEqual({ enabled: false, provider: "claudeCode", model: "haiku" });
    expect(back.surfaces.foundry.enabled).toBe(true);
    expect(back.surfaces.foundry.allowPlayers).toBe(true);
  });

  it("drops a provider that is not a real provider", () => {
    // A hand-edited file can carry any string; an unrecognised one would
    // reach getAdapter and silently resolve to Gemini.
    fs.writeFileSync(
      settingsFile(),
      JSON.stringify({ surfaces: { discord: { enabled: true, provider: "gpt-9" } } }),
      "utf-8"
    );
    expect(getSettings().surfaces.discord.provider).toBeUndefined();
  });

  it("ignores a non-boolean enabled rather than treating it as truthy", () => {
    fs.writeFileSync(
      settingsFile(),
      JSON.stringify({ surfaces: { foundry: { enabled: "yes" } } }),
      "utf-8"
    );
    expect(getSettings().surfaces.foundry.enabled).toBe(false);
  });
});

describe("getSettings — a file that will not parse", () => {
  // The behaviour this exists for: leaving a broken file in place means every
  // later read fails identically, logs the same error, and silently ignores
  // every setting the user ever chose. Observed as four identical stack
  // traces on a single boot, with the bot quietly running on defaults.
  const CORRUPT = '{"botName":"Tusk"}\n} stale tail from a torn write';

  it("recovers with defaults instead of throwing", () => {
    fs.writeFileSync(settingsFile(), CORRUPT, "utf-8");
    expect(() => getSettings()).not.toThrow();
    expect(getSettings().loreSource).toBe("folder");
  });

  it("moves the unreadable file aside rather than deleting it", () => {
    // It may hold a lore path or a system prompt worth retyping from.
    fs.writeFileSync(settingsFile(), CORRUPT, "utf-8");
    getSettings();
    const kept = fs.readdirSync(tmpDir).filter(f => f.includes(".corrupt-"));
    expect(kept).toHaveLength(1);
    expect(fs.readFileSync(path.join(tmpDir, kept[0]), "utf-8")).toBe(CORRUPT);
  });

  it("writes a clean file, so the SECOND read succeeds normally", () => {
    // The whole point. Without this, the error repeats forever.
    fs.writeFileSync(settingsFile(), CORRUPT, "utf-8");
    getSettings();
    expect(() => JSON.parse(fs.readFileSync(settingsFile(), "utf-8"))).not.toThrow();
    const errorsBefore = (console.error as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    getSettings();
    expect((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(errorsBefore);
  });

  it("quarantines each corruption to its own file rather than overwriting the last", () => {
    fs.writeFileSync(settingsFile(), CORRUPT, "utf-8");
    getSettings();
    fs.writeFileSync(settingsFile(), "also broken {", "utf-8");
    getSettings();
    expect(fs.readdirSync(tmpDir).filter(f => f.includes(".corrupt-")).length).toBeGreaterThanOrEqual(1);
  });

  it("says where the file went", () => {
    fs.writeFileSync(settingsFile(), CORRUPT, "utf-8");
    getSettings();
    const said = (console.error as unknown as { mock: { calls: string[][] } }).mock.calls
      .map(c => c.join(" "))
      .join("\n");
    expect(said).toMatch(/corrupt-/);
    expect(said).toMatch(/defaults/);
  });
});

describe("saveSettings", () => {
  it("replaces a longer previous file completely", () => {
    // A short write over a long file that does not truncate is exactly how
    // the corruption above is produced.
    const s = getSettings();
    s.systemInstruction = "x".repeat(5000);
    saveSettings(s);
    s.systemInstruction = "short";
    saveSettings(s);
    expect(() => JSON.parse(fs.readFileSync(settingsFile(), "utf-8"))).not.toThrow();
    expect(getSettings().systemInstruction).toBe("short");
  });

  it("leaves no temp file behind", () => {
    saveSettings(getSettings());
    expect(fs.readdirSync(tmpDir).filter(f => f.includes(".tmp"))).toEqual([]);
  });
});

describe("data-sharing consent is stored, and never widened by accident", () => {
  it("defaults to consenting to nothing", () => {
    // The privacy floor is the default; consent has to be an act.
    expect(getSettings().openRouterDataSharingOptIn).toEqual([]);
  });

  it("round-trips an explicit consent", () => {
    fs.writeFileSync(
      settingsFile(),
      JSON.stringify({ openRouterDataSharingOptIn: ["vendor/model:free"] })
    );
    expect(getSettings().openRouterDataSharingOptIn).toEqual(["vendor/model:free"]);
  });

  it("reads a malformed value as consent to nothing", () => {
    // Anything unparseable must narrow what may be shared, never widen it.
    for (const bad of ["everything", 1, true, { "vendor/model": true }, null]) {
      fs.writeFileSync(settingsFile(), JSON.stringify({ openRouterDataSharingOptIn: bad }));
      expect(getSettings().openRouterDataSharingOptIn).toEqual([]);
    }
  });

  it("drops non-string and empty entries from a partly valid list", () => {
    fs.writeFileSync(
      settingsFile(),
      JSON.stringify({ openRouterDataSharingOptIn: ["good/model", "", 42, null, "other/model"] })
    );
    expect(getSettings().openRouterDataSharingOptIn).toEqual(["good/model", "other/model"]);
  });

  it("survives a save/load cycle", () => {
    const s = getSettings();
    s.openRouterDataSharingOptIn = ["a/b:free"];
    saveSettings(s);
    expect(getSettings().openRouterDataSharingOptIn).toEqual(["a/b:free"]);
  });
});
