import { Router } from "express";
import { getSettings, LlmProvider } from "../config/settings";
import { getAdapter } from "../llm/registry";
import { resolveKeyRecordForProvider } from "../keys/store";
import { readAvailability, verificationOf, type ProbeSlot } from "../llm/model-probe";
import { requiresPaidGeminiKey } from "../llm/gemini-text-models";

export const modelsRouter = Router();

/** Which probe slot describes the connection currently in use.
 *
 *  Gemini needs the active key's tier: a free-tier key and a paid one reach
 *  different models, so labelling a model from the wrong slot's probe would
 *  be worse than not labelling it. Falls back to null — the picker then shows
 *  everything as unverified, which is honest. */
function slotForProvider(provider: LlmProvider): ProbeSlot | null {
  switch (provider) {
    case "gemini": {
      // The key that WOULD be used, not merely the active one: with
      // `?provider=gemini` the caller is asking about a connection they have
      // not switched to, and resolving only the active key there reports
      // every model as unverified — hiding probe results we already hold.
      const key = resolveKeyRecordForProvider("gemini");
      if (!key) return null;
      return key.tier === "free" ? "gemini:free" : "gemini:paid";
    }
    case "openrouter":
      return "openrouter:n/a";
    case "claudeCode":
      return "claudeCode";
    case "ollama":
      return "ollama";
    default:
      return null;
  }
}

// GET /api/models[?provider=...]
//
// Returns the list of models the current key can call. Used by the dashboard
// to populate the Pro/Flash model dropdowns dynamically. With no `?provider`,
// the active-channel provider is used.
//
// Errors are returned as 200 with `{ available: false, reason }` so the UI
// can gracefully fall back to free-text input without showing a scary error.
modelsRouter.get("/api/models", async (req, res) => {
  const settings = getSettings();
  const provider = (typeof req.query.provider === "string" ? req.query.provider : null) as LlmProvider | null;

  try {
    // Passed explicitly rather than by overwriting settings.provider: an
    // active key OUTRANKS that field inside getAdapter, so the old
    // spread-and-hope made `?provider=` silently do nothing whenever any key
    // was active — the route answered about the active connection while
    // labelling it as the requested one.
    const { adapter, provider: resolvedProvider, keyConfigured } = getAdapter(
      settings,
      provider ? { explicitProvider: provider } : {}
    );
    if (!keyConfigured) {
      res.json({
        available: false,
        provider: resolvedProvider,
        reason: "No API key configured for this provider.",
        models: [],
      });
      return;
    }
    if (!adapter.listModels) {
      res.json({
        available: false,
        provider: resolvedProvider,
        reason: "Dynamic model listing isn't supported for this provider yet — type the model id by hand.",
        models: [],
      });
      return;
    }
    const models = await adapter.listModels();
    // Stamp each model with what the last probe found. Sent alongside the
    // list rather than fetched separately so the picker can never render a
    // model and its verification state out of step.
    const slot = slotForProvider(resolvedProvider);
    const cache = slot ? readAvailability() : {};
    const stamped = models.map(m => {
      const v = slot ? verificationOf(cache, slot, m.id) : { state: "unverified" as const };
      // Gemini's Pro models are advertised to a free-tier key and refused on
      // the call, so without this the dropdown offers them, the user picks
      // one, and every question afterwards comes back empty. The probe
      // catches it too — but only once it has been RUN, and running it is
      // opt-in and slow on a free key's request budget. This needs no call.
      //
      // The tier here is the slot the user filed the key under, which is a
      // label, not an entitlement: a billing-enabled key pasted into the
      // free slot is a real thing. So a probe that actually reached the
      // model overrides this, and the gate is a default rather than a
      // verdict.
      const needsPaidKey =
        slot === "gemini:free" && v.state !== "verified" && requiresPaidGeminiKey(m.id);
      return {
        ...m,
        verification: v.state,
        verificationReason: v.reason,
        ...(needsPaidKey ? { needsPaidKey: true } : {}),
      };
    });
    res.json({
      available: true,
      provider: resolvedProvider,
      models: stamped,
      probeSlot: slot,
      probedAt: slot ? (cache[slot]?.fetchedAt ?? null) : null,
    });
  } catch (err) {
    res.json({
      available: false,
      provider: provider ?? settings.provider,
      reason: (err as Error).message,
      models: [],
    });
  }
});
