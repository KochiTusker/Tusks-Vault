import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  accessibleModels,
  classifyGeminiFailure,
  classifyOpenRouterFailure,
  fingerprintKey,
  invalidateSlot,
  invalidateStaleSlots,
  probeClaudeCodeModels,
  probeOllama,
  readAvailability,
  updateSlot,
  verificationOf,
  type SlotAvailability,
} from "./model-probe";

let configDir: string;
let originalConfigDir: string | undefined;

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "tusks-probe-"));
  originalConfigDir = process.env.TUSKS_VAULT_CONFIG_DIR;
  process.env.TUSKS_VAULT_CONFIG_DIR = configDir;
});

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.TUSKS_VAULT_CONFIG_DIR;
  else process.env.TUSKS_VAULT_CONFIG_DIR = originalConfigDir;
  fs.rmSync(configDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const slot = (over: Partial<SlotAvailability> = {}): SlotAvailability => ({
  fetchedAt: new Date().toISOString(),
  advertised: [],
  probed: [],
  ...over,
});

describe("fingerprintKey", () => {
  it("is stable and six hex characters", () => {
    expect(fingerprintKey("sk-abc")).toMatch(/^[0-9a-f]{6}$/);
    expect(fingerprintKey("sk-abc")).toBe(fingerprintKey("sk-abc"));
  });

  it("differs between different keys", () => {
    expect(fingerprintKey("sk-abc")).not.toBe(fingerprintKey("sk-abd"));
  });

  it("reveals nothing of the key itself", () => {
    // The whole point is that it can be shown in the UI. A prefix of the key
    // would defeat that.
    const key = "AIzaSyVERYSECRETVALUE";
    expect(key).not.toContain(fingerprintKey(key));
  });
});

describe("classifyGeminiFailure", () => {
  it("distinguishes a paid-only refusal from an ordinary rate limit", () => {
    // The distinction that justifies probing at all. `limit: 0` is a
    // permanent no; a plain 429 is "later". Conflating them either hides a
    // model forever or tells the user to keep retrying something that will
    // never work.
    expect(classifyGeminiFailure(429, '{"quotaValue":"0","limit": 0}')).toMatch(/Paid tier only/);
    expect(classifyGeminiFailure(429, "generate_content_free_tier_requests")).toMatch(/Paid tier only/);
    expect(classifyGeminiFailure(429, '{"message":"too many requests"}')).toMatch(/try again shortly/);
  });

  it("maps the other statuses to stable prose", () => {
    expect(classifyGeminiFailure(403, "")).toMatch(/billing/);
    expect(classifyGeminiFailure(404, "")).toMatch(/Not available/);
    expect(classifyGeminiFailure(401, "")).toMatch(/rejected/i);
    expect(classifyGeminiFailure(503, "")).toBe("HTTP 503");
  });

  it("never echoes the provider's raw body", () => {
    // Google's error text carries project ids and quota metric names.
    const body = '{"error":{"message":"project 12345 quota exceeded for user@example.com"}}';
    expect(classifyGeminiFailure(429, body)).not.toContain("12345");
    expect(classifyGeminiFailure(429, body)).not.toContain("example.com");
  });
});

describe("classifyOpenRouterFailure", () => {
  it("names the privacy floor when no zero-retention host serves the model", () => {
    // Without this, the message reads as "the model doesn't exist", and the
    // user goes looking for a typo in a model id that is perfectly correct.
    const msg = classifyOpenRouterFailure(404, '{"error":{"message":"No endpoints found for x/y."}}');
    expect(msg).toMatch(/zero-retention/);
    expect(msg).toMatch(/privacy floor/);
  });

  it("distinguishes running out of credit from being rate-limited", () => {
    expect(classifyOpenRouterFailure(402, "")).toMatch(/credit/);
    expect(classifyOpenRouterFailure(429, "")).toMatch(/try again shortly/);
  });
});

describe("availability cache", () => {
  it("round-trips a slot through disk", () => {
    updateSlot("gemini:paid", slot({ advertised: ["gemini-2.5-pro"], keyFingerprint: "abc123" }));
    expect(readAvailability()["gemini:paid"]?.advertised).toEqual(["gemini-2.5-pro"]);
  });

  it("returns an empty cache when the file is absent or corrupt", () => {
    expect(readAvailability()).toEqual({});
    fs.writeFileSync(path.join(configDir, "model-availability.json"), "{not json", "utf-8");
    expect(readAvailability()).toEqual({});
  });

  it("keeps slots independent", () => {
    updateSlot("gemini:paid", slot({ advertised: ["a"] }));
    updateSlot("gemini:free", slot({ advertised: ["b"] }));
    const cache = readAvailability();
    expect(cache["gemini:paid"]?.advertised).toEqual(["a"]);
    expect(cache["gemini:free"]?.advertised).toEqual(["b"]);
  });

  it("invalidateSlot drops one slot and leaves the rest", () => {
    updateSlot("gemini:paid", slot({ advertised: ["a"] }));
    updateSlot("openrouter:n/a", slot({ advertised: ["b"] }));
    invalidateSlot("gemini:paid");
    const cache = readAvailability();
    expect(cache["gemini:paid"]).toBeUndefined();
    expect(cache["openrouter:n/a"]?.advertised).toEqual(["b"]);
  });

  it("invalidateStaleSlots drops slots whose key changed", () => {
    updateSlot("gemini:paid", slot({ keyFingerprint: fingerprintKey("old-key") }));
    updateSlot("gemini:free", slot({ keyFingerprint: fingerprintKey("same-key") }));
    const dropped = invalidateStaleSlots({
      "gemini:paid": "new-key",
      "gemini:free": "same-key",
    });
    expect(dropped).toEqual(["gemini:paid"]);
    expect(readAvailability()["gemini:free"]).toBeDefined();
  });

  it("invalidateStaleSlots drops a slot whose key was removed entirely", () => {
    updateSlot("openrouter:n/a", slot({ keyFingerprint: fingerprintKey("k") }));
    expect(invalidateStaleSlots({})).toEqual(["openrouter:n/a"]);
  });

  it("leaves keyless slots alone — they have no fingerprint to go stale", () => {
    // Claude Code and Ollama carry no key, so "the key changed" is not a
    // thing that can happen to them; wiping them on every key edit would be
    // pure churn.
    updateSlot("claudeCode", slot({ advertised: ["opus"] }));
    expect(invalidateStaleSlots({})).toEqual([]);
    expect(readAvailability().claudeCode).toBeDefined();
  });
});

describe("verificationOf", () => {
  it("reports verified, unavailable, and unverified as three distinct states", () => {
    // "Unverified" is not a synonym for either other state. Collapsing it
    // into unavailable hides models that work; collapsing it into verified
    // promises something untested.
    updateSlot(
      "gemini:paid",
      slot({
        probed: [
          { id: "works", accessible: true },
          { id: "broken", accessible: false, reason: "Paid tier only — this key's quota for it is zero" },
        ],
      })
    );
    const cache = readAvailability();
    expect(verificationOf(cache, "gemini:paid", "works").state).toBe("verified");
    expect(verificationOf(cache, "gemini:paid", "broken").state).toBe("unavailable");
    expect(verificationOf(cache, "gemini:paid", "never-probed").state).toBe("unverified");
  });

  it("carries the reason through for an unavailable model", () => {
    updateSlot("gemini:paid", slot({ probed: [{ id: "x", accessible: false, reason: "Not available on this key" }] }));
    expect(verificationOf(readAvailability(), "gemini:paid", "x").reason).toBe("Not available on this key");
  });

  it("reports unverified for a slot that has never been probed", () => {
    expect(verificationOf({}, "ollama", "llama3.1:8b").state).toBe("unverified");
  });
});

describe("accessibleModels", () => {
  it("returns null for a never-probed slot, distinct from an empty list", () => {
    // "Nobody has looked" and "we looked and nothing works" call for
    // completely different UI. One number cannot say both.
    expect(accessibleModels({}, "gemini:paid")).toBeNull();
    updateSlot("gemini:paid", slot({ probed: [{ id: "x", accessible: false }] }));
    expect(accessibleModels(readAvailability(), "gemini:paid")).toEqual([]);
  });

  it("returns only the accessible ids", () => {
    updateSlot(
      "openrouter:n/a",
      slot({
        probed: [
          { id: "a/b", accessible: true },
          { id: "c/d", accessible: false, reason: "nope" },
        ],
      })
    );
    expect(accessibleModels(readAvailability(), "openrouter:n/a")).toEqual(["a/b"]);
  });
});

describe("probeClaudeCodeModels", () => {
  it("marks each alias accessible when the CLI answers", async () => {
    const run = vi.fn().mockResolvedValue({ text: "." });
    const out = await probeClaudeCodeModels(["opus", "sonnet"], run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(out.probed.every(p => p.accessible)).toBe(true);
    expect(out.keyFingerprint).toBeUndefined(); // no key to fingerprint
  });

  it("stops on a usage limit and marks the rest unprobed, not unavailable", async () => {
    // Burning the remaining subscription window to prove the same limit three
    // more times helps nobody — and reporting the untried aliases as broken
    // would be a claim we did not test.
    const run = vi.fn().mockRejectedValue(new Error("Claude Code usage limit reached: window exhausted"));
    const out = await probeClaudeCodeModels(["haiku", "opus", "sonnet"], run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(out.probed).toHaveLength(3);
    expect(out.probed.filter(p => /Not probed/.test(p.reason ?? ""))).toHaveLength(2);
  });

  it("keeps probing after an ordinary per-model failure", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("Model not available on your plan"))
      .mockResolvedValue({ text: "." });
    const out = await probeClaudeCodeModels(["opus", "sonnet"], run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(out.probed.find(p => p.id === "sonnet")?.accessible).toBe(true);
  });

  it("truncates a long failure message rather than storing an essay", async () => {
    const run = vi.fn().mockRejectedValue(new Error("x".repeat(1000)));
    const out = await probeClaudeCodeModels(["opus"], run);
    expect(out.probed[0].reason!.length).toBeLessThanOrEqual(160);
  });
});

describe("probeOllama", () => {
  it("treats the tag list as the probe result", async () => {
    // Asking each local model for a token would load gigabytes into memory to
    // learn what the list already said.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: "llama3.1:8b" }, { name: "phi3:mini" }] }),
      })
    );
    const out = await probeOllama("http://localhost:11434");
    expect(out.advertised).toEqual(["llama3.1:8b", "phi3:mini"]);
    expect(out.probed.every(p => p.accessible)).toBe(true);
  });

  it("reports an unreachable server as one clear failure, not zero models", async () => {
    // An empty model list and a dead server look identical in a dropdown.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const out = await probeOllama("http://localhost:11434");
    expect(out.probed).toHaveLength(1);
    expect(out.probed[0].accessible).toBe(false);
    expect(out.probed[0].reason).toMatch(/ollama serve/);
  });

  it("reports a non-2xx response with its status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const out = await probeOllama("http://localhost:11434");
    expect(out.probed[0].reason).toMatch(/HTTP 500/);
  });

  it("tolerates a trailing slash on the base URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    await probeOllama("http://localhost:11434/");
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/tags");
  });
});
