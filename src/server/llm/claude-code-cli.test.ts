import { describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_MODELS,
  ClaudeCodeError,
  childEnvForCli,
  detectUsageLimit,
  parseClaudeJson,
  runClaudeCode,
} from "./claude-code-cli";

describe("childEnvForCli — allowlisted child environment", () => {
  // The entire point of this provider is that it bills the user's Claude
  // subscription and not an API key. A key left in the environment silently
  // takes precedence inside the CLI, so a leak here is a billing bug the
  // user only discovers on an invoice.
  it("never passes the three variables that would switch the CLI onto API billing", () => {
    const out = childEnvForCli({
      ANTHROPIC_API_KEY: "sk-ant-leakleakleak",
      ANTHROPIC_AUTH_TOKEN: "tok-leakleakleak",
      ANTHROPIC_BASE_URL: "https://proxy.example",
      PATH: "/usr/bin",
    });
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(out.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(out.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(out.PATH).toBe("/usr/bin");
  });

  it("excludes them case-INSENSITIVELY (Windows env names are case-insensitive)", () => {
    // Under the old denylist a plain `delete env.ANTHROPIC_API_KEY` was
    // case-sensitive, so this lowercase spelling survived while the child
    // still resolved it. The allowlist inherits the same hazard in mirror
    // image, so it is asserted the same way.
    const out = childEnvForCli({
      anthropic_api_key: "sk-ant-leakleakleak",
      Anthropic_Auth_Token: "tok-leakleakleak",
      aNtHrOpIc_BaSe_UrL: "https://proxy.example",
    });
    expect(Object.keys(out)).toHaveLength(0);
  });

  // The reason this function was inverted from a denylist. By the time it
  // runs, dotenv has loaded .env.local into process.env, so a pass-through
  // handed the child every credential the app owns — while the prompt it is
  // about to receive contains untrusted player text.
  it("withholds Vault's own secrets, which a denylist of ANTHROPIC_* let through", () => {
    const out = childEnvForCli({
      DISCORD_TOKEN: "discord-leakleakleak",
      GEMINI_API_KEY: "gem-leakleakleak",
      OPENROUTER_API_KEY: "sk-or-leakleakleak",
      OPENAI_API_KEY: "sk-leakleakleak",
      PATH: "/usr/bin",
    });
    expect(out.DISCORD_TOKEN).toBeUndefined();
    expect(out.GEMINI_API_KEY).toBeUndefined();
    expect(out.OPENROUTER_API_KEY).toBeUndefined();
    expect(out.OPENAI_API_KEY).toBeUndefined();
    expect(out.PATH).toBe("/usr/bin");
  });

  it("excludes an unknown variable rather than guessing it is harmless", () => {
    // Fail closed: a name nobody has reviewed is withheld. The cost of being
    // wrong is one entry added to ENV_ALLOWLIST; the cost of the opposite
    // default is a credential the reviewer never considered.
    const out = childEnvForCli({ SOME_FUTURE_TOKEN: "nope", PATH: "/bin" });
    expect(out.SOME_FUTURE_TOKEN).toBeUndefined();
    expect(out.PATH).toBe("/bin");
  });

  it("passes the infrastructure the CLI cannot start or reach the network without", () => {
    const out = childEnvForCli({
      PATH: "/usr/bin",
      HOME: "/home/x",
      USERPROFILE: "C:\\Users\\x",
      SystemRoot: "C:\\Windows",
      HTTPS_PROXY: "http://corp:8080",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/corp.pem",
      LANG: "en_GB.UTF-8",
    });
    expect(out.PATH).toBe("/usr/bin");
    expect(out.HOME).toBe("/home/x");
    // Matched case-insensitively: the allowlist spells it SYSTEMROOT, Windows
    // spells it SystemRoot, and they are the same variable.
    expect(out.SystemRoot).toBe("C:\\Windows");
    expect(out.HTTPS_PROXY).toBe("http://corp:8080");
    expect(out.NODE_EXTRA_CA_CERTS).toBe("/etc/ssl/corp.pem");
    expect(out.LANG).toBe("en_GB.UTF-8");
  });

  it("does not mutate the environment object it was handed", () => {
    const source = { ANTHROPIC_API_KEY: "sk-ant-xxxx", PATH: "/bin" };
    childEnvForCli(source);
    expect(source.ANTHROPIC_API_KEY).toBe("sk-ant-xxxx");
  });
});

describe("parseClaudeJson", () => {
  it("returns the result text and cost from a successful payload", () => {
    const out = parseClaudeJson(
      JSON.stringify({ is_error: false, result: "Dunmar fell in the Third Age.", total_cost_usd: 0.023 })
    );
    expect(out.text).toBe("Dunmar fell in the Third Age.");
    expect(out.costUsd).toBe(0.023);
  });

  it("omits costUsd entirely when the CLI didn't report one", () => {
    const out = parseClaudeJson(JSON.stringify({ result: "hi" }));
    expect(out.text).toBe("hi");
    expect("costUsd" in out).toBe(false);
  });

  it("throws with the CLI's own message when is_error is set", () => {
    expect(() => parseClaudeJson(JSON.stringify({ is_error: true, result: "Invalid model" })))
      .toThrow(/Invalid model/);
  });

  it("throws a message containing the raw head when the payload isn't JSON", () => {
    // The CLI prints human-readable text on some failures. Echoing the head
    // is what makes those diagnosable at all.
    expect(() => parseClaudeJson("Not logged in. Run `claude login`."))
      .toThrow(/Not logged in/);
  });

  it("treats a non-string result as empty rather than crashing", () => {
    expect(parseClaudeJson(JSON.stringify({ result: 42 })).text).toBe("");
  });
});

describe("detectUsageLimit", () => {
  it("flags the CLI's limit phrasings", () => {
    expect(detectUsageLimit("You've hit your usage limit")).toBe(true);
    expect(detectUsageLimit("you're out of extra usage")).toBe(true);
    expect(detectUsageLimit("rate_limit_error")).toBe(true);
    expect(detectUsageLimit("RESOURCE_EXHAUSTED")).toBe(true);
  });

  it("flags an error payload carrying api_error_status 429", () => {
    expect(detectUsageLimit(JSON.stringify({ is_error: true, api_error_status: 429, result: "" })))
      .toBe(true);
  });

  it("does NOT flag model prose that merely mentions limits", () => {
    // The decisive case: a successful answer whose text happens to discuss
    // rate limits must not be reported to the user as a quota failure.
    const wrapper = JSON.stringify({
      is_error: false,
      result: "The wizard's power had reached its usage limit, and rate_limit wards failed.",
    });
    expect(detectUsageLimit(wrapper)).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(detectUsageLimit("")).toBe(false);
  });
});

describe("runClaudeCode — input validation", () => {
  // The model is the only request-derived value that reaches argv, and argv
  // goes through a shell on Windows. It must be rejected before spawn.
  it("rejects a model id containing shell metacharacters, without spawning", async () => {
    await expect(runClaudeCode({ model: "sonnet & calc.exe", prompt: "hi" }))
      .rejects.toThrow(/Invalid model id/);
  });

  it("rejects path separators in the model id", async () => {
    await expect(runClaudeCode({ model: "../../bin/sh", prompt: "hi" }))
      .rejects.toThrow(/Invalid model id/);
  });

  it("categorises validation failures as bad_request", async () => {
    await expect(runClaudeCode({ model: "a;b", prompt: "hi" }))
      .rejects.toMatchObject({ kind: "bad_request" });
  });

  it("rejects a blank prompt before spawning", async () => {
    await expect(runClaudeCode({ prompt: "   " })).rejects.toBeInstanceOf(ClaudeCodeError);
  });

  it("accepts every shipped model alias", () => {
    // Guards against a future alias (e.g. one with a dot) being added to the
    // list but rejected by the charset check — which would present as the
    // model silently disappearing from the picker.
    for (const m of CLAUDE_CODE_MODELS) {
      expect(m).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });
});
