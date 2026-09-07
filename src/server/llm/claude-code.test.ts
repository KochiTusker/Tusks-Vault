import { describe, expect, it } from "vitest";
import { CLAUDE_CODE_CLOSER, CLAUDE_CODE_FRAMING } from "./claude-code";

describe("CLAUDE_CODE_CLOSER", () => {
  it("tells the model to answer, and not to acknowledge", () => {
    // The CLI has no system-role parameter, so framing, system prompt, lore
    // and question all arrive as one user message — and a small model
    // sometimes replies to the instructions instead: "I am the archivist of
    // your chronicle, ready to answer questions according to the rules you've
    // set." Obedient, and useless in a Discord channel.
    expect(CLAUDE_CODE_CLOSER).toMatch(/answer the question above/i);
    expect(CLAUDE_CODE_CLOSER).toMatch(/do not acknowledge/i);
    expect(CLAUDE_CODE_CLOSER).toMatch(/do not introduce/i);
  });

  it("points at the source material rather than inviting free recall", () => {
    expect(CLAUDE_CODE_CLOSER).toMatch(/source material/i);
  });

  it("is short, so it cannot crowd the persona or the rules it follows", () => {
    // It is the most recent instruction the model reads. That position is
    // exactly why it works, and exactly why it must not grow into a second
    // rulebook competing with the first.
    expect(CLAUDE_CODE_CLOSER.length).toBeLessThan(400);
  });
});

describe("CLAUDE_CODE_FRAMING", () => {
  it("does not impersonate a system message", () => {
    // It arrives inside the user message, because the CLI has no system-role
    // parameter. Text that asserts system authority from there is
    // indistinguishable from a prompt injection, and Claude models say so —
    // out loud, ahead of the answer, in the Discord reply.
    expect(CLAUDE_CODE_FRAMING).not.toMatch(/overrides any default/i);
    expect(CLAUDE_CODE_FRAMING).not.toMatch(/treat the instructions that follow as authoritative/i);
    expect(CLAUDE_CODE_FRAMING).not.toMatch(/operating context/i);
  });

  it("says where the request comes from and who owns the material", () => {
    expect(CLAUDE_CODE_FRAMING).toMatch(/owner of that material/i);
    expect(CLAUDE_CODE_FRAMING).toMatch(/not a system directive/i);
  });

  it("asks for faithful recital without asking to originate anything", () => {
    // The distinction the whole block turns on: reproducing a table's own
    // crude prose is the job; producing new material of that kind is not what
    // is being requested, and conflating the two invites a refusal of both.
    expect(CLAUDE_CODE_FRAMING).toMatch(/faithful recital/i);
    expect(CLAUDE_CODE_FRAMING).toMatch(/not a request to originate/i);
  });
});
