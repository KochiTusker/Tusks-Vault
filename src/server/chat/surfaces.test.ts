import { describe, expect, it } from "vitest";
import { isSurfaceEnabled, resolveSurfaceProvider, surfaceConfig, SURFACE_IDS } from "./surfaces";
import type { Settings } from "../config/settings";

/** A Settings object with only the fields these helpers read. */
function settings(over: Partial<Settings> = {}): Settings {
  return {
    provider: "gemini",
    proModel: "gemini-2.5-pro",
    flashModel: "gemini-3-flash-preview",
    defaultTier: "flash",
    surfaces: {
      discord: { enabled: true },
      foundry: { enabled: false, allowPlayers: false },
      mcp: { enabled: false },
    },
    ...over,
  } as Settings;
}

describe("surfaceConfig", () => {
  it("returns the configured surface", () => {
    expect(surfaceConfig(settings(), "discord").enabled).toBe(true);
  });

  it("returns a DISABLED config for a surface the settings file predates", () => {
    // An unrecognised or missing surface must be inert, not fatal. A settings
    // file written by an older build has no `mcp` key at all.
    const s = settings({ surfaces: { discord: { enabled: true } } as never });
    expect(surfaceConfig(s, "mcp").enabled).toBe(false);
    expect(isSurfaceEnabled(s, "mcp")).toBe(false);
  });

  it("survives settings with no surfaces block at all", () => {
    const s = settings({ surfaces: undefined as never });
    for (const id of SURFACE_IDS) expect(isSurfaceEnabled(s, id)).toBe(false);
  });
});

describe("isSurfaceEnabled", () => {
  it("requires an explicit true", () => {
    // Guards against a hand-edited `"enabled": "yes"` reading as truthy and
    // quietly opening a surface.
    const s = settings({
      surfaces: { discord: { enabled: "yes" } } as never,
    });
    expect(isSurfaceEnabled(s, "discord")).toBe(false);
  });
});

describe("resolveSurfaceProvider", () => {
  it("returns the settings unchanged when the surface pins nothing", () => {
    const s = settings();
    expect(resolveSurfaceProvider(s, "discord")).toBe(s);
  });

  it("applies a surface's provider override", () => {
    // The point of the whole feature: the chat surfaces answer on a Claude
    // Code subscription while the dashboard keeps its own provider.
    const s = settings({
      surfaces: {
        discord: { enabled: true, provider: "claudeCode" },
        foundry: { enabled: false, allowPlayers: false },
        mcp: { enabled: false },
      },
    });
    expect(resolveSurfaceProvider(s, "discord").provider).toBe("claudeCode");
    expect(resolveSurfaceProvider(s, "foundry").provider).toBe("gemini");
  });

  it("does NOT mutate the global settings", () => {
    // A surface override that reconfigured the whole app would mean the first
    // Discord message silently repointed the dashboard.
    const s = settings({
      surfaces: {
        discord: { enabled: true, provider: "claudeCode", model: "haiku" },
        foundry: { enabled: false, allowPlayers: false },
        mcp: { enabled: false },
      },
    });
    resolveSurfaceProvider(s, "discord");
    expect(s.provider).toBe("gemini");
    expect(s.proModel).toBe("gemini-2.5-pro");
  });

  it("pins BOTH tiers when a surface names a model", () => {
    // Pinning only one tier would send a Gemini model id to Claude Code the
    // moment anything asked for the other tier.
    const s = settings({
      surfaces: {
        discord: { enabled: true, provider: "claudeCode", model: "haiku" },
        foundry: { enabled: false, allowPlayers: false },
        mcp: { enabled: false },
      },
    });
    const eff = resolveSurfaceProvider(s, "discord");
    expect(eff.proModel).toBe("haiku");
    expect(eff.flashModel).toBe("haiku");
  });

  it("keeps the global model when the surface pins only a provider", () => {
    const s = settings({
      surfaces: {
        discord: { enabled: true, provider: "openrouter" },
        foundry: { enabled: false, allowPlayers: false },
        mcp: { enabled: false },
      },
    });
    expect(resolveSurfaceProvider(s, "discord").proModel).toBe("gemini-2.5-pro");
  });
});
