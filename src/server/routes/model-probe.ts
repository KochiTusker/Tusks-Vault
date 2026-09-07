// Model-probe routes — run a probe, read the cache.
//
// The probe spends real quota (one token per model), so it is never run
// implicitly on a page load. The dashboard reads the cache; the user decides
// when to refresh it.

import { Router } from "express";
import express from "express";
import { getSettings } from "../config/settings";
import { loopbackOnly } from "../util/loopback-only";
import { listKeys, resolveKeyForProvider } from "../keys/store";
import { getCatalogue, isTextModel } from "../llm/openrouter-catalogue";
import { runClaudeCode, CLAUDE_CODE_MODELS } from "../llm/claude-code-cli";
import {
  PROBE_SLOTS,
  probeClaudeCodeModels,
  probeGeminiKey,
  probeOllama,
  probeOpenRouterModels,
  readAvailability,
  updateSlot,
  type ProbeSlot,
} from "../llm/model-probe";

export const modelProbeRouter = Router();

/** Models worth probing on OpenRouter without being told which.
 *
 *  Whatever is configured right now, because that is the one the bot will
 *  actually use and the one whose failure would be most surprising. The model
 *  browser passes explicit ids for anything else. */
function defaultOpenRouterTargets(): string[] {
  const s = getSettings();
  return [s.proModel, s.flashModel].filter(id => id && id.includes("/"));
}

// Gated for consistency with the probe below: this reports which models a key
// was proven able to reach, which is install state rather than campaign data,
// but it lives in a router whose other route spawns a process and there is no
// reason for a LAN visitor to read it.
modelProbeRouter.get("/api/models/availability", loopbackOnly(), (_req, res) => {
  res.json({ slots: readAvailability() });
});

// Gated on the peer address because this route SPAWNS THE CLAUDE CODE CLI
// (runClaudeCode, below) — the same reason routes/claude-code.ts is gated.
// Without it, under the documented HOST=0.0.0.0 a LAN visitor can spawn
// processes on the host and spend the owner's subscription and API credit.
modelProbeRouter.post("/api/models/probe", loopbackOnly(), express.json({ limit: "20kb" }), async (req, res) => {
  const { slot, models } = (req.body ?? {}) as { slot?: string; models?: unknown };
  if (!PROBE_SLOTS.includes(slot as ProbeSlot)) {
    res.status(400).json({ error: `slot must be one of: ${PROBE_SLOTS.join(", ")}` });
    return;
  }
  const requested = Array.isArray(models)
    ? models.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
    : [];

  try {
    const settings = getSettings();
    switch (slot as ProbeSlot) {
      case "gemini:paid":
      case "gemini:free": {
        const tier = slot === "gemini:paid" ? "paid" : "free";
        // Resolve the key for THIS slot specifically. resolveKeyForProvider
        // ignores tier, so a user with both keys would otherwise probe the
        // same one twice and see two identical results — the confusion the
        // fingerprint exists to expose, better avoided than explained.
        const key = listKeys().find(k => k.provider === "gemini" && k.tier === tier)?.key;
        if (!key) {
          res.status(400).json({ error: `No Gemini ${tier}-tier key is stored.` });
          return;
        }
        const value = await probeGeminiKey(key);
        updateSlot(slot as ProbeSlot, value);
        res.json(value);
        return;
      }
      case "openrouter:n/a": {
        const key = resolveKeyForProvider("openrouter") ?? (process.env.OPENROUTER_API_KEY ?? "").trim();
        if (!key) {
          res.status(400).json({ error: "No OpenRouter key is stored." });
          return;
        }
        const targets = requested.length > 0 ? requested : defaultOpenRouterTargets();
        if (targets.length === 0) {
          res.status(400).json({ error: "Nothing to probe — pick a model first." });
          return;
        }
        // The catalogue is free to read and needs no key, so the advertised
        // list costs nothing and keeps the cache's shape uniform.
        let advertised: string[] = [];
        try {
          advertised = (await getCatalogue()).models.filter(isTextModel).map(m => m.id);
        } catch {
          /* advertised is a nicety; the probe results are the point */
        }
        const value = await probeOpenRouterModels(key, targets, advertised);
        // Merge rather than replace: probing one model from the browser must
        // not erase what the user already learned about the others.
        const prior = readAvailability()["openrouter:n/a"];
        if (prior && prior.keyFingerprint === value.keyFingerprint) {
          const merged = new Map(prior.probed.map(p => [p.id, p]));
          for (const p of value.probed) merged.set(p.id, p);
          value.probed = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
        }
        updateSlot("openrouter:n/a", value);
        res.json(value);
        return;
      }
      case "claudeCode": {
        const value = await probeClaudeCodeModels(
          requested.length > 0 ? requested : CLAUDE_CODE_MODELS,
          (model, prompt) => runClaudeCode({ model, prompt })
        );
        updateSlot("claudeCode", value);
        res.json(value);
        return;
      }
      case "ollama": {
        const value = await probeOllama(settings.ollamaBaseUrl);
        updateSlot("ollama", value);
        res.json(value);
        return;
      }
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
