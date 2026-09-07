// Which surfaces exist, whether they are on, and what answers for them.
//
// Two questions that look alike and are not:
//
//   botPaused           "answer nothing right now"  — global, temporary, a
//                       prominent Home-tab switch the user flips mid-session
//   surface.enabled     "this route does not exist" — per-surface, durable
//
// Collapsing them would make the pause card lie: a user who paused the bot and
// later re-enabled Discord would find pause silently undone, or vice versa.

import type { Settings, SurfaceConfig } from "../config/settings";
import type { SurfaceId } from "./types";

export const SURFACE_IDS: SurfaceId[] = ["discord", "foundry", "mcp"];

/** Config for one surface, with the defaults applied. Never returns
 *  undefined — a caller asking about an unknown surface gets a disabled one
 *  rather than a crash, because an unrecognised surface should be inert, not
 *  fatal. */
export function surfaceConfig(settings: Settings, surface: SurfaceId): SurfaceConfig {
  const configured = settings.surfaces?.[surface];
  return configured ?? { enabled: false };
}

export function isSurfaceEnabled(settings: Settings, surface: SurfaceId): boolean {
  return surfaceConfig(settings, surface).enabled === true;
}

/**
 * Settings as this surface should see them.
 *
 * A surface may pin its own provider and model — that is what lets the chat
 * surfaces answer on a Claude Code subscription while the dashboard's own work
 * (vault-map builds, persona generation) keeps using whatever is globally
 * selected.
 *
 * Resolution is surface override → global. The returned object is a copy;
 * mutating it must not reconfigure the whole app.
 */
export function resolveSurfaceProvider(settings: Settings, surface: SurfaceId): Settings {
  const config = surfaceConfig(settings, surface);
  if (!config.provider && !config.model) return settings;

  const next: Settings = { ...settings };
  if (config.provider) next.provider = config.provider;
  if (config.model) {
    // Pin BOTH tiers. A surface override names one model, and leaving the
    // other tier pointing at the global provider's model id would send a
    // Gemini id to Claude Code the moment anything asked for the other tier.
    next.proModel = config.model;
    next.flashModel = config.model;
  }
  return next;
}
