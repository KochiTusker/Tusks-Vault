// Answering a question, with no knowledge of where it came from.
//
// Everything here used to live inside discord/handler.ts, interleaved with
// mention-stripping, typing indicators and 2000-character chunking. Only that
// last group is actually about Discord; the rest — the pause check, persona
// resolution, prompt assembly, generation, lore-gap recording, citation
// stripping — is the product.
//
// Surfaces own presentation and nothing else. They decide how to render an
// error, how long a message may be, and whether to whisper; they do not decide
// what the bot knows or how it answers, because two surfaces that disagree
// about that are two different bots.

import { getSettings } from "../config/settings";
import {
  DEFAULT_SYSTEM_INSTRUCTION,
  SPECULATIVE_OVERRIDE,
  buildGuardrailsNudge,
} from "../prompt/system";
import { assemblePromptParts, buildSystemInstruction, retrievalOpts } from "../prompt/assemble";
import { sourceNamesIn, stripReferenceMarkers } from "../prompt/strip-references";
import { recordLoreGap, responseContainsLoreGapTrigger } from "../lore-gaps/store";
import { detectRefusal } from "../llm/refusal";
import { getAdapter } from "../llm/registry";
import { generationStarted, generationFinished } from "../util/generation-state";
import { getActivePersona } from "../personas/store";
import { DEFAULT_ACTIVE_PERSONA_ID } from "../personas/presets";
import { isSurfaceEnabled, resolveSurfaceProvider } from "./surfaces";
import { checkCooldown, concurrencyFor, runQueued } from "./queue";
import type { AskResult, Question, SurfaceId } from "./types";

/** Flat, not a union — `strictNullChecks` is off in this repo. */
export interface AnswerGate {
  allowed: boolean;
  reason?: "paused" | "disabled";
}

/**
 * May this surface answer at all, right now?
 *
 * Separate from ask() and exported deliberately. A surface has side effects it
 * must not perform when the bot is silent — Discord's typing indicator is the
 * clearest: the original handler checked pause *before* sendTyping precisely
 * so a paused bot produces no "Tusk is typing…" flicker, and no reply to a
 * bare mention either. A gate that can only be consulted by calling ask() is a
 * gate that arrives too late to honour that.
 *
 * ask() re-checks this itself, so a surface that forgets is still safe; this
 * is about being silent *earlier*, not about being safe.
 */
export function answerGate(surface: SurfaceId): AnswerGate {
  const settings = getSettings();
  if (settings.botPaused) return { allowed: false, reason: "paused" };
  if (!isSurfaceEnabled(settings, surface)) return { allowed: false, reason: "disabled" };
  return { allowed: true };
}

/**
 * Answer one question.
 *
 * Throws on adapter failure — the surface decides how to show that, because
 * "post an error into a shared game chat" and "reply in a Discord thread" are
 * genuinely different calls. Swallowing it here would leave every surface
 * unable to distinguish a broken key from a quiet bot.
 */
export async function ask(question: Question): Promise<AskResult> {
  // Same gate the surface should already have consulted. Re-checked here so a
  // surface that forgets still cannot make the bot speak while it is off —
  // and logged either way, because "the bot ignored me" is the most common
  // support question and the log should already answer it.
  const gate = answerGate(question.surface);
  if (!gate.allowed) {
    console.log(
      `[ask] ${gate.reason} — ignoring ${question.surface} question from ${question.asker.displayName}`
    );
    return { answered: false, skipped: gate.reason };
  }

  // One person may not occupy the queue on their own. Checked before any work
  // so a held-down Enter key costs nothing — not a prompt assembly, not an
  // embedding, and certainly not a queue slot.
  const cooldown = checkCooldown(question.surface, question.asker.id);
  if (!cooldown.allowed) {
    console.log(
      `[ask] cooldown — ignoring ${question.surface} question from ${question.asker.displayName}`
    );
    return { answered: false, skipped: "cooldown", retryInMs: cooldown.retryInMs };
  }

  const settings = getSettings();

  // The active persona's prompt replaces settings.systemInstruction as the
  // base. Personas already bake in the seven core rules (citation, lore-gap,
  // no-invention, etc.) — we never compose two prompts together. The
  // speculative override still appends on top, exactly as it would for the
  // stock prompt.
  const activePersona = getActivePersona();
  // Drives the persona-voice reinforcement in both the user-prompt
  // INSTRUCTIONS block (front-of-mind for the generation) and the
  // system-prompt closure (last block read — recency bias).
  // "chronicler" is the DEFAULT, not a chosen persona: personas/store.ts
  // coerces a missing activePersonaId back to it, so activePersona is never
  // undefined and the two fallbacks below were both unreachable. That made the
  // dashboard's System Prompt editor a control that wrote a field nothing read,
  // and shipped the persona-voice closure on every question even for the stock
  // Chronicler — which prompt/system.ts explicitly says it should not.
  const usingCustomPersona = !!activePersona && activePersona.id !== DEFAULT_ACTIVE_PERSONA_ID;
  const personaActive = usingCustomPersona;
  const basePrompt = usingCustomPersona
    ? activePersona!.prompt
    : settings.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION;

  const parts = await assemblePromptParts(question.text, {
    ...retrievalOpts(settings),
    personaActive,
  });
  if (question.parts && question.parts.length > 0) {
    parts.push(...question.parts);
  }

  const systemPrompt = buildSystemInstruction(basePrompt, {
    botName: settings.botName,
    speculativeMode: settings.speculativeMode,
    speculativeOverride: SPECULATIVE_OVERRIDE,
    guardrailsNudge: buildGuardrailsNudge(settings.guardrails),
    personaActive,
  });

  // A surface may pin its own provider — the chat surfaces can answer on a
  // Claude Code subscription while the dashboard's own work keeps using
  // whatever is globally selected.
  const effective = resolveSurfaceProvider(settings, question.surface);
  const resolved = getAdapter(effective);
  console.log(
    `[ask] surface=${question.surface} provider=${resolved.provider} tier=${effective.defaultTier} ` +
      `prompt="${question.text.substring(0, 100)}..."`
  );

  // Bracket the LLM call with the shared generating signal so the dashboard's
  // answer-reactive chrome tracks real work. `finally`, not a happy-path
  // decrement — a thrown call must not leave the signal stuck on.
  //
  // Queued per surface, so a table asking four questions at once does not start
  // four generations. Only the generation is inside the queue: assembly and
  // retrieval are cheap next to the model call, and holding a slot across them
  // would serialise work that has no reason to be serial.
  const result = await runQueued(question.surface, concurrencyFor(resolved.provider), async () => {
    generationStarted();
    try {
      return await resolved.adapter.generate({
        systemPrompt,
        userParts: parts,
        tier: effective.defaultTier,
      });
    } finally {
      generationFinished();
    }
  });

  if (!result.text) {
    console.error(`[ask] empty response from ${resolved.adapter.name} model=${result.modelUsed}`);
    return { answered: false, skipped: "empty", modelUsed: result.modelUsed };
  }

  // A decline is not a lore gap. "I won't rank people that way" says nothing
  // about the chronicle being incomplete, and recording it would put a
  // question in the DM's queue that no clarification could ever resolve.
  // Runs first so the gap path can be skipped outright.
  const refusal = detectRefusal(result.text);
  if (refusal.refused) {
    console.log(`[ask] model declined (${refusal.kind}): ${refusal.matched ?? ""}`);
  }

  // Both detectors read the RAW model output, before stripping. Neither the
  // trigger phrase nor a decline carries a citation marker, so stripping
  // would not change either result — but doing it in this order keeps the
  // contract obvious.
  const loreGapRecorded = !refusal.refused && responseContainsLoreGapTrigger(result.text);
  if (loreGapRecorded) recordLoreGap(question.text);

  // Display text is then optionally stripped per the dashboard toggle — the
  // model still emitted citations and used them to ground the answer; the
  // reader just sees clean prose.
  //
  // The source list comes from the prompt that was actually sent, so the strip
  // matches what the model was looking at when it cited. Without it, a citation
  // the model shortened — `[Maera the Ashbound]` for a note the header called
  // `02 - NPCs/Background/Maera the Ashbound.md` — survived the strip, and the
  // toggle looked broken to anyone reading an Obsidian vault.
  const text = settings.includeReferences
    ? result.text
    : stripReferenceMarkers(result.text, sourceNamesIn(parts));

  return {
    answered: true,
    text,
    modelUsed: result.modelUsed,
    costUsd: result.costUsd,
    loreGapRecorded,
    // Surfaces present the text either way — the model's own decline is the
    // best explanation available, and hiding it would leave the asker staring
    // at a non-answer. What this carries is the LABEL, so a decline is not
    // mistaken for chronicle content and so a surface can add its own framing.
    declined: refusal.refused,
    declineKind: refusal.kind,
  };
}
