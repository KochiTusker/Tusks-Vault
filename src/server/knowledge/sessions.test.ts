import { describe, expect, it } from "vitest";
import {
  RECENT_WINDOW,
  campaignsOf,
  describeTemporal,
  findSessions,
  looksLikeSession,
  orderSessions,
  resolveTemporalQuery,
} from "./sessions";
import type { LoreUnit } from "./units";

function unit(id: string, title: string, file = id, type?: string): LoreUnit {
  return {
    id,
    title,
    file,
    start: 0,
    end: 0,
    type,
    aliases: [],
    relations: [],
    depth: 0,
    hash: "h",
    chars: 100,
  };
}

/** One campaign in dated files, plus an older run kept as headings inside a
 *  single combined document — both shapes appear in real lore folders. */
const ONE_CAMPAIGN = [
  unit("Run - Session Logs.md#SESSION 1", "SESSION 1", "Run - Session Logs.md"),
  unit("Run - Session Logs.md#SESSION 2", "SESSION 2", "Run - Session Logs.md"),
  unit("Run - Session Logs.md#SESSION 3", "SESSION 3", "Run - Session Logs.md"),
];

const DATED = [
  unit("Sessions/Run/Session-04-2019-01-10.docx", "Session-04-2019-01-10", "Sessions/Run/Session-04-2019-01-10.docx"),
  unit("Sessions/Run/Session-05-2019-02-14.docx", "Session-05-2019-02-14", "Sessions/Run/Session-05-2019-02-14.docx"),
];

describe("looksLikeSession", () => {
  it("recognises the word wherever it appears", () => {
    expect(looksLikeSession("Sessions/Run/Session-04.docx")).toBe(true);
    expect(looksLikeSession("SESSION 12")).toBe(true);
    expect(looksLikeSession("Characters.md")).toBe(false);
  });
});

describe("findSessions", () => {
  it("reads a number out of a heading", () => {
    const found = findSessions(ONE_CAMPAIGN);
    expect(found.map(s => s.number)).toEqual([1, 2, 3]);
  });

  it("reads a number and a date out of a filename", () => {
    const [s] = findSessions([DATED[0]]);
    expect(s.number).toBe(4);
    expect(s.date).toBe("2019-01-10");
  });

  it("prefers the heading's number over the containing document's", () => {
    // Inside a combined log the filename names the whole run, not the entry.
    const [s] = findSessions([unit("Session-99-log.md#SESSION 7", "SESSION 7", "Session-99-log.md")]);
    expect(s.number).toBe(7);
  });

  it("skips a session that carries no number and no date", () => {
    // Declared a session, but nothing to order it by. Including it would put
    // it at an arbitrary point in the timeline, which is worse than omitting
    // it from temporal answers.
    expect(findSessions([unit("notes/entry.md", "The Long Night", "notes/entry.md", "session")])).toEqual([]);
  });

  it("ignores units that are not session records", () => {
    expect(findSessions([unit("Characters.md#Someone", "Someone", "Characters.md")])).toEqual([]);
  });

  it("refuses an impossible date rather than ordering by it", () => {
    const [s] = findSessions([unit("Sessions/Run/Session-04-2019-13-45.docx", "Session-04-2019-13-45", "Sessions/Run/Session-04-2019-13-45.docx")]);
    expect(s.date).toBeUndefined();
    expect(s.number).toBe(4);
  });
});

describe("campaign grouping", () => {
  const twoRuns = findSessions([
    unit("Sessions/Run A/Session-01-2019-01-01.docx", "Session-01-2019-01-01", "Sessions/Run A/Session-01-2019-01-01.docx"),
    unit("Sessions/Run B/Session-01-2019-06-01.docx", "Session-01-2019-06-01", "Sessions/Run B/Session-01-2019-06-01.docx"),
  ]);

  it("separates two runs that share a numbering", () => {
    // The reason "last session" is ambiguous at all: every campaign has a
    // session 1, and merging them invents a history nobody played.
    expect(campaignsOf(twoRuns)).toEqual(["Run A", "Run B"]);
  });

  it("does not treat the generic sessions folder as a campaign name", () => {
    // Nothing distinguishes one run from another here, so there is one run —
    // and no campaign to name in an answer.
    const flat = findSessions([unit("Sessions/Session-01-2019-01-01.docx", "Session-01-2019-01-01", "Sessions/Session-01-2019-01-01.docx")]);
    expect(flat[0].campaign).toBe("");
    expect(campaignsOf(flat)).toEqual([]);
  });

  it("treats a combined log and a dated folder for one campaign as one campaign", () => {
    // The shape a real lore folder ends up in: early sessions archived into a
    // single document, recent ones kept as separate files under a folder named
    // for the same campaign. Compared literally these look like two runs, and
    // every "last session" answer would hedge for no reason.
    const both = findSessions([...ONE_CAMPAIGN, ...DATED]);
    expect(new Set(both.map(s => s.campaign)).size).toBe(1);
  });
});

describe("orderSessions", () => {
  it("orders one campaign by number", () => {
    expect(orderSessions(findSessions(ONE_CAMPAIGN)).map(s => s.number)).toEqual([1, 2, 3]);
  });

  it("orders one campaign by number even when it is stored two ways", () => {
    const mixed = findSessions([...DATED, ...ONE_CAMPAIGN]);
    expect(orderSessions(mixed).map(s => s.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it("orders genuinely separate campaigns by date", () => {
    const two = findSessions([
      unit("Sessions/Run A/Session-09-2019-01-01.docx", "Session-09-2019-01-01", "Sessions/Run A/Session-09-2019-01-01.docx"),
      unit("Sessions/Run B/Session-09-2019-06-01.docx", "Session-09-2019-06-01", "Sessions/Run B/Session-09-2019-06-01.docx"),
    ]);
    expect(orderSessions(two).map(s => s.campaignLabel)).toEqual(["Run A", "Run B"]);
  });

  it("sorts records with no ordering signal last rather than guessing", () => {
    const mixed = findSessions([...DATED]);
    expect(orderSessions(mixed).map(s => s.number)).toEqual([4, 5]);
  });

  it("puts a dateless separate campaign after a dated one", () => {
    const two = findSessions([
      unit("Sessions/Run A/Session-09.docx", "Session-09", "Sessions/Run A/Session-09.docx"),
      unit("Sessions/Run B/Session-09-2019-06-01.docx", "Session-09-2019-06-01", "Sessions/Run B/Session-09-2019-06-01.docx"),
    ]);
    expect(orderSessions(two).map(s => s.campaignLabel)).toEqual(["Run B", "Run A"]);
  });

  it("is stable", () => {
    const m = findSessions([...DATED, ...ONE_CAMPAIGN]);
    expect(orderSessions(m)).toEqual(orderSessions(m));
  });
});

describe("resolveTemporalQuery", () => {
  const markers = findSessions([...ONE_CAMPAIGN, ...DATED]);

  it("answers 'what happened last session' with the latest one", () => {
    const q = resolveTemporalQuery("what happened last session?", markers);
    expect(q.intent).toBe("latest");
    expect(q.sessions[0].number).toBe(5);
  });

  it("recognises the ways people ask for a recap", () => {
    for (const phrasing of [
      "what happened in the most recent session",
      "where did we leave off?",
      "can you recap the previous session",
      "catch me up",
    ]) {
      expect(resolveTemporalQuery(phrasing, markers).intent).toBe("latest");
    }
  });

  it("finds a session asked for by number", () => {
    const q = resolveTemporalQuery("what happened in session 2?", markers);
    expect(q.intent).toBe("numbered");
    expect(q.sessions[0].number).toBe(2);
  });

  it("finds a session asked for in words", () => {
    expect(resolveTemporalQuery("remind me about session twelve", markers).number).toBe(12);
  });

  it("says so when a numbered session does not exist", () => {
    // Better than silently answering about a different session.
    const q = resolveTemporalQuery("what happened in session 99?", markers);
    expect(q.sessions).toEqual([]);
    expect(describeTemporal(q)).toMatch(/No session 99/);
  });

  it("handles a span of recent sessions", () => {
    const q = resolveTemporalQuery("what have we done in the last 3 sessions", markers);
    expect(q.intent).toBe("recent");
    expect(q.sessions).toHaveLength(3);
    expect(q.sessions[0].number).toBe(5);
  });

  it("treats 'the last few sessions' as a window", () => {
    expect(resolveTemporalQuery("recap the last few sessions", markers).sessions).toHaveLength(RECENT_WINDOW);
  });

  it("finds the first session", () => {
    const q = resolveTemporalQuery("what happened in the first session", markers);
    expect(q.intent).toBe("earliest");
    expect(q.sessions[0].number).toBe(1);
  });

  it("reports no temporal intent for a subject question", () => {
    // The signal that the planner should do subject retrieval instead.
    expect(resolveTemporalQuery("who is the harbourmaster", markers).intent).toBe("none");
  });

  it("reports no sessions when the corpus has none", () => {
    expect(resolveTemporalQuery("what happened last session", []).intent).toBe("none");
  });
});

describe("describeTemporal — saying which campaign", () => {
  const twoRuns = findSessions([
    unit("Sessions/Run A/Session-01-2019-01-01.docx", "Session-01-2019-01-01", "Sessions/Run A/Session-01-2019-01-01.docx"),
    unit("Sessions/Run B/Session-01-2019-06-01.docx", "Session-01-2019-06-01", "Sessions/Run B/Session-01-2019-06-01.docx"),
  ]);

  it("names the campaign and offers the alternative", () => {
    const q = resolveTemporalQuery("what happened last session", twoRuns);
    const said = describeTemporal(q);
    expect(said).toContain("Run B");
    expect(said).toMatch(/more than one campaign/);
    expect(said).toContain("Run A");
  });

  it("stays quiet about campaigns when there is only one", () => {
    const q = resolveTemporalQuery("what happened last session", findSessions(ONE_CAMPAIGN));
    expect(describeTemporal(q)).not.toMatch(/more than one campaign/);
  });

  it("says nothing at all for a non-temporal question", () => {
    expect(describeTemporal({ intent: "none", sessions: [] })).toBe("");
  });
});

describe("ordering is a total order", () => {
  /** The shape that produced a cycle: one campaign
   *  stored partly as a dateless combined log and partly as dated files,
   *  alongside a second campaign whose dated sessions fall between them. */
  const MIXED = [
    unit("Run - Session Logs.md#SESSION 22", "SESSION 22", "Run - Session Logs.md"),
    unit("Run - Session Logs.md#SESSION 23", "SESSION 23", "Run - Session Logs.md"),
    unit("Sessions/Run/Session-26-2019-07-01.docx", "Session-26-2019-07-01", "Sessions/Run/Session-26-2019-07-01.docx"),
    unit("Sessions/Run/Session-29-2019-08-06.docx", "Session-29-2019-08-06", "Sessions/Run/Session-29-2019-08-06.docx"),
    unit("Sessions/Other/Session-23-2019-08-13.docx", "Session-23-2019-08-13", "Sessions/Other/Session-23-2019-08-13.docx"),
  ];

  it("keeps one campaign's numbering intact across both storage shapes", () => {
    const run = orderSessions(findSessions(MIXED)).filter(s => s.campaignLabel === "Run");
    expect(run.map(s => s.number)).toEqual([22, 23, 26, 29]);
  });

  it("does not report an archived session as the most recent one played", () => {
    // The observed failure: a cyclic comparator put session 23 last, ahead of
    // sessions 26 and 29 and of a later campaign entirely.
    const ordered = orderSessions(findSessions(MIXED));
    expect(ordered[ordered.length - 1].file).not.toBe("Run - Session Logs.md");
  });

  it("ranks the campaign played most recently last", () => {
    const ordered = orderSessions(findSessions(MIXED));
    expect(ordered[ordered.length - 1].campaignLabel).toBe("Other");
  });

  it("produces the same order however the input is arranged", () => {
    // A cyclic comparator gives a different answer per input permutation.
    const base = orderSessions(findSessions(MIXED)).map(s => `${s.campaign}#${s.number}`);
    for (const shift of [1, 2, 3, 4]) {
      const rotated = [...MIXED.slice(shift), ...MIXED.slice(0, shift)];
      expect(orderSessions(findSessions(rotated)).map(s => `${s.campaign}#${s.number}`)).toEqual(base);
    }
  });
});

describe("one session, many units", () => {
  it("groups the parts of a long log into a single session", () => {
    // An oversized log splits across units. Reporting each part as its own
    // session would answer "the last 3 sessions" with three slices of one.
    const parts = [
      unit("Log.md#SESSION 9 (part 1 of 3)", "SESSION 9 (part 1 of 3)", "Log.md"),
      unit("Log.md#SESSION 9 (part 2 of 3)", "SESSION 9 (part 2 of 3)", "Log.md"),
      unit("Log.md#SESSION 9 (part 3 of 3)", "SESSION 9 (part 3 of 3)", "Log.md"),
    ];
    const found = findSessions(parts);
    expect(found).toHaveLength(1);
    expect(found[0].unitIds).toHaveLength(3);
  });

  it("keeps distinct sessions distinct", () => {
    const found = findSessions([
      unit("Log.md#SESSION 9", "SESSION 9", "Log.md"),
      unit("Log.md#SESSION 10", "SESSION 10", "Log.md"),
    ]);
    expect(found).toHaveLength(2);
  });

  it("does not merge the same number across two campaigns", () => {
    const found = findSessions([
      unit("Sessions/A/Session-01-2019-01-01.docx", "Session-01-2019-01-01", "Sessions/A/Session-01-2019-01-01.docx"),
      unit("Sessions/B/Session-01-2019-06-01.docx", "Session-01-2019-06-01", "Sessions/B/Session-01-2019-06-01.docx"),
    ]);
    expect(found).toHaveLength(2);
  });
});

describe("a recap stays inside one campaign", () => {
  const TWO_RUNS = [
    unit("Sessions/Run/Session-27-2019-07-23.docx", "Session-27-2019-07-23", "Sessions/Run/Session-27-2019-07-23.docx"),
    unit("Sessions/Run/Session-28-2019-07-30.docx", "Session-28-2019-07-30", "Sessions/Run/Session-28-2019-07-30.docx"),
    unit("Sessions/Run/Session-29-2019-08-06.docx", "Session-29-2019-08-06", "Sessions/Run/Session-29-2019-08-06.docx"),
    unit("Sessions/Other/Session-29-2019-08-13.docx", "Session-29-2019-08-13", "Sessions/Other/Session-29-2019-08-13.docx"),
  ];
  const markers = findSessions(TWO_RUNS);

  it("does not blend two campaigns into one recap", () => {
    // Three sessions near each other on a calendar but belonging to different
    // games are not a recap; they are two unrelated evenings.
    const q = resolveTemporalQuery("recap the last 3 sessions", markers);
    expect(new Set(q.sessions.map(s => s.campaign)).size).toBe(1);
  });

  it("recaps the campaign played most recently", () => {
    const q = resolveTemporalQuery("recap the last 3 sessions", markers);
    expect(q.sessions.map(s => s.campaignLabel)).toEqual(["Other"]);
  });

  it("still says the corpus holds other campaigns", () => {
    const said = describeTemporal(resolveTemporalQuery("what happened last session", markers));
    expect(said).toMatch(/more than one campaign/);
  });

  it("takes the earliest session from the campaign that started first", () => {
    const q = resolveTemporalQuery("what happened in the first session", markers);
    expect(q.sessions[0].number).toBe(27);
  });
});

describe("containers are not campaigns", () => {
  /** A lore folder accumulates directories that describe how a session was
   *  PROCESSED — a transcript run, an export batch — not which game it was.
   *  Read as campaign names they invent games nobody played. */
  const WITH_PROCESSING_DIR = [
    unit("Game - Session Logs.md#SESSION 22", "SESSION 22", "Game - Session Logs.md"),
    unit("Game - Session Logs.md#SESSION 23", "SESSION 23", "Game - Session Logs.md"),
    unit("Sessions/Transcript-Run-v3/Session-24-2019-06-04.docx", "Session-24-2019-06-04", "Sessions/Transcript-Run-v3/Session-24-2019-06-04.docx"),
    unit("Sessions/Game/Session-26-2019-07-01.docx", "Session-26-2019-07-01", "Sessions/Game/Session-26-2019-07-01.docx"),
  ];

  it("does not invent a campaign from a processing directory", () => {
    // The observed failure: three directories reported as three campaigns,
    // so every temporal answer hedged about games that did not exist.
    expect(campaignsOf(findSessions(WITH_PROCESSING_DIR))).toEqual([]);
  });

  it("keeps the whole run in one timeline", () => {
    const ordered = orderSessions(findSessions(WITH_PROCESSING_DIR));
    expect(ordered.map(s => s.number)).toEqual([22, 23, 24, 26]);
  });

  it("splits only on evidence — a repeated session number", () => {
    // One campaign numbers its sessions once. A collision is real evidence of
    // two runs; a differing directory name is evidence of nothing.
    const collides = findSessions([
      ...WITH_PROCESSING_DIR,
      unit("Sessions/Other/Session-23-2019-09-01.docx", "Session-23-2019-09-01", "Sessions/Other/Session-23-2019-09-01.docx"),
    ]);
    expect(campaignsOf(collides)).toHaveLength(2);
  });

  it("stays silent about campaigns when there is only one", () => {
    const said = describeTemporal(resolveTemporalQuery("what happened last session", findSessions(WITH_PROCESSING_DIR)));
    expect(said).not.toMatch(/more than one campaign/);
    expect(said).toMatch(/session 26/);
  });

  it("groups the same way however the directories are walked", () => {
    const base = campaignsOf(findSessions(WITH_PROCESSING_DIR));
    for (const shift of [1, 2, 3]) {
      const rotated = [...WITH_PROCESSING_DIR.slice(shift), ...WITH_PROCESSING_DIR.slice(0, shift)];
      expect(campaignsOf(findSessions(rotated))).toEqual(base);
    }
  });
});
