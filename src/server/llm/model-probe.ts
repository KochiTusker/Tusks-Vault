// Per-connection model probe — which models can this setup ACTUALLY call.
//
// A catalogue is an advertisement. Google's ListModels returns the same ids
// to a free-tier key and a billing-enabled one; the refusal arrives later, as
// a 429 with `limit: 0`, at the moment someone asks the bot a question.
// OpenRouter's catalogue is public and lists every model on the platform,
// including ones that no zero-retention host serves — and Vault's privacy
// floor excludes exactly those, so the picker would offer models that always
// fail. Both cases produce the same bad experience: a model that appears in
// the dropdown, is selected, and then does not work.
//
// So we make a real one-token call and cache what happened. Ported from the
// sibling project, whose implementation had already established this shape.
//
// Cost: the probe is one token of output per model, and the results are
// cached per key fingerprint until the key changes or the user re-probes.
//
// The four connections need four different questions asked:
//   gemini      — list, then probe. The tier lie above is the whole reason.
//   openrouter  — probe a shortlist under Vault's routing policy, because
//                 what varies is the POLICY's reach, not the key's.
//   claudeCode  — three aliases; the question is whether the CLI answers.
//   ollama      — /api/tags is already a real probe: it lists what is pulled.

import { createHash } from "node:crypto";
import fs from "node:fs";
import { configFile, ensureConfigDir } from "../config/app-data";
import { writeFileAtomic } from "../util/atomic-write";
import { DEFAULT_ROUTING } from "./openrouter";
import { isGeminiTextModel } from "./gemini-text-models";

/** Slot identity in the availability cache. Gemini's free and paid projects
 *  are different keys with different reach, so they are different slots. */
export type ProbeSlot =
  | "gemini:paid"
  | "gemini:free"
  | "openrouter:n/a"
  | "claudeCode"
  | "ollama";

export const PROBE_SLOTS: ProbeSlot[] = [
  "gemini:paid",
  "gemini:free",
  "openrouter:n/a",
  "claudeCode",
  "ollama",
];

/**
 * Short hash of an API key, safe to show.
 *
 * Its job is to catch a specific confusing situation: the user pastes the
 * same key into both the paid and free Gemini slots, both probes return
 * identical results, and the "why does my free key show paid models" question
 * has no visible answer. Equal fingerprints answer it immediately.
 *
 * Six hex characters is 24 bits — collisions are far rarer than the mistake
 * it exists to detect, and it reveals nothing about the key.
 */
export function fingerprintKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 6);
}

export interface ProbeEntry {
  id: string;
  /** True iff the one-token call succeeded. */
  accessible: boolean;
  /** Stable, UI-switchable failure cause. Never the provider's raw error
   *  text — that changes between API versions and can carry account detail. */
  reason?: string;
  latencyMs?: number;
}

export interface SlotAvailability {
  fetchedAt: string;
  /** Absent for the keyless connections. */
  keyFingerprint?: string;
  /** Every id the provider's catalogue offered, whether probed or not. */
  advertised: string[];
  /** Outcome for the subset actually called. */
  probed: ProbeEntry[];
}

export type AvailabilityCache = Partial<Record<ProbeSlot, SlotAvailability>>;

// ── cache ────────────────────────────────────────────────────────────────

function cacheFile(): string {
  return configFile("model-availability.json");
}

export function readAvailability(): AvailabilityCache {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), "utf-8")) as AvailabilityCache;
  } catch {
    return {};
  }
}

function writeAvailability(next: AvailabilityCache): void {
  ensureConfigDir();
  writeFileAtomic(cacheFile(), JSON.stringify(next, null, 2));
}

export function updateSlot(slot: ProbeSlot, value: SlotAvailability): void {
  const cache = readAvailability();
  cache[slot] = value;
  writeAvailability(cache);
}

/** Drop a slot's cached probe. Called when the key behind it changes — old
 *  availability data describes a key that is no longer there, and showing it
 *  as though it described the new one is worse than showing nothing. */
export function invalidateSlot(slot: ProbeSlot): void {
  const cache = readAvailability();
  if (cache[slot]) {
    delete cache[slot];
    writeAvailability(cache);
  }
}

/** Every slot whose fingerprint no longer matches the key now in that slot. */
export function invalidateStaleSlots(current: Partial<Record<ProbeSlot, string>>): ProbeSlot[] {
  const cache = readAvailability();
  const dropped: ProbeSlot[] = [];
  for (const slot of PROBE_SLOTS) {
    const cached = cache[slot];
    if (!cached?.keyFingerprint) continue;
    const key = current[slot];
    if (!key || fingerprintKey(key) !== cached.keyFingerprint) {
      delete cache[slot];
      dropped.push(slot);
    }
  }
  if (dropped.length > 0) writeAvailability(cache);
  return dropped;
}

// ── concurrency ──────────────────────────────────────────────────────────

/** Fixed-concurrency map. Deliberately small: Gemini's free tier allows a
 *  handful of requests per minute, so a probe that fans out wide throttles
 *  itself and then reports its own throttling as "model unavailable". */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return out;
}

// ── gemini ───────────────────────────────────────────────────────────────

interface GeminiListedModel {
  name?: string;
  supportedGenerationMethods?: string[];
}

/** generateContent support, and a text modality.
 *
 *  generateContent alone is not the gate it looks like: the image models
 *  advertise it too — `gemini-3-pro-image` is generated through exactly the
 *  same method as `gemini-3-flash` — so probing on that signal alone spends a
 *  call per image, audio and TTS variant to learn about models the picker
 *  will never offer. On a free-tier key, where the whole probe competes for a
 *  handful of requests per minute, that is most of the budget spent on
 *  nothing.
 *
 *  isGeminiTextModel stays forward-compatible where it matters: it denies by
 *  modality and allows by family, so a Gemini text family that does not exist
 *  yet is probed the day it ships. The failure this avoids is the opposite
 *  one — a KNOWN non-text model quietly consuming the quota. */
function shouldProbeGemini(m: GeminiListedModel): boolean {
  const id = (m.name ?? "").replace(/^models\//, "");
  if (!id) return false;
  if (!(m.supportedGenerationMethods ?? []).includes("generateContent")) return false;
  return isGeminiTextModel(id);
}

export function classifyGeminiFailure(status: number, body: string): string {
  if (status === 429) {
    // The distinction that justifies probing at all: a free-tier key is told
    // it has a quota of zero for a paid-only model, which is a permanent
    // "no", not the temporary "no" that a rate limit usually means.
    if (/"limit":\s*0/.test(body) || /generate_content_free_tier_/.test(body)) {
      return "Paid tier only — this key's quota for it is zero";
    }
    return "Rate-limited — try again shortly";
  }
  if (status === 403) return "Forbidden — billing not enabled, or the model is restricted";
  if (status === 404) return "Not available on this key";
  if (status === 400) return "Rejected the request — the model may have changed shape";
  if (status === 401) return "Key rejected";
  return `HTTP ${status}`;
}

async function probeOneGemini(apiKey: string, id: string): Promise<ProbeEntry> {
  const t0 = Date.now();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "ping" }] }],
          generationConfig: { maxOutputTokens: 1, temperature: 0 },
        }),
      }
    );
    const latencyMs = Date.now() - t0;
    if (res.ok) {
      // Drain so the socket is reusable; the content is irrelevant.
      await res.text().catch(() => "");
      return { id, accessible: true, latencyMs };
    }
    const body = await res.text().catch(() => "");
    return { id, accessible: false, reason: classifyGeminiFailure(res.status, body), latencyMs };
  } catch (err) {
    return {
      id,
      accessible: false,
      reason: `Could not reach Google: ${(err as Error).message}`,
      latencyMs: Date.now() - t0,
    };
  }
}

export async function probeGeminiKey(apiKey: string): Promise<SlotAvailability> {
  let listed: GeminiListedModel[] = [];
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`
    );
    if (res.ok) {
      listed = ((await res.json()) as { models?: GeminiListedModel[] }).models ?? [];
    }
  } catch {
    /* the per-model probes are the load-bearing signal; an empty list here
       just means nothing to probe, which the caller reports honestly */
  }

  const advertised = listed
    .map(m => (m.name ?? "").replace(/^models\//, ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const targets = listed.filter(shouldProbeGemini).map(m => (m.name ?? "").replace(/^models\//, ""));
  const probed = await mapWithConcurrency(targets, 4, id => probeOneGemini(apiKey, id));
  probed.sort((a, b) => a.id.localeCompare(b.id));

  return { fetchedAt: new Date().toISOString(), keyFingerprint: fingerprintKey(apiKey), advertised, probed };
}

// ── openrouter ───────────────────────────────────────────────────────────

export function classifyOpenRouterFailure(status: number, body: string): string {
  // The Vault-specific one. Our routing pins zero-data-retention hosts, so a
  // model whose only providers retain prompts has no endpoint left — the
  // catalogue lists it, and it can never be called. That is not a fault the
  // user can fix by waiting, and it must not read like one.
  if (/No endpoints found/i.test(body)) {
    return "No zero-retention host serves it, so Vault's privacy floor excludes it";
  }
  if (status === 402) return "Out of credit on this OpenRouter key";
  if (status === 429) return "Rate-limited — try again shortly";
  if (status === 403) return "Forbidden — the key has no access to this model";
  if (status === 404) return "Not on OpenRouter under that id";
  if (status === 401) return "Key rejected";
  if (status === 400) return "Rejected the request — the model may have changed shape";
  return `HTTP ${status}`;
}

async function probeOneOpenRouter(apiKey: string, id: string): Promise<ProbeEntry> {
  const t0 = Date.now();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: id,
        max_tokens: 1,
        messages: [{ role: "user", content: "." }],
        // The probe MUST carry the same routing policy the real calls use.
        // Probing without it would report a model as reachable and then have
        // every actual question fail — the exact failure this exists to
        // prevent, moved one step later.
        provider: DEFAULT_ROUTING,
      }),
    });
    const latencyMs = Date.now() - t0;
    if (res.ok) {
      await res.text().catch(() => "");
      return { id, accessible: true, latencyMs };
    }
    const body = await res.text().catch(() => "");
    return { id, accessible: false, reason: classifyOpenRouterFailure(res.status, body), latencyMs };
  } catch (err) {
    return {
      id,
      accessible: false,
      reason: `Could not reach OpenRouter: ${(err as Error).message}`,
      latencyMs: Date.now() - t0,
    };
  }
}

/**
 * Probe a shortlist of OpenRouter models, not the catalogue.
 *
 * OpenRouter carries hundreds of models. Probing all of them would take
 * minutes, spend real money on hundreds of billed calls, and answer a
 * question nobody asked — a user picks one or two models, not four hundred.
 * So the caller passes the shortlist: what is configured now, plus whatever
 * the user is considering in the model browser.
 */
export async function probeOpenRouterModels(
  apiKey: string,
  ids: string[],
  advertised: string[] = []
): Promise<SlotAvailability> {
  const targets = [...new Set(ids.filter(Boolean))];
  const probed = await mapWithConcurrency(targets, 4, id => probeOneOpenRouter(apiKey, id));
  probed.sort((a, b) => a.id.localeCompare(b.id));
  return {
    fetchedAt: new Date().toISOString(),
    keyFingerprint: fingerprintKey(apiKey),
    advertised: advertised.length > 0 ? advertised : targets.slice().sort((a, b) => a.localeCompare(b)),
    probed,
  };
}

// ── claude code ──────────────────────────────────────────────────────────

/** Probe the CLI by asking it for one token per alias.
 *
 *  Passed in rather than imported so this module stays testable without
 *  spawning anything, and so the CLI wrapper keeps owning the spawn. */
export async function probeClaudeCodeModels(
  ids: string[],
  run: (model: string, prompt: string) => Promise<unknown>
): Promise<SlotAvailability> {
  // Strictly serial. The CLI draws on one subscription window; three
  // concurrent sessions is a good way to discover its rate limit rather than
  // its model list.
  const probed: ProbeEntry[] = [];
  for (const id of ids) {
    const t0 = Date.now();
    try {
      await run(id, "Reply with the single character: .");
      probed.push({ id, accessible: true, latencyMs: Date.now() - t0 });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      probed.push({
        id,
        accessible: false,
        reason: /usage limit/i.test(msg)
          ? "Subscription usage window is exhausted — this is temporary"
          : msg.slice(0, 160),
        latencyMs: Date.now() - t0,
      });
      // A usage limit fails every remaining alias for the same reason, and
      // burning the rest of the window to prove it is pure waste.
      if (/usage limit/i.test(msg)) {
        for (const rest of ids.slice(ids.indexOf(id) + 1)) {
          probed.push({ id: rest, accessible: false, reason: "Not probed — usage window exhausted" });
        }
        break;
      }
    }
  }
  probed.sort((a, b) => a.id.localeCompare(b.id));
  return {
    fetchedAt: new Date().toISOString(),
    advertised: [...ids].sort((a, b) => a.localeCompare(b)),
    probed,
  };
}

// ── ollama ───────────────────────────────────────────────────────────────

/** Ollama needs no separate probe: /api/tags lists exactly the models that
 *  are pulled and runnable. Asking each one for a token would load it into
 *  memory — on a laptop, several seconds and several gigabytes per model, to
 *  learn what the list already said. */
export async function probeOllama(baseUrl: string): Promise<SlotAvailability> {
  const t0 = Date.now();
  try {
    // Same guards as the two /api/tags and /api/chat calls in llm/ollama.ts —
    // this was the third copy of the request and the only one that had neither.
    // `redirect: "manual"` so a process answering on loopback cannot bounce the
    // probe off-host, and a deadline so a listener that accepts and never
    // answers cannot hang the request forever.
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return {
        fetchedAt: new Date().toISOString(),
        advertised: [],
        probed: [{ id: "(server)", accessible: false, reason: `Ollama answered HTTP ${res.status}` }],
      };
    }
    const json = (await res.json()) as { models?: Array<{ name?: string }> };
    const ids = (json.models ?? [])
      .map(m => m.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0)
      .sort((a, b) => a.localeCompare(b));
    return {
      fetchedAt: new Date().toISOString(),
      advertised: ids,
      probed: ids.map(id => ({ id, accessible: true, latencyMs: Date.now() - t0 })),
    };
  } catch (err) {
    return {
      fetchedAt: new Date().toISOString(),
      advertised: [],
      probed: [
        {
          id: "(server)",
          accessible: false,
          reason: `Could not reach Ollama — is \`ollama serve\` running? (${(err as Error).message})`,
        },
      ],
    };
  }
}

// ── reading the cache ────────────────────────────────────────────────────

export type Verification = "verified" | "unavailable" | "unverified";

/** How a model id should be labelled in the picker.
 *
 *  "unverified" is a real third state, not a synonym for either other one.
 *  A model nobody has probed might work perfectly; showing it as unavailable
 *  would hide working models, and showing it as verified would promise
 *  something untested. */
export function verificationOf(
  cache: AvailabilityCache,
  slot: ProbeSlot,
  modelId: string
): { state: Verification; reason?: string } {
  const entry = cache[slot]?.probed.find(p => p.id === modelId);
  if (!entry) return { state: "unverified" };
  return entry.accessible
    ? { state: "verified" }
    : { state: "unavailable", reason: entry.reason };
}

/** Accessible model ids for a slot, or null when the slot has never been
 *  probed — which the caller must distinguish from "probed, none work". */
export function accessibleModels(cache: AvailabilityCache, slot: ProbeSlot): string[] | null {
  const entry = cache[slot];
  if (!entry) return null;
  return entry.probed.filter(p => p.accessible).map(p => p.id);
}
