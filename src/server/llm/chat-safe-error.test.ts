import { describe, expect, it } from "vitest";
import { chatSafeError, formatAdapterError } from "./registry";
import { MissingApiKeyError } from "./types";

/**
 * A chat surface broadcasts. The dashboard does not.
 *
 * formatAdapterError is written for the operator and names the provider, the
 * env var to set, the CLI that is missing. Those messages used to be posted
 * straight into a Discord channel and a Foundry chat log, where every player
 * reads them. These tests pin the split: the operator keeps the detail, the
 * table gets a sentence it can act on and nothing else.
 */

/** Anything here appearing in a chat-bound string is a disclosure. */
const FORBIDDEN = [
  "openrouter", "gemini", "ollama", "anthropic", "claude code", "deepseek",
  ".env", "api key", "api_key", "path", "cli", "token", "quota",
  "finish reason", "output ceiling", "endpoint", "http", "localhost", "127.0.0.1",
];

function assertSafe(out: string) {
  const lower = out.toLowerCase();
  for (const word of FORBIDDEN) {
    expect(lower, `chat message leaked "${word}": ${out}`).not.toContain(word);
  }
}

describe("chatSafeError — nothing operational reaches a chat surface", () => {
  // The message that prompted this change. It was posted to a Discord channel
  // verbatim, disclosing the provider, the exact model id and the configured
  // output ceiling to everyone at the table.
  it("does not leak the provider, model or ceiling from a real empty-response error", () => {
    const real = new Error(
      "OpenRouter returned an empty response.\nModel: deepseek/deepseek-v4-pro\n" +
        "Finish reason: length\nHit the output ceiling (4096 tokens). Pick a model with a larger output limit."
    );
    const out = chatSafeError(real);
    assertSafe(out);
    expect(out).not.toContain("4096");
  });

  it("does not leak the provider or the env var from a missing-key error", () => {
    const out = chatSafeError(new MissingApiKeyError("openrouter", "OPENROUTER_API_KEY"));
    assertSafe(out);
    // The operator-facing version is allowed to say all of it — that is the point.
    const operator = formatAdapterError(new MissingApiKeyError("openrouter", "OPENROUTER_API_KEY"));
    expect(operator).toContain("OPENROUTER_API_KEY");
  });

  it("does not disclose which local software is missing or unreachable", () => {
    assertSafe(chatSafeError(new Error("Claude Code CLI not found. Install it and run `claude login`.")));
    assertSafe(chatSafeError(new Error("Ollama HTTP 500 at http://localhost:11434")));
    assertSafe(chatSafeError(new Error("connect ECONNREFUSED 127.0.0.1:11434")));
  });

  it("does not disclose a filesystem path from an unexpected error", () => {
    const out = chatSafeError(new Error("ENOENT: no such file or directory, open 'D:\\\\Tusks-Vault\\\\.env.local'"));
    assertSafe(out);
    expect(out).not.toContain("Tusks-Vault");
  });

  it("tells a retryable failure apart, because the asker can act on that one", () => {
    for (const m of [
      "429 rate_limit_exceeded",
      "RESOURCE_EXHAUSTED",
      "SHARED_FREE_POOL saturated",
      "Claude Code usage limit reached",
      "upstream 503 overloaded",
    ]) {
      expect(chatSafeError(new Error(m)).toLowerCase()).toContain("again");
    }
  });

  it("sends a non-retryable failure to the GM rather than the asker", () => {
    const out = chatSafeError(new Error("something nobody anticipated"));
    expect(out.toLowerCase()).toContain("gm");
    assertSafe(out);
  });

  it("never returns an empty string, whatever it is handed", () => {
    for (const v of [undefined, null, "", 0, {}, new Error("")]) {
      expect(chatSafeError(v).length).toBeGreaterThan(10);
    }
  });
});
