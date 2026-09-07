import { describe, it, expect } from "vitest";
import { detectRefusal } from "./refusal";

describe("detectRefusal — real declines", () => {
  // Verbatim shape of a decline observed from Claude Code on an edgy question:
  // it led with the decline, named the objection, and offered a rephrase.
  const observed =
    "I decline to rank a party member by that word — it's a slur regardless of what tone the rest " +
    "of the chronicle takes, and I won't apply it to the table's characters. What I can tell you " +
    "from the record: David suffered a minor existential breakdown poking at a wall. If you want a " +
    "who's-the-party's-fool read, I can dig that up properly — just say the word without the slur " +
    "and I'll answer straight.";

  it("catches the observed decline and reports it as a phrasing objection", () => {
    const v = detectRefusal(observed);
    expect(v.refused).toBe(true);
    // Both an "I decline to" and a slur objection match; the specific kind is
    // the useful one to surface, so it must win over "unspecified".
    expect(v.kind).toBe("phrasing");
    expect(v.matched).toBeTruthy();
  });

  it("catches the plain forms", () => {
    expect(detectRefusal("I won't answer that.").refused).toBe(true);
    expect(detectRefusal("I will not rank people that way.").refused).toBe(true);
    expect(detectRefusal("I'm not going to write that scene.").refused).toBe(true);
    expect(detectRefusal("I can't help with that.").refused).toBe(true);
  });

  it("separates a content objection from a phrasing one", () => {
    expect(detectRefusal("I won't describe that in detail.").kind).toBe("content");
    expect(detectRefusal("Ask again without the slur and I'll answer.").kind).toBe("phrasing");
  });
});

describe("detectRefusal — what must NOT trip it", () => {
  // The expensive failure. A false positive tells a DM their good answer was
  // refused; the answer is shown either way, so a miss costs a label while a
  // false alarm costs trust in the label.
  it("ignores the chronicle's own characters refusing each other", () => {
    expect(
      detectRefusal(
        "Kaziel refuses to open the gate, and the guard will not answer him. " +
          "\"I decline to treat with you,\" the seneschal said [Session-12.md]."
      ).refused
    ).toBe(false);
  });

  it("ignores a decline quoted deep inside a long answer", () => {
    // Same words, but 400+ characters in — that is the chronicle talking.
    const answer = `${"The Dunmar host marched for nine days. ".repeat(14)}I decline to treat with you, said the envoy.`;
    expect(detectRefusal(answer).refused).toBe(false);
  });

  it("ignores the lore-gap phrase, which Rule 3 already owns", () => {
    expect(
      detectRefusal("I am unsure about this detail. I have recorded this as a lore gap for the DM to clarify.")
        .refused
    ).toBe(false);
  });

  it("ignores an archivist saying the archive lacks something", () => {
    expect(detectRefusal("I can't find any mention of that name in the chronicle.").refused).toBe(false);
    expect(detectRefusal("I don't know of a city by that name [Places.md].").refused).toBe(false);
  });

  it("ignores an ordinary grim answer", () => {
    expect(
      detectRefusal(
        "Brody was cut down at the ford, and the record is explicit about it: the blow took him " +
          "below the ribs and he bled out before the healer reached him [Session-21.md]."
      ).refused
    ).toBe(false);
  });

  it("handles empty and whitespace responses without claiming a refusal", () => {
    expect(detectRefusal("").refused).toBe(false);
    expect(detectRefusal("   \n  ").refused).toBe(false);
  });
});

describe("detectRefusal — the matched sentence", () => {
  it("returns the sentence that fired, not the whole response", () => {
    const v = detectRefusal("I decline to rank them. The rest of this is a long answer about the siege.");
    expect(v.matched).toBe("I decline to rank them.");
  });
});
