import { describe, expect, it } from "vitest";
import { scrubSecrets } from "./scrub-secrets";

describe("scrubSecrets — known provider shapes", () => {
  it("masks OpenAI sk-… keys", () => {
    const out = scrubSecrets("auth header: sk-AbCdEf1234567890123456");
    expect(out).toContain("<redacted>");
    expect(out).not.toMatch(/sk-[A-Z]/);
  });

  it("masks OpenAI project keys (sk-proj-…)", () => {
    const out = scrubSecrets("OPENAI_KEY=sk-proj-AbCdEf1234567890123456abcdef");
    expect(out).toContain("<redacted>");
    expect(out).not.toContain("sk-proj-AbCd");
  });

  it("masks Anthropic sk-ant-… keys (the prefix is NOT half-leaked)", () => {
    const out = scrubSecrets("calling Anthropic with sk-ant-api03-AbCdEf1234567890");
    // The full sk-ant-… token is replaced — no "sk-ant-" prefix lingers.
    expect(out).toContain("<redacted>");
    expect(out).not.toContain("sk-ant-");
  });

  it("masks Google AIza… keys", () => {
    const out = scrubSecrets("gemini key: AIzaSyAbCdEf1234567890ABCDEF1234567890XYZ");
    expect(out).toContain("<redacted>");
    expect(out).not.toMatch(/AIza\w/);
  });

  it("masks Discord bot tokens (three base64url segments)", () => {
    // Real bot tokens look like: <base64url user id>.<6-7 char timestamp>.<HMAC>.
    // Assembled from segments so the literal never appears in the file —
    // GitHub's push protection blocks that exact shape, and the scrubber's
    // own pattern needs the same 27+ final segment, so there is no length
    // that satisfies one and not the other.
    const token = ["MTE3MzcyNzAxMjM0NTY3ODk2", "GxYzAB", "AbCdEfGhIjKlMnOpQrStUvWxYzA"].join(".");
    const out = scrubSecrets("Bot " + token);
    expect(out).toContain("<redacted>");
  });
});

describe("scrubSecrets — no false-positive damage", () => {
  it("leaves UUIDs untouched", () => {
    const id = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    expect(scrubSecrets(`persona id: ${id}`)).toContain(id);
  });

  it("leaves filenames with dots alone", () => {
    expect(scrubSecrets("loaded /var/log/tusks-vault.log")).toContain("tusks-vault.log");
  });

  it("leaves short hex strings alone", () => {
    expect(scrubSecrets("commit abc1234")).toContain("abc1234");
  });

  it("returns the empty string unchanged", () => {
    expect(scrubSecrets("")).toBe("");
  });
});

describe("scrubSecrets — multiple secrets in one line", () => {
  it("masks every occurrence", () => {
    const out = scrubSecrets(
      "openai=sk-AAAAAAAAAAAAAAAAAA gemini=AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA done",
    );
    expect(out).not.toContain("sk-AAAA");
    expect(out).not.toContain("AIza");
    // Two distinct <redacted> insertions.
    expect((out.match(/<redacted>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("preserves surrounding context", () => {
    const out = scrubSecrets("auth ok for sk-AbCdEf1234567890123456 returning 200");
    expect(out).toMatch(/^auth ok for <redacted> returning 200$/);
  });
});
