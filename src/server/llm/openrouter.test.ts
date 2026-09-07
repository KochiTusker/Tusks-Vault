import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared state for the hoisted mocks. `createMock` records every Chat
// Completions call; `ctorOpts` records the SDK constructor arguments;
// `mockCatalogue` is what readCachedCatalogue returns (null = no cache).
const h = vi.hoisted(() => ({
  createMock: vi.fn(),
  ctorOpts: [] as unknown[],
  mockCatalogue: null as unknown,
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: (...args: unknown[]) => h.createMock(...args) } };
    constructor(opts: unknown) {
      h.ctorOpts.push(opts);
    }
  },
}));

vi.mock("./openrouter-catalogue", async importOriginal => {
  const actual = await importOriginal<typeof import("./openrouter-catalogue")>();
  return {
    ...actual,
    readCachedCatalogue: () => h.mockCatalogue,
  };
});

import {
  buildMessages,
  stripTaggedReasoning,
  createOpenRouterAdapter,
  DEFAULT_ROUTING,
  routingFor,
  enrichOpenRouterError,
} from "./openrouter";
import { MissingApiKeyError } from "./types";

type Msg = { role: string; content: Array<Record<string, unknown>> };

function okResponse(text: string, extra: Record<string, unknown> = {}) {
  return {
    choices: [{ message: { content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
    ...extra,
  };
}

beforeEach(() => {
  h.createMock.mockReset();
  h.ctorOpts.length = 0;
  h.mockCatalogue = null;
});

describe("buildMessages — cache breakpoint placement", () => {
  const text = (t: string) => ({ type: "text" as const, text: t });

  it("marks the last LEADING cacheable text part", () => {
    const messages = buildMessages({
      systemPrompt: "system",
      userContent: [text("kb"), text("clarifications"), text("query")],
      cacheableFlags: [true, false, false],
    }) as Msg[];
    const user = messages[1];
    expect(user.content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(user.content[1].cache_control).toBeUndefined();
    expect(user.content[2].cache_control).toBeUndefined();
    // System block must NOT also carry one — a single breakpoint caches
    // everything before it, system included.
    expect((messages[0].content[0] as Record<string, unknown>).cache_control).toBeUndefined();
  });

  it("a cacheable part AFTER a variable part is never marked — the prefix must be contiguous", () => {
    const messages = buildMessages({
      systemPrompt: "system",
      userContent: [text("variable"), text("stable-but-too-late")],
      cacheableFlags: [false, true],
    }) as Msg[];
    const user = messages[1];
    expect(user.content[0].cache_control).toBeUndefined();
    expect(user.content[1].cache_control).toBeUndefined();
    // Falls back to the system block.
    expect(messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("falls back to the system block when nothing is cacheable", () => {
    const messages = buildMessages({
      systemPrompt: "system",
      userContent: [text("a"), text("b")],
      cacheableFlags: [false, false],
    }) as Msg[];
    expect(messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("omits the system message entirely when the system prompt is blank", () => {
    const messages = buildMessages({
      systemPrompt: "   ",
      userContent: [text("q")],
      cacheableFlags: [false],
    }) as Msg[];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });
});

describe("stripTaggedReasoning", () => {
  it("removes a leading <think> block", () => {
    const r = stripTaggedReasoning("<think>step 1... step 2...</think>The answer is 4.");
    expect(r.text).toBe("The answer is 4.");
    expect(r.stripped).toBe(true);
  });

  it("removes stacked blocks and <thinking> spelling", () => {
    const r = stripTaggedReasoning("<thinking>a</thinking>\n<think>b</think>\nAnswer.");
    expect(r.text).toBe("Answer.");
  });

  it("never strips down to nothing", () => {
    const r = stripTaggedReasoning("<think>the whole reply is deliberation</think>  ");
    expect(r.stripped).toBe(false);
    expect(r.text).toContain("deliberation");
  });

  it("leaves untagged text alone", () => {
    const r = stripTaggedReasoning("Just an answer that mentions thinking.");
    expect(r.stripped).toBe(false);
    expect(r.text).toBe("Just an answer that mentions thinking.");
  });
});

describe("createOpenRouterAdapter.generate", () => {
  const adapter = createOpenRouterAdapter({
    apiKey: "sk-or-test",
    proModel: "example/pro",
    flashModel: "example/flash",
  });
  const input = {
    systemPrompt: "You are the scribe.",
    userParts: [
      { type: "text" as const, text: "### GLOBAL KNOWLEDGE BASE\n...", cacheable: true },
      { type: "text" as const, text: "### USER QUERY\n..." },
    ],
    tier: "flash" as const,
  };

  it("throws MissingApiKeyError with no key", async () => {
    const keyless = createOpenRouterAdapter({ apiKey: "", proModel: "p", flashModel: "f" });
    await expect(keyless.generate(input)).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it("targets the OpenRouter base URL and sends the privacy floor on every request", async () => {
    h.createMock.mockResolvedValue(okResponse("answer"));
    await adapter.generate(input);
    expect(h.ctorOpts[0]).toMatchObject({ baseURL: "https://openrouter.ai/api/v1" });
    const body = h.createMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body.provider).toEqual({ ...DEFAULT_ROUTING });
    expect(body.provider).toMatchObject({ zdr: true, data_collection: "deny" });
  });

  it("resolves flash tier / pro tier / explicit override in that priority", async () => {
    h.createMock.mockResolvedValue(okResponse("a"));
    await adapter.generate(input);
    expect((h.createMock.mock.calls[0][0] as { model: string }).model).toBe("example/flash");
    await adapter.generate({ ...input, tier: "pro" });
    expect((h.createMock.mock.calls[1][0] as { model: string }).model).toBe("example/pro");
    await adapter.generate({ ...input, modelOverride: "example/custom" });
    expect((h.createMock.mock.calls[2][0] as { model: string }).model).toBe("example/custom");
  });

  it("clamps max_tokens to the catalogue ceiling when a cached catalogue knows the model", async () => {
    h.mockCatalogue = {
      fetchedAt: "2026-08-24T00:00:00Z",
      models: [{ id: "example/flash", maxCompletionTokens: 2048 }],
    };
    h.createMock.mockResolvedValue(okResponse("a"));
    await adapter.generate({ ...input, maxOutputTokens: 8000 });
    expect((h.createMock.mock.calls[0][0] as { max_tokens: number }).max_tokens).toBe(2048);
    // Below the ceiling: request wins.
    await adapter.generate({ ...input, maxOutputTokens: 1000 });
    expect((h.createMock.mock.calls[1][0] as { max_tokens: number }).max_tokens).toBe(1000);
  });

  it("no cached catalogue → no clamp (default 4096)", async () => {
    h.createMock.mockResolvedValue(okResponse("a"));
    await adapter.generate(input);
    expect((h.createMock.mock.calls[0][0] as { max_tokens: number }).max_tokens).toBe(4096);
  });

  it("surfaces usage.cost as costUsd, and omits it when absent", async () => {
    h.createMock.mockResolvedValue(okResponse("a", { usage: { cost: 0.0123 } }));
    const withCost = await adapter.generate(input);
    expect(withCost.costUsd).toBeCloseTo(0.0123);
    h.createMock.mockResolvedValue(okResponse("b"));
    const without = await adapter.generate(input);
    expect(without.costUsd).toBeUndefined();
  });

  it("empty body + finish_reason=length names the output ceiling", async () => {
    h.createMock.mockResolvedValue({
      choices: [{ message: { content: "" }, finish_reason: "length" }],
    });
    await expect(adapter.generate(input)).rejects.toThrow(/output ceiling/i);
  });

  it("empty body + other finish reason points at upstream refusal / moderation", async () => {
    h.createMock.mockResolvedValue({
      choices: [{ message: { content: "" }, finish_reason: "stop" }],
    });
    await expect(adapter.generate(input)).rejects.toThrow(/refused|unmoderated/i);
  });

  it("strips tagged reasoning before returning", async () => {
    h.createMock.mockResolvedValue(okResponse("<think>hmm</think>The vault holds three keys."));
    const r = await adapter.generate(input);
    expect(r.text).toBe("The vault holds three keys.");
  });
});

describe("routingFor — the privacy floor and its one exception", () => {
  it("applies the floor to a model nobody opted in", () => {
    expect(routingFor("some/model")).toMatchObject({ zdr: true, data_collection: "deny" });
  });

  it("applies the floor when the opt-in list is empty or absent", () => {
    expect(routingFor("some/model", [])).toMatchObject({ zdr: true, data_collection: "deny" });
    expect(routingFor("some/model", undefined)).toMatchObject({ zdr: true, data_collection: "deny" });
  });

  it("relaxes the floor ONLY for the exact model opted in", () => {
    const optIn = ["vendor/model:free"];
    expect(routingFor("vendor/model:free", optIn).zdr).toBeUndefined();
    expect(routingFor("vendor/model:free", optIn).data_collection).toBeUndefined();
  });

  it("does not leak consent to a sibling model", () => {
    // The failure this guards: opting into one free model quietly widening
    // what every other request is allowed to share.
    const optIn = ["vendor/model:free"];
    expect(routingFor("vendor/model", optIn)).toMatchObject({ zdr: true, data_collection: "deny" });
    expect(routingFor("vendor/other:free", optIn)).toMatchObject({ zdr: true, data_collection: "deny" });
  });

  it("keeps price sorting either way", () => {
    expect(routingFor("m").sort).toBe("price");
    expect(routingFor("m", ["m"]).sort).toBe("price");
  });
});

describe("enrichOpenRouterError — keeping the provider's explanation", () => {
  const withMeta = (metadata: unknown): Error => {
    const e = new Error("429 Provider returned error");
    (e as { status?: unknown }).status = 429;
    (e as { error?: unknown }).error = { message: "Provider returned error", code: 429, metadata };
    return e;
  };

  it("puts the plain-English cause back into the message", () => {
    // The SDK renders only "429 Provider returned error"; the useful half is
    // in metadata and was being discarded.
    const out = enrichOpenRouterError(
      withMeta({ raw: "model X is temporarily rate-limited upstream. Please retry shortly" })
    ) as Error;
    expect(out.message).toContain("rate-limited upstream");
  });

  it("flags a shared free pool so the message can say it is not the user's quota", () => {
    const out = enrichOpenRouterError(
      withMeta({ raw: "busy", limit_source: "upstream_provider_shared_pool" })
    ) as Error;
    expect(out.message).toContain("SHARED_FREE_POOL");
  });

  it("names the upstream that refused", () => {
    const out = enrichOpenRouterError(withMeta({ raw: "busy", provider_name: "Some Host" })) as Error;
    expect(out.message).toContain("Some Host");
  });

  it("preserves the status, so retry classification is unaffected", () => {
    const out = enrichOpenRouterError(withMeta({ raw: "busy" })) as { status?: unknown };
    expect(out.status).toBe(429);
  });

  it("returns the error untouched when there is nothing to add", () => {
    const plain = new Error("boom");
    expect(enrichOpenRouterError(plain)).toBe(plain);
    expect(enrichOpenRouterError(withMeta({}))).toBeInstanceOf(Error);
  });

  it("passes non-errors straight through", () => {
    expect(enrichOpenRouterError("nope")).toBe("nope");
    expect(enrichOpenRouterError(null)).toBe(null);
  });
});
