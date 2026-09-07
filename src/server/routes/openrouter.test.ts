import { describe, it, expect } from "vitest";
import { normalisePolicies } from "./openrouter";

describe("normalisePolicies", () => {
  it("parses explicit policy booleans", () => {
    const out = normalisePolicies({
      data: [
        {
          displayName: "CleanHost",
          dataPolicy: { training: false, retainsPrompts: false, retentionDays: 0 },
        },
        {
          displayName: "RetainerHost",
          dataPolicy: { training: true, retainsPrompts: true, retentionDays: 30 },
        },
      ],
    });
    expect(out).toEqual([
      { name: "CleanHost", trains: false, retains: false, retentionDays: 0 },
      { name: "RetainerHost", trains: true, retains: true, retentionDays: 30 },
    ]);
  });

  it("an ABSENT policy field must not read as safe — only an explicit false does", () => {
    // The live feed carries explicit booleans on every row today; this pins
    // the behaviour if that ever drifts. A silent parse change that painted
    // every provider privacy-clean would be the worst possible default for a
    // local-first project.
    const out = normalisePolicies({
      data: [{ displayName: "VagueHost", dataPolicy: {} }],
    });
    expect(out[0].trains).toBe(true);
    expect(out[0].retains).toBe(true);
    expect(out[0].retentionDays).toBeNull();
  });

  it("a missing dataPolicy object reads the same as a vague one", () => {
    const out = normalisePolicies({ data: [{ displayName: "NoPolicyHost" }] });
    expect(out[0]).toEqual({
      name: "NoPolicyHost",
      trains: true,
      retains: true,
      retentionDays: null,
    });
  });

  it("rows without a displayName are dropped; garbage feeds parse to []", () => {
    expect(normalisePolicies({ data: [{ dataPolicy: { training: false } }] })).toEqual([]);
    expect(normalisePolicies({})).toEqual([]);
    expect(normalisePolicies(null)).toEqual([]);
    expect(normalisePolicies("nonsense")).toEqual([]);
  });
});
