import { describe, expect, it } from "vitest";
import {
  MAX_INFERRED_PARTY,
  REGULAR_MIN_SESSIONS,
  attributedSpeakers,
  detectCohortQuery,
  foldShortNames,
  resolveCohort,
} from "./cohort";
import { buildSurfaceIndex } from "./surface-index";
import type { LoreUnit } from "./units";

function unit(id: string, title: string, aliases: string[] = []): LoreUnit {
  return { id, title, file: id, start: 0, end: 0, aliases, relations: [], depth: 0, hash: "h", chars: 0 };
}

/** Transcript-shaped session text: speech attributed at line start. */
const transcript = (n: number, lines: string[]) => ({ session: `s${n}`, text: lines.join("\n") });

const SESSIONS = [
  transcript(1, [
    "Dungeon Master: The road narrows.",
    "Marren Koll: I don't like it.",
    "Tovin Ashe: Nor me.",
    "Sela Ward: Keep walking.",
  ]),
  transcript(2, [
    "DM: A rider approaches.",
    "Marren Koll: Weapons down.",
    "Tovin Ashe: Says you.",
    "Sela Ward: Both of you, quiet.",
    "A Passing Merchant: Good day!",
  ]),
  transcript(3, [
    "Marren Koll: We should go back.",
    "Sela Ward: No.",
  ]),
];

describe("attributedSpeakers", () => {
  it("finds who speaks, counted by session not by line", () => {
    // One long monologue is not seven sessions of presence.
    const heard = attributedSpeakers(SESSIONS);
    const marren = heard.find(h => h.name === "Marren Koll")!;
    expect(marren.sessions).toBe(3);
  });

  it("excludes whoever is running the game", () => {
    // The GM speaks every session and is not a party member.
    const names = attributedSpeakers(SESSIONS).map(h => h.name);
    expect(names).not.toContain("Dungeon Master");
    expect(names).not.toContain("DM");
  });

  it("ranks regulars above one-off guests", () => {
    const heard = attributedSpeakers(SESSIONS);
    expect(heard[0].sessions).toBeGreaterThan(heard[heard.length - 1].sessions);
    expect(heard.find(h => h.name === "A Passing Merchant")!.sessions).toBe(1);
  });

  it("ignores prose that merely contains a colon", () => {
    const prose = [{ session: "s1", text: "The party travelled far. Then this happened: nothing." }];
    expect(attributedSpeakers(prose)).toEqual([]);
  });

  it("reads an attribution carrying the player's name in brackets", () => {
    const withPlayer = [{ session: "s1", text: "Marren Koll (Sam): I'll go first." }];
    expect(attributedSpeakers(withPlayer)[0].name).toBe("Marren Koll");
  });

  it("returns nothing for chronicle-style prose with no attribution", () => {
    // A real limit, not a failure: this layer only works where transcripts do.
    const chronicle = [{ session: "s1", text: "They rode north through the rain, saying little." }];
    expect(attributedSpeakers(chronicle)).toEqual([]);
  });
});

describe("foldShortNames", () => {
  it("folds a shortening into the fuller name", () => {
    // Transcripts abbreviate once the table knows who is who; unfolded, one
    // player takes two seats in the roster.
    const folded = foldShortNames([
      { name: "Marren Koll", sessions: 4 },
      { name: "Marren", sessions: 2 },
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0].name).toBe("Marren Koll");
  });

  it("does not fold two genuinely different names", () => {
    const folded = foldShortNames([
      { name: "Marren Koll", sessions: 4 },
      { name: "Tovin Ashe", sessions: 3 },
    ]);
    expect(folded).toHaveLength(2);
  });

  it("does not fold on a partial word", () => {
    const folded = foldShortNames([
      { name: "Marren Koll", sessions: 4 },
      { name: "Mar", sessions: 2 },
    ]);
    expect(folded).toHaveLength(2);
  });
});

describe("resolveCohort", () => {
  const surface = buildSurfaceIndex([
    unit("People/Marren.md", "Marren Koll"),
    unit("People/Tovin.md", "Tovin Ashe"),
    unit("People/Sela.md", "Sela Ward"),
  ]);

  it("uses a roster the user set, and says it is certain", () => {
    // The GM knows who is at their table; inference never beats being told.
    const c = resolveCohort({ roster: ["Marren Koll", "Sela Ward"], surface });
    expect(c.basis).toBe("roster");
    expect(c.certain).toBe(true);
    expect(c.members.map(m => m.name)).toEqual(["Marren Koll", "Sela Ward"]);
  });

  it("attaches each member to their unit so the planner can fetch it", () => {
    const c = resolveCohort({ roster: ["Marren Koll"], surface });
    expect(c.members[0].unitId).toBe("People/Marren.md");
  });

  it("accepts a member with no unit of their own", () => {
    // Being in every session and having no page is normal.
    const c = resolveCohort({ roster: ["Someone Undocumented"], surface });
    expect(c.members[0].unitId).toBeUndefined();
  });

  it("falls back to who speaks in the sessions", () => {
    const c = resolveCohort({ sessionTexts: SESSIONS, surface });
    expect(c.basis).toBe("speakers");
    expect(c.members.map(m => m.name).sort()).toEqual(["Marren Koll", "Sela Ward", "Tovin Ashe"]);
  });

  it("marks an inferred cohort as uncertain and says how to correct it", () => {
    // A wrong roster must be visible in the answer, not silent.
    const c = resolveCohort({ sessionTexts: SESSIONS, surface });
    expect(c.certain).toBe(false);
    expect(c.note).toMatch(/set the roster/i);
  });

  it("drops one-off guests from an inferred cohort", () => {
    const c = resolveCohort({ sessionTexts: SESSIONS, surface });
    expect(c.members.map(m => m.name)).not.toContain("A Passing Merchant");
    expect(REGULAR_MIN_SESSIONS).toBeGreaterThan(1);
  });

  it("caps an inferred cohort rather than comparing twenty candidates", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      transcript(i, Array.from({ length: 20 }, (_, j) => `Person Number${j}: hello`))
    );
    expect(resolveCohort({ sessionTexts: many }).members.length).toBeLessThanOrEqual(MAX_INFERRED_PARTY);
  });

  it("says plainly when it cannot work out the party", () => {
    // Better than ranking an empty field.
    const c = resolveCohort({ sessionTexts: [{ session: "s1", text: "They rode north." }] });
    expect(c.basis).toBe("none");
    expect(c.members).toEqual([]);
    expect(c.note).toMatch(/could not work out/i);
  });

  it("prefers the roster even when sessions are available", () => {
    const c = resolveCohort({ roster: ["Only This One"], sessionTexts: SESSIONS, surface });
    expect(c.basis).toBe("roster");
    expect(c.members).toHaveLength(1);
  });
});

describe("detectCohortQuery", () => {
  it("recognises a superlative over the party", () => {
    for (const q of [
      "who is the most violent person in the party?",
      "which party member is most likely to lie",
      "who in the group is the least trustworthy",
      "which of them would win a fight",
    ]) {
      expect(detectCohortQuery(q).isCohort).toBe(true);
    }
  });

  it("recognises a likelihood question even without a group word", () => {
    expect(detectCohortQuery("who is most likely to steal the horse").isCohort).toBe(true);
  });

  it("extracts the trait being compared", () => {
    expect(detectCohortQuery("who is the most violent person in the party").trait).toBe("most violent");
    expect(detectCohortQuery("which of the party is the least honest").trait).toBe("least honest");
  });

  it("leaves an ordinary lookup alone", () => {
    // A superlative without a group is a lookup, not a ranking: falling
    // through to subject retrieval is the right answer.
    for (const q of [
      "who is the harbourmaster",
      "what happened last session",
      "tell me about the Ivory Gate",
    ]) {
      expect(detectCohortQuery(q).isCohort).toBe(false);
    }
  });

  it("does not fire on a superlative about one named thing", () => {
    expect(detectCohortQuery("what is the oldest building in the city").isCohort).toBe(false);
  });
});
