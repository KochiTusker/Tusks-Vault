import { Router } from "express";
import express from "express";
import {
  BuiltinPersonaError,
  PersonaNotFoundError,
  createUserPersona,
  deleteUserPersona,
  findPersona,
  getActivePersona,
  listPersonas,
  setActivePersona,
  updateUserPersona,
} from "../personas/store";
import { TEMPLATE_PROMPT, getPresetById } from "../personas/presets";
import { generatePersonaFromPrompt } from "../personas/generate";
import { formatAdapterError } from "../llm/registry";
import { isSafeSlug } from "../util/safe-slug";
import { loopbackOnly } from "../util/loopback-only";

// In-memory token bucket for /api/personas/generate. Single-user app, so a
// per-process counter is sufficient — the threat model is a drive-by page
// triggering paid-LLM calls (denial-of-wallet), not a distributed flood.
// 5 generations/minute is enough for legitimate "let me iterate on this idea"
// usage while making a runaway script obviously slow.
const GENERATE_RATE_WINDOW_MS = 60_000;
const GENERATE_RATE_MAX = 5;
const generateTimestamps: number[] = [];

function checkGenerateRateLimit(): { allowed: true } | { allowed: false; retryAfterSec: number } {
  const now = Date.now();
  while (generateTimestamps.length > 0 && generateTimestamps[0] < now - GENERATE_RATE_WINDOW_MS) {
    generateTimestamps.shift();
  }
  if (generateTimestamps.length >= GENERATE_RATE_MAX) {
    const retryAfterSec = Math.max(1, Math.ceil((generateTimestamps[0] + GENERATE_RATE_WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  generateTimestamps.push(now);
  return { allowed: true };
}

/** Test hook — reset the bucket between cases. Not exposed via the API. */
export function _resetGenerateRateLimitForTests(): void {
  generateTimestamps.length = 0;
}

// Personas are part of the app. There is no install step, so there is no
// gate: every route below is always live. The previous version 404'd them
// behind an add-on marker, which meant the feature could be "uninstalled"
// while the user's authored personas.json sat on disk — a state with no
// upside that only made the surface harder to find.

export const personasRouter = Router();

// GET /api/personas
//   Returns the full persona catalogue (presets + user-authored) plus the
//   currently active id. Shape:
//     { personas: PersonaRow[], activePersonaId: string, templatePrompt: string }
//   `templatePrompt` is included so the "Add new (from template)" flow in the
//   UI has the canonical chronicler text without a second round-trip.
personasRouter.get("/api/personas", (_req, res) => {
  const personas = listPersonas();
  const active = getActivePersona();
  res.json({
    personas,
    activePersonaId: active?.id ?? "chronicler",
    templatePrompt: TEMPLATE_PROMPT,
  });
});

// POST /api/personas
//   Creates a user persona. Body: { name, description?, prompt }.
//   Returns the created PersonaRow.
// AUTHORING A PERSONA PROMPT IS A HOST-LEVEL ACT, so the three routes that
// write prompt text are gated on the peer address like the other host-level
// settings. `settings.systemInstruction` is gated in routes/settings.ts for
// exactly this reason, and gating only that one was theatre: chat/ask.ts uses
// `settings.systemInstruction` ONLY when the default Chronicler is active — an
// active custom persona's `prompt` replaces it outright. So the ungated route
// outranked the gated one, and a LAN peer under HOST=0.0.0.0 could author the
// whole base system prompt by creating a persona instead of editing settings.
//
// The canonical-rules re-injection in prompt/assemble.ts is only a partial
// defence: hasCanonicalRules matches the seven rule headings, so a crafted
// prompt that reproduces those headings passes without the block meaning
// anything.
//
// Deliberately NOT gated: GET (read), clone (copies a shipped preset, so the
// text is ours), DELETE, and PATCH /api/personas/active — switching between
// personas that already exist is exactly the kind of thing a LAN visitor is
// meant to do, and every shipped preset carries the canonical rules.
personasRouter.post("/api/personas", loopbackOnly(), express.json({ limit: "200kb" }), (req, res) => {
  const { name, description, prompt } = (req.body ?? {}) as {
    name?: unknown;
    description?: unknown;
    prompt?: unknown;
  };
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Body must include a non-empty `name` string." });
    return;
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "Body must include a non-empty `prompt` string." });
    return;
  }
  try {
    const created = createUserPersona({
      name,
      description: typeof description === "string" ? description : "",
      prompt,
    });
    res.status(201).json(created);
  } catch (err) {
    console.error("[personas] create failed:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/personas/clone/:presetId
//   Convenience: copies a preset into a user-editable persona. Returns the
//   new row. UI calls this from the "Customise this preset" button.
personasRouter.post("/api/personas/clone/:presetId", (req, res) => {
  if (!isSafeSlug(req.params.presetId)) {
    res.status(400).json({ error: "Invalid preset id." });
    return;
  }
  const preset = getPresetById(req.params.presetId);
  if (!preset) {
    res.status(404).json({ error: `Unknown preset: ${req.params.presetId}` });
    return;
  }
  try {
    const created = createUserPersona({
      name: `${preset.name} (custom)`,
      description: preset.description,
      prompt: preset.prompt,
    });
    res.status(201).json(created);
  } catch (err) {
    console.error("[personas] clone failed:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/personas/generate
//   Body: { prompt: string }. Calls the user's active LLM with a meta-system
//   prompt that asks for a JSON persona definition, parses it, stitches it
//   back together against the canonical seven-rule template, and returns a
//   { name, description, prompt } payload — NOT yet persisted. The UI then
//   shows the result in the editor; the user reviews and clicks Save to
//   actually create the row.
// Gated with the other two: the caller's free-form brief becomes a persona
// prompt, and it spends the owner's key to get there.
personasRouter.post("/api/personas/generate", loopbackOnly(), express.json({ limit: "10kb" }), async (req, res) => {
  const limit = checkGenerateRateLimit();
  if (limit.allowed === false) {
    res.setHeader("Retry-After", String(limit.retryAfterSec));
    res.status(429).json({
      error: `Too many persona generations. Try again in ${limit.retryAfterSec}s.`,
    });
    return;
  }
  const { prompt } = (req.body ?? {}) as { prompt?: unknown };
  if (typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "Body must include a non-empty `prompt` string." });
    return;
  }
  try {
    const generated = await generatePersonaFromPrompt(prompt);
    res.json(generated);
  } catch (err) {
    console.error("[personas] generate failed:", err);
    res.status(500).json({ error: formatAdapterError(err) });
  }
});

// PATCH /api/personas/active
//   Body: { id: string }. Sets the active persona used by the Discord
//   handler. Returns the activated PersonaRow.
personasRouter.patch("/api/personas/active", express.json({ limit: "10kb" }), (req, res) => {
  const { id } = (req.body ?? {}) as { id?: unknown };
  if (typeof id !== "string" || !id.trim()) {
    res.status(400).json({ error: "Body must include a non-empty `id` string." });
    return;
  }
  if (!isSafeSlug(id.trim())) {
    res.status(400).json({ error: "Invalid persona id." });
    return;
  }
  try {
    const activated = setActivePersona(id);
    res.json(activated);
  } catch (err) {
    if (err instanceof PersonaNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error("[personas] activate failed:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// PATCH /api/personas/:id
//   Body: { name?, description?, prompt? }. Updates a user persona. 404 for
//   unknown ids; 409 for presets (use clone first).
personasRouter.patch("/api/personas/:id", loopbackOnly(), express.json({ limit: "200kb" }), (req, res) => {
  if (!isSafeSlug(req.params.id)) {
    res.status(400).json({ error: "Invalid persona id." });
    return;
  }
  const { name, description, prompt } = (req.body ?? {}) as {
    name?: unknown;
    description?: unknown;
    prompt?: unknown;
  };
  if (!findPersona(req.params.id)) {
    res.status(404).json({ error: `Persona not found: ${req.params.id}` });
    return;
  }
  try {
    const updated = updateUserPersona(req.params.id, {
      name: typeof name === "string" ? name : undefined,
      description: typeof description === "string" ? description : undefined,
      prompt: typeof prompt === "string" ? prompt : undefined,
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof BuiltinPersonaError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof PersonaNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error("[personas] update failed:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /api/personas/:id
personasRouter.delete("/api/personas/:id", (req, res) => {
  if (!isSafeSlug(req.params.id)) {
    res.status(400).json({ error: "Invalid persona id." });
    return;
  }
  try {
    deleteUserPersona(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BuiltinPersonaError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof PersonaNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error("[personas] delete failed:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});
