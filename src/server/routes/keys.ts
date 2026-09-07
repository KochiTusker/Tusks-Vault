import { Router } from "express";
import express from "express";
import {
  addKey,
  deleteKey,
  getActiveKeyPublic,
  getKeyById,
  listKeysPublic,
  setActiveKey,
  KeyTier,
} from "../keys/store";
import { LlmProvider, getSettings, saveSettings } from "../config/settings";
import { createGeminiAdapter } from "../llm/gemini";
import { verifyOpenRouterKey } from "../llm/openrouter";
import { getCatalogue, isTextModel } from "../llm/openrouter-catalogue";
import { invalidateSlot, type ProbeSlot } from "../llm/model-probe";
import { reconcileModels } from "../llm/model-namespace";
import { resolveProvider } from "../llm/registry";

export const keysRouter = Router();

/** Keep the saved models callable by whatever provider is now active.
 *
 *  Model namespaces do not overlap, so a connection switch can leave the
 *  PREVIOUS provider's id saved against the new one — a Gemini connection
 *  pointed at an `owner/model` OpenRouter id, which Google 404s on every
 *  question while the dashboard still shows it as the chosen model. Only ids
 *  that provably cannot belong are replaced; a merely unfamiliar one is the
 *  user's deliberate choice and stays. */
function applyProviderModels(settings: ReturnType<typeof getSettings>): void {
  const next = reconcileModels(settings.provider, settings);
  if (!next) return;
  settings.proModel = next.proModel;
  settings.flashModel = next.flashModel;
}

/** Write `settings.provider` back to whatever the active key now says, and
 *  pull the saved models into that namespace with it.
 *
 *  Called after any change that can re-point the active key WITHOUT going
 *  through /api/active-channel — adding the first key (which auto-activates)
 *  and deleting the active one (which falls back to whatever remains). Both
 *  otherwise leave settings.provider naming a connection that is no longer
 *  the one being called. */
function syncProviderToActiveKey(): void {
  const settings = getSettings();
  const resolved = resolveProvider(settings);
  const models = reconcileModels(resolved, settings);
  if (settings.provider === resolved && !models) return;
  settings.provider = resolved;
  if (models) {
    settings.proModel = models.proModel;
    settings.flashModel = models.flashModel;
  }
  saveSettings(settings);
}

/** Which probe slot a stored key feeds, or null for one that feeds none.
 *  A probe describes what a specific key could reach; when that key changes,
 *  the cached answer is about a key that is no longer there. */
function slotForKey(provider: string, tier: string): ProbeSlot | null {
  if (provider === "gemini") return tier === "free" ? "gemini:free" : "gemini:paid";
  if (provider === "openrouter") return "openrouter:n/a";
  return null;
}

keysRouter.get("/api/keys", (_req, res) => {
  res.json({
    keys: listKeysPublic(),
    active: getActiveKeyPublic(),
  });
});

keysRouter.post("/api/keys", express.json({ limit: "10kb" }), (req, res) => {
  const { provider, label, tier, key } = req.body ?? {};
  if (!provider || !key) {
    res.status(400).json({ error: "provider and key are required" });
    return;
  }
  if (!["gemini", "openrouter", "ollama", "claudeCode"].includes(provider)) {
    // Anthropic and OpenAI are the two people try anyway, because they hold a
    // key for them. Say where those models actually live rather than making
    // them guess from "invalid provider".
    const viaOpenRouter = provider === "anthropic" || provider === "openai";
    res.status(400).json({
      error: viaOpenRouter
        ? `Vault has no direct ${provider} key slot. Those models are reached through OpenRouter — one key covers both, at one bill.`
        : "invalid provider",
    });
    return;
  }
  // Neither of these takes a key: Ollama runs locally, and Claude Code bills
  // against the user's subscription through their own signed-in CLI.
  if (provider === "ollama" || provider === "claudeCode") {
    res.status(400).json({
      error:
        provider === "ollama"
          ? "Ollama runs locally and does not need an API key"
          : "Claude Code runs on your subscription and does not take an API key",
    });
    return;
  }
  const created = addKey({
    provider: provider as LlmProvider,
    label: typeof label === "string" ? label : "",
    tier: (tier === "free" || tier === "paid" || tier === "n/a" ? tier : "n/a") as KeyTier,
    key: String(key),
  });
  const slot = slotForKey(created.provider, created.tier);
  if (slot) invalidateSlot(slot);
  // The FIRST key added auto-activates, so this can change which provider is
  // live without anyone calling /api/active-channel.
  syncProviderToActiveKey();
  res.json({
    id: created.id,
    provider: created.provider,
    label: created.label,
    tier: created.tier,
    createdAt: created.createdAt,
  });
});

keysRouter.delete("/api/keys/:id", (req, res) => {
  const target = getKeyById(req.params.id);
  deleteKey(req.params.id);
  if (target) {
    const slot = slotForKey(target.provider, target.tier);
    if (slot) invalidateSlot(slot);
  }
  // Deleting the ACTIVE key re-points the active one to whatever remains, so
  // settings.provider can now name a different connection than the one that
  // will be called. Left alone, that drift is silent — and it is one of the
  // two ways a saved model id ends up belonging to the wrong provider.
  syncProviderToActiveKey();
  res.json({ message: "Key deleted" });
});

// Verifies a stored key works by spinning a temporary adapter (without
// touching the active-key state) and calling listModels(). A successful
// response means: the provider accepts the key AND there's at least one
// text-generation model the dashboard would show. Errors are returned as
// 200 with `{ ok: false, error }` so the UI can surface a friendly message
// instead of a network-error panel.
keysRouter.post("/api/keys/:id/test", async (req, res) => {
  const key = getKeyById(req.params.id);
  if (!key) {
    res.status(404).json({ ok: false, error: "Key not found" });
    return;
  }
  try {
    const settings = getSettings();
    let listModels: (() => Promise<Array<{ id: string }>>) | undefined;
    switch (key.provider) {
      case "gemini":
        listModels = createGeminiAdapter({
          apiKey: key.key,
          proModel: settings.proModel,
          flashModel: settings.flashModel,
        }).listModels;
        break;
      case "openrouter": {
        // The catalogue is public, so listModels() succeeds with any key —
        // it would make this Test button a rubber stamp. Verify against the
        // authenticated /key endpoint instead, then report the catalogue
        // size the picker will show.
        const verdict = await verifyOpenRouterKey(key.key);
        if (!verdict.ok) {
          res.json({ ok: false, error: verdict.error });
          return;
        }
        const cat = await getCatalogue();
        res.json({ ok: true, modelCount: cat.models.filter(isTextModel).length });
        return;
      }
      default:
        res.json({ ok: false, error: `No test available for provider ${key.provider}` });
        return;
    }
    if (!listModels) {
      res.json({ ok: false, error: "Test not implemented for this provider yet" });
      return;
    }
    const models = await listModels();
    res.json({ ok: true, modelCount: models.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, error: msg });
  }
});

keysRouter.post("/api/keys/active", express.json({ limit: "10kb" }), (req, res) => {
  const { id } = req.body ?? {};
  try {
    setActiveKey(id === null ? null : String(id));
    res.json({ active: getActiveKeyPublic() });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Atomic Active Channel switch from the front-page picker. Either selects a
// stored key (and aligns settings.provider to it) or selects one of the
// keyless providers — which also clears the active key, so a leftover
// cloud key can't be picked up by the env fallback behind the user's back.
const KEYLESS_KINDS = ["ollama", "claudeCode"] as const;
type KeylessKind = (typeof KEYLESS_KINDS)[number];

keysRouter.post("/api/active-channel", express.json({ limit: "10kb" }), (req, res) => {
  const { kind, id } = req.body ?? {};
  const isKeyless = KEYLESS_KINDS.includes(kind as KeylessKind);
  if (kind !== "key" && !isKeyless) {
    res.status(400).json({ error: `kind must be 'key', ${KEYLESS_KINDS.map(k => `'${k}'`).join(" or ")}` });
    return;
  }
  const settings = getSettings();

  if (isKeyless) {
    setActiveKey(null);
    settings.provider = kind as KeylessKind;
    applyProviderModels(settings);
    saveSettings(settings);
    res.json({
      ok: true,
      active: null,
      provider: settings.provider,
      proModel: settings.proModel,
      flashModel: settings.flashModel,
    });
    return;
  }

  if (!id) {
    res.status(400).json({ error: "id is required when kind is 'key'" });
    return;
  }

  try {
    setActiveKey(String(id));
    const active = getActiveKeyPublic();
    if (active) {
      settings.provider = active.provider;
      applyProviderModels(settings);
      saveSettings(settings);
    }
    res.json({
      ok: true,
      active,
      provider: settings.provider,
      proModel: settings.proModel,
      flashModel: settings.flashModel,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
