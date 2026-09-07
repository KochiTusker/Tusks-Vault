import { describe, expect, it } from "vitest";
import path from "path";
import { resolveKnowledgeDir } from "./paths";

// Pure-logic tests for the resolution priority. The real boot-time resolution
// reads env + settings + filesystem; here we feed the function explicit
// arguments so each branch is testable without touching disk or env.
//
// As of the Sessions/ flatten refactor, knowledgePath always equals rootPath
// — the loader scans the lore tree recursively. The dual-path interface is
// kept for forward-compat with any future "scan a sub-tree" feature.

const REPO_LORE = path.resolve("/tmp/fake-repo/Lore");
const SIBLINGS = [
  path.resolve("/tmp/fake-repo/../Tusks-Lore"),
  path.resolve("/tmp/fake-repo/../tusks-lore"),
];

describe("resolveKnowledgeDir priority order", () => {
  it("env override wins over everything; knowledgePath == rootPath", () => {
    const envIn = "/custom/path";
    const r = resolveKnowledgeDir({
      envOverride: envIn,
      settingsOverride: "/settings/path",
      isDir: () => true,
      siblingCandidates: SIBLINGS,
      repoLore: REPO_LORE,
    });
    const expected = path.isAbsolute(envIn) ? envIn : path.resolve(process.cwd(), envIn);
    expect(r.rootPath).toBe(expected);
    expect(r.knowledgePath).toBe(expected);
    expect(r.reason).toBe("env");
    expect(r.isExternal).toBe(true);
  });

  it("settings override wins when env is unset", () => {
    const settingsIn = "/settings/path";
    const r = resolveKnowledgeDir({
      envOverride: null,
      settingsOverride: settingsIn,
      isDir: () => true,
      siblingCandidates: SIBLINGS,
      repoLore: REPO_LORE,
    });
    const expected = path.isAbsolute(settingsIn)
      ? settingsIn
      : path.resolve(process.cwd(), settingsIn);
    expect(r.rootPath).toBe(expected);
    expect(r.knowledgePath).toBe(expected);
    expect(r.reason).toBe("settings");
    expect(r.isExternal).toBe(true);
  });

  it("sibling probe wins when env + settings are both unset and a sibling exists", () => {
    const r = resolveKnowledgeDir({
      envOverride: null,
      settingsOverride: null,
      isDir: p => p === SIBLINGS[1],
      siblingCandidates: SIBLINGS,
      repoLore: REPO_LORE,
    });
    expect(r.rootPath).toBe(SIBLINGS[1]);
    expect(r.knowledgePath).toBe(SIBLINGS[1]);
    expect(r.reason).toBe("sibling");
    expect(r.isExternal).toBe(true);
  });

  it("falls back to repo-local Lore/ when nothing else applies", () => {
    const r = resolveKnowledgeDir({
      envOverride: null,
      settingsOverride: null,
      isDir: () => false,
      siblingCandidates: SIBLINGS,
      repoLore: REPO_LORE,
    });
    expect(r.rootPath).toBe(REPO_LORE);
    expect(r.knowledgePath).toBe(REPO_LORE);
    expect(r.reason).toBe("fallback");
    expect(r.isExternal).toBe(false);
  });

  it("settings override pointing at repo-local Lore/ stays isExternal:false", () => {
    // Power-user case: someone explicitly configures the legacy flat dir.
    // The migration logic gates on isExternal, so this must stay false.
    const r = resolveKnowledgeDir({
      envOverride: null,
      settingsOverride: REPO_LORE,
      isDir: () => true,
      siblingCandidates: SIBLINGS,
      repoLore: REPO_LORE,
    });
    expect(r.rootPath).toBe(REPO_LORE);
    expect(r.knowledgePath).toBe(REPO_LORE);
    expect(r.reason).toBe("settings");
    expect(r.isExternal).toBe(false);
  });

  it("treats whitespace-only env override as unset", () => {
    const r = resolveKnowledgeDir({
      envOverride: "   ",
      settingsOverride: null,
      isDir: () => false,
      siblingCandidates: SIBLINGS,
      repoLore: REPO_LORE,
    });
    expect(r.reason).toBe("fallback");
  });

  it("treats empty-string settings override as unset", () => {
    const r = resolveKnowledgeDir({
      envOverride: null,
      settingsOverride: "",
      isDir: () => false,
      siblingCandidates: SIBLINGS,
      repoLore: REPO_LORE,
    });
    expect(r.reason).toBe("fallback");
  });

  it("env override accepts a relative path (resolved against cwd)", () => {
    const r = resolveKnowledgeDir({
      envOverride: "relative/lore",
      settingsOverride: null,
      isDir: () => false,
      siblingCandidates: SIBLINGS,
      repoLore: REPO_LORE,
    });
    expect(path.isAbsolute(r.rootPath)).toBe(true);
    expect(r.knowledgePath).toBe(r.rootPath);
    expect(r.reason).toBe("env");
  });

  it("first matching sibling wins (probe order matters)", () => {
    const r = resolveKnowledgeDir({
      envOverride: null,
      settingsOverride: null,
      isDir: () => true,
      siblingCandidates: SIBLINGS,
      repoLore: REPO_LORE,
    });
    expect(r.rootPath).toBe(SIBLINGS[0]);
    expect(r.knowledgePath).toBe(SIBLINGS[0]);
  });
});
