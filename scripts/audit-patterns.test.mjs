// Pattern suite for the audit scripts. Exercises every regex in
// audit-patterns.mjs with realistic positive samples + a focused set of
// negative cases (UUIDs, filenames, normal logs) to guard against false
// positives. The audit scripts and pre-push hook all funnel through
// this same pattern list — if a future contributor adds a pattern that
// flags a UUID or a filename, these tests fail.

import { describe, it, expect } from "vitest";
import { PATTERNS, maskMatch, shouldSuppress } from "./audit-patterns.mjs";

function findByName(name) {
  const entry = PATTERNS.find(p => p.name === name);
  if (!entry) throw new Error(`Pattern ${name} not registered`);
  entry.re.lastIndex = 0;
  return entry.re;
}

function matches(name, s) {
  const re = findByName(name);
  return re.test(s);
}

describe("Anthropic pattern", () => {
  it("matches a realistic sk-ant-api03 key", () => {
    expect(matches("Anthropic", "sk-ant-api03-AbCdEf1234567890ABCDEFghijkl_-")).toBe(true);
  });
  it("does not match short prefixes", () => {
    expect(matches("Anthropic", "sk-ant-")).toBe(false);
    expect(matches("Anthropic", "sk-ant-short")).toBe(false);
  });
});

describe("OpenAI pattern", () => {
  it("matches a classic sk- key", () => {
    expect(matches("OpenAI", "sk-AbCdEf1234567890123456")).toBe(true);
  });
  it("matches a project (sk-proj-) key", () => {
    expect(matches("OpenAI", "sk-proj-AbCdEf1234567890123456abcdef")).toBe(true);
  });
  it("does not match the bare prefix", () => {
    expect(matches("OpenAI", "sk-")).toBe(false);
  });
  it("is suppressed when the line also contains the Anthropic prefix", () => {
    // The OpenAI regex matches sk-ant-… as well, but shouldSuppress filters it out.
    const line = "sk-ant-api03-AbCdEf1234567890123456";
    const re = findByName("OpenAI");
    expect(re.test(line)).toBe(true);  // raw regex matches
    expect(shouldSuppress("OpenAI", line)).toBe(true);  // but the suppressor kicks in
  });

  it("does not match lowercase hyphenated prose", () => {
    // A generated docs page had the heading anchor
    // "#who-may-ask-and-who-sees-the-answer", which contains
    // "sk-and-who-sees-the-answer" and matched the untightened pattern. Any
    // sentence with "ask and ..." in it would have done the same, so this is
    // a class of false positive, not one unlucky string.
    expect(matches("OpenAI", "sk-and-who-sees-the-answer")).toBe(false);
    expect(matches("OpenAI", "sk-and-wait-for-the-answer-here")).toBe(false);
  });

  it("still matches keys that carry a digit or an uppercase letter", () => {
    // Real keys are high-entropy base62 and always have at least one of each.
    // The lookahead asks for either, not both, because a fixture of repeated
    // uppercase is legitimate test input and must not be waved through.
    expect(matches("OpenAI", "sk-AAAAAAAAAAAAAAAAAAAA")).toBe(true);
    expect(matches("OpenAI", "sk-12345678901234567890")).toBe(true);
  });
});

describe("Google pattern", () => {
  it("matches an AIzaSy-style API key", () => {
    expect(matches("Google", "AIzaSyAbCdEf1234567890ABCDEF1234567890XYZ")).toBe(true);
  });
  it("does not match short prefixes", () => {
    expect(matches("Google", "AIza")).toBe(false);
    expect(matches("Google", "AIzaShort")).toBe(false);
  });
});

describe("Discord pattern", () => {
  // Assembled from segments rather than written as one literal. The joined
  // value is byte-identical to a real token's shape — which is the point of
  // the fixture — and that shape is one GitHub's own push protection blocks,
  // so a file containing it literally cannot be pushed to a public repo at
  // all. The project's pattern needs 27+ in the last segment and so does
  // GitHub's, leaving no length that satisfies one and not the other.
  const BOT_TOKEN = ["MTE3MzcyNzAxMjM0NTY3ODk2", "GxYzAB", "AbCdEfGhIjKlMnOpQrStUvWxYzA"].join(".");

  it("matches a 3-segment base64url bot token", () => {
    expect(matches("Discord", BOT_TOKEN)).toBe(true);
  });
  it("does not match a UUID with dashes (no dots)", () => {
    expect(matches("Discord", "f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(false);
  });
  it("does not match a filename with two dots", () => {
    expect(matches("Discord", "package-lock.json")).toBe(false);
    expect(matches("Discord", "src/server/util/log-capture.ts")).toBe(false);
  });
});

describe("Slack pattern", () => {
  it("matches a bot token", () => {
    expect(matches("Slack", "xoxb-123456789012-abcdefghijkl")).toBe(true);
  });
  it("matches a user token", () => {
    expect(matches("Slack", "xoxp-1234567890-abcdef")).toBe(true);
  });
  it("does not match short prefixes", () => {
    expect(matches("Slack", "xoxb-")).toBe(false);
  });
});

describe("GitHub pattern", () => {
  it("matches a personal access token", () => {
    expect(matches("GitHub", "ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ")).toBe(true);
  });
  it("matches an OAuth token", () => {
    expect(matches("GitHub", "gho_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ")).toBe(true);
  });
  it("matches user-to-server, server-to-server, refresh tokens", () => {
    expect(matches("GitHub", "ghu_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ")).toBe(true);
    expect(matches("GitHub", "ghs_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ")).toBe(true);
    expect(matches("GitHub", "ghr_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ")).toBe(true);
  });
  it("does not match the prefix alone", () => {
    expect(matches("GitHub", "ghp_")).toBe(false);
  });
});

describe("AWS pattern", () => {
  // AWS's own documented example key, assembled from its prefix at runtime.
  // Written as one literal it is a valid AKIA/ASIA shape, and GitHub raises a
  // secret-scanning alert on the ASIA form even though the value is a public
  // placeholder from AWS's documentation. The pattern is a fixed 16 characters
  // after the prefix, so unlike the Stripe case there is no length that
  // satisfies this pattern and not GitHub's.
  const EXAMPLE_BODY = "IOSFODNN7EXAMPLE";

  it("matches AKIA access key IDs", () => {
    expect(matches("AWS", "AKIA" + EXAMPLE_BODY)).toBe(true);
  });
  it("matches ASIA temporary access key IDs", () => {
    expect(matches("AWS", "ASIA" + EXAMPLE_BODY)).toBe(true);
  });
  it("does not match arbitrary uppercase 20-char strings", () => {
    expect(matches("AWS", "FOOBARBAZQUXIOSFODNN")).toBe(false);
  });
  it("requires word boundaries — does not match mid-word", () => {
    expect(matches("AWS", "X" + "AKIA" + EXAMPLE_BODY + "Y")).toBe(false);
  });
});

describe("Stripe pattern", () => {
  // Suffixes are held at the pattern's 20-character minimum. At 24+ these
  // fixtures also match GitHub's own Stripe detector, which blocks the push
  // of any repository containing them — so the shorter form both exercises
  // the boundary this pattern documents and stays pushable.
  it("matches sk_live_ secret keys at the minimum length", () => {
    expect(matches("Stripe", "sk_live_abcdefghijklmnopqrst")).toBe(true);
  });
  it("matches pk_test_ public test keys", () => {
    expect(matches("Stripe", "pk_test_abcdefghijklmnopqrst")).toBe(true);
  });
  it("matches restricted keys (rk_)", () => {
    expect(matches("Stripe", "rk_live_abcdefghijklmnopqrst")).toBe(true);
  });
  it("does not match below the 20-character minimum", () => {
    expect(matches("Stripe", "sk_live_abcdefghijklmnopqrs")).toBe(false); // 19
    expect(matches("Stripe", "sk_live_abcdefghijklmnopqrst")).toBe(true); // 20
  });
  it("does not match the prefix alone", () => {
    expect(matches("Stripe", "sk_live_")).toBe(false);
  });
});

describe("JWT pattern", () => {
  it("matches a 3-segment eyJ-prefixed token", () => {
    expect(matches(
      "JWT",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    )).toBe(true);
  });
  it("does not match arbitrary base64 strings without eyJ prefix", () => {
    expect(matches("JWT", "abc.def.ghi")).toBe(false);
  });
});

describe("PrivateKey pattern", () => {
  it("matches RSA PEM armour", () => {
    expect(matches("PrivateKey", "-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
  });
  it("matches generic PRIVATE KEY armour (PKCS#8)", () => {
    expect(matches("PrivateKey", "-----BEGIN PRIVATE KEY-----")).toBe(true);
  });
  it("matches OpenSSH armour", () => {
    expect(matches("PrivateKey", "-----BEGIN OPENSSH PRIVATE KEY-----")).toBe(true);
  });
  it("does not match the PUBLIC KEY armour", () => {
    expect(matches("PrivateKey", "-----BEGIN PUBLIC KEY-----")).toBe(false);
    expect(matches("PrivateKey", "-----BEGIN RSA PUBLIC KEY-----")).toBe(false);
  });
});

describe("maskMatch", () => {
  it("masks short strings with the head only", () => {
    expect(maskMatch("short")).toBe("shor…");
  });
  it("masks medium strings with head+tail", () => {
    expect(maskMatch("abcdefghijklmnop")).toBe("abcdefgh…mnop");
  });
  it("masks long real-shaped tokens", () => {
    const m = maskMatch("sk-ant-api03-AbCdEf1234567890ABCDEFghijkl_-");
    expect(m.startsWith("sk-ant-a")).toBe(true);
    expect(m.endsWith("kl_-")).toBe(true);
  });
});

describe("no false positives on common content", () => {
  // These strings are noisy enough that a permissive regex could match. We
  // assert NONE of the registered patterns flag them.
  const benign = [
    "f47ac10b-58cc-4372-a567-0e02b2c3d479",                      // UUID
    "package-lock.json",                                          // filename with dot
    "src/server/util/log-capture.ts",                             // file path
    "https://github.com/KochiTusker/Tusks-Vault.git",             // public URL
    "https://example.com/path/to/resource?foo=bar",               // generic URL
    "commit abc1234 — implement updater tag mode",                // git log line
    "0.1.0",                                                      // semver
    "node_modules/.package-lock.json",                            // path
    "    \"version\": \"4.21.2\"",                                // package.json line
    "Bearer keepThisTextNonMatching",                             // bearer-like but not matching
    "Connection: keep-alive",                                     // HTTP header
  ];
  for (const sample of benign) {
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      // OpenAI regex is intentionally broad (sk- prefix) so it matches a
      // lot. The suppressor is the actual filter. Combine raw regex match
      // with the suppression check.
      it(`does not flag "${sample.slice(0, 40)}…" as ${name}`, () => {
        re.lastIndex = 0;
        const m = re.exec(sample);
        if (!m) return; // good — no raw match
        // If raw regex matched, the suppressor MUST kick in or it's a false positive.
        expect(shouldSuppress(name, sample)).toBe(true);
      });
    }
  }
});
