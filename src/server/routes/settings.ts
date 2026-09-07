import { Router } from "express";
import express from "express";
import { getSettings, saveSettings, LOOPBACK_BASE_URL_RE } from "../config/settings";
import { resolveProvider } from "../llm/registry";
import { _isLoopbackAddress } from "../util/loopback-only";

// SSRF guard for ollamaBaseUrl. The Ollama adapter resolves this string into
// `fetch(\`${baseUrl}/api/tags\`)`, so a non-loopback host turns the dashboard
// into an SSRF gadget (e.g. http://169.254.169.254 for cloud metadata, or any
// internal LAN service). Loopback-only is the right product invariant:
// "Local LLMs" by definition.
// One definition, imported. A duplicate here and in config/settings.ts is two
// halves of the same guard that a future edit can silently desynchronise —
// and the load-path half is the one a hand-edited settings.json meets.
const LOOPBACK_HTTP_URL_RE = LOOPBACK_BASE_URL_RE;

export const settingsRouter = Router();

settingsRouter.get("/api/settings", (_req, res) => {
  const settings = getSettings();
  // Report the provider that will actually be called, not the stored field.
  // An active key outranks `settings.provider` (see llm/registry.ts), so the
  // stored value goes stale — and a dashboard reading it renders the wrong
  // connection's controls against the right connection's model list.
  res.json({ ...settings, provider: resolveProvider(settings) });
});

settingsRouter.post("/api/settings", express.json({ limit: "200kb" }), (req, res) => {
  const settings = getSettings();
  const body = req.body ?? {};
  // systemInstruction is NOT assigned here — it is gated below with the other
  // host-level fields, and a gated field assigned before its own 403 is one
  // caching change away from being no gate at all.
  if (body.modelName !== undefined) settings.modelName = body.modelName;
  // Stage 2 fields — accepted now so the storage shape is forward-compatible.
  if (body.provider !== undefined) settings.provider = body.provider;
  if (body.proModel !== undefined) settings.proModel = body.proModel;
  if (body.flashModel !== undefined) settings.flashModel = body.flashModel;
  if (body.defaultTier !== undefined) settings.defaultTier = body.defaultTier;
  // Per-model consent to drop the privacy floor. Validated hard: anything
  // that is not a list of non-empty strings is stored as consent to nothing,
  // because a malformed value must never widen what a request may share.
  if (body.openRouterDataSharingOptIn !== undefined) {
    const raw: unknown[] = Array.isArray(body.openRouterDataSharingOptIn)
      ? body.openRouterDataSharingOptIn
      : [];
    settings.openRouterDataSharingOptIn = [
      ...new Set(raw.filter((m): m is string => typeof m === "string" && m.trim().length > 0)),
    ];
  }
  if (body.ollamaBaseUrl !== undefined) {
    const candidate = String(body.ollamaBaseUrl).trim();
    if (candidate && !LOOPBACK_HTTP_URL_RE.test(candidate)) {
      res.status(400).json({
        error: "ollamaBaseUrl must point at a loopback address (http://localhost:11434, http://127.0.0.1:<port>, http://[::1]:<port>).",
      });
      return;
    }
    settings.ollamaBaseUrl = candidate || settings.ollamaBaseUrl;
  }
  if (body.clarificationTopK !== undefined) settings.clarificationTopK = Number(body.clarificationTopK);
  if (body.clarificationThreshold !== undefined) settings.clarificationThreshold = Number(body.clarificationThreshold);
  if (body.botName !== undefined) {
    const trimmed = String(body.botName).trim();
    if (trimmed) settings.botName = trimmed;
  }
  if (body.speculativeMode !== undefined) settings.speculativeMode = !!body.speculativeMode;
  if (body.includeReferences !== undefined) settings.includeReferences = !!body.includeReferences;
  if (body.botPaused !== undefined) settings.botPaused = !!body.botPaused;
  if (body.guardrails !== undefined && body.guardrails && typeof body.guardrails === "object") {
    // Merge so a partial update doesn't reset unsent flags. Boolean-coerce on
    // the way in so the on-disk shape stays canonical.
    const g = body.guardrails as Record<string, unknown>;
    settings.guardrails = {
      harassment: typeof g.harassment === "boolean" ? g.harassment : settings.guardrails.harassment,
      hate: typeof g.hate === "boolean" ? g.hate : settings.guardrails.hate,
      sexual: typeof g.sexual === "boolean" ? g.sexual : settings.guardrails.sexual,
      dangerous: typeof g.dangerous === "boolean" ? g.dangerous : settings.guardrails.dangerous,
    };
  }
  // loreSource / obsidianVaultPath / tomesSessionsPath each name a directory
  // on the HOST that the server then reads and indexes. Under HOST=0.0.0.0 a
  // LAN visitor reaches this route by design, so they carry the same loopback
  // gate as /api/obsidian/* — otherwise they are simply a way around it.
  //
  // tomesSessionsPath belongs in here for the same reason as the other two,
  // and the chain that makes it matter is complete: this sets the directory,
  // /api/integrations/tomes enumerates it, and .../tomes/sync copies what it
  // finds into the knowledge corpus, which /api/knowledge then serves back.
  // Ungated, that is a read-any-directory primitive, not a convenience field.
  if (
    body.loreSource !== undefined ||
    body.obsidianVaultPath !== undefined ||
    body.tomesSessionsPath !== undefined ||
    body.systemInstruction !== undefined
  ) {
    if (!_isLoopbackAddress(req.socket?.remoteAddress)) {
      res.status(403).json({
        error:
          "Choosing which folder on the host machine to read lore from, or rewriting the system " +
          "prompt, only works from that machine. Open the dashboard on the host itself.",
      });
      return;
    }
    if (body.loreSource !== undefined) {
      settings.loreSource = body.loreSource === "obsidian" ? "obsidian" : "folder";
    }
    if (body.obsidianVaultPath !== undefined) {
      const v = typeof body.obsidianVaultPath === "string" ? body.obsidianVaultPath.trim() : "";
      settings.obsidianVaultPath = v || undefined;
    }
    if (body.tomesSessionsPath !== undefined) {
      const v = typeof body.tomesSessionsPath === "string" ? body.tomesSessionsPath.trim() : "";
      settings.tomesSessionsPath = v || undefined;
    }
    if (body.systemInstruction !== undefined) {
      settings.systemInstruction = body.systemInstruction;
    }
  }
  if (body.useVaultMap !== undefined) settings.useVaultMap = !!body.useVaultMap;
  if (body.surfaces !== undefined && body.surfaces && typeof body.surfaces === "object") {
    // Merged per surface and per FIELD, never replaced wholesale. The panel
    // sends one changed toggle at a time, and a whole-object assignment would
    // let a payload that omitted `allowPlayers` quietly reset the player
    // ceiling to its default — a permission widening by omission.
    const incoming = body.surfaces as Record<string, Record<string, unknown>>;
    for (const id of ["discord", "foundry", "mcp"] as const) {
      const patch = incoming[id];
      if (!patch || typeof patch !== "object") continue;
      const target = settings.surfaces[id];
      if (patch.enabled !== undefined) target.enabled = !!patch.enabled;
      // An empty string is how the panel says "follow the global setting", so
      // it must clear the override rather than pin the empty string.
      if (patch.provider !== undefined) {
        target.provider = patch.provider ? (String(patch.provider) as typeof target.provider) : undefined;
      }
      if (patch.model !== undefined) {
        target.model = patch.model ? String(patch.model) : undefined;
      }
    }
    const foundryPatch = incoming.foundry;
    if (foundryPatch && foundryPatch.allowPlayers !== undefined) {
      settings.surfaces.foundry.allowPlayers = !!foundryPatch.allowPlayers;
    }
  }
  if (body.updaterRemote !== undefined) {
    // Validate against the closed union — anything outside "origin"/"dev"
    // is treated as "origin" so a hand-edited settings.json can't smuggle
    // an arbitrary string into git fetch.
    settings.updaterRemote = body.updaterRemote === "dev" ? "dev" : "origin";
  }
  saveSettings(settings);
  // Return what was actually PERSISTED, not just an acknowledgement. An
  // instant-save toggle that reports success on the strength of a 200 is
  // claiming something it never checked — and a toggle that silently failed
  // to stick is precisely the bug this shape prevents: the dashboard showed
  // Speculative Mode on for weeks while the server held false, because the
  // flag only ever left the browser inside the bulk Save button.
  res.json({
    message: "Settings saved successfully",
    settings: { ...settings, provider: resolveProvider(settings) },
  });
});
