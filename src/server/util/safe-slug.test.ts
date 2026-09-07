import { describe, expect, it } from "vitest";
import { assertSafeSlug, isSafeSlug } from "./safe-slug";

describe("isSafeSlug", () => {
  it("accepts alphanumerics, hyphens, underscores", () => {
    expect(isSafeSlug("local-llm")).toBe(true);
    expect(isSafeSlug("personas")).toBe(true);
    expect(isSafeSlug("Chronicler")).toBe(true);
    expect(isSafeSlug("a1_b2-c3")).toBe(true);
  });

  it("accepts UUID v4 (used as persona ids)", () => {
    expect(isSafeSlug("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
  });

  it("rejects path-traversal sequences", () => {
    expect(isSafeSlug("..")).toBe(false);
    expect(isSafeSlug("../etc/passwd")).toBe(false);
    expect(isSafeSlug("legit/..")).toBe(false);
  });

  it("rejects slashes and backslashes", () => {
    expect(isSafeSlug("a/b")).toBe(false);
    expect(isSafeSlug("a\\b")).toBe(false);
  });

  it("rejects dots, spaces, and shell metacharacters", () => {
    expect(isSafeSlug("a.b")).toBe(false);
    expect(isSafeSlug("a b")).toBe(false);
    expect(isSafeSlug("a;b")).toBe(false);
    expect(isSafeSlug("a&b")).toBe(false);
    expect(isSafeSlug("$VAR")).toBe(false);
  });

  it("rejects empty strings and over-long inputs", () => {
    expect(isSafeSlug("")).toBe(false);
    expect(isSafeSlug("a".repeat(101))).toBe(false);
    expect(isSafeSlug("a".repeat(100))).toBe(true);
  });

  it("rejects non-strings", () => {
    expect(isSafeSlug(undefined)).toBe(false);
    expect(isSafeSlug(null)).toBe(false);
    expect(isSafeSlug(42)).toBe(false);
    expect(isSafeSlug({ toString: () => "ok" })).toBe(false);
  });
});

describe("assertSafeSlug", () => {
  it("returns silently for a valid slug", () => {
    expect(() => assertSafeSlug("grim-chronicler", "persona id")).not.toThrow();
  });

  it("throws with a descriptive label for an invalid slug", () => {
    expect(() => assertSafeSlug("../etc/passwd", "persona id"))
      .toThrow(/Invalid persona id/);
  });

  it("throws for empty input", () => {
    expect(() => assertSafeSlug("", "persona id")).toThrow(/Invalid persona id/);
  });
});
