import { describe, expect, it } from "vitest";
import {
  DF_CAP,
  buildMentionIndex,
  deserialiseMentionIndex,
  serialiseMentionIndex,
  unitsMentioning,
} from "./mention-index";
import { buildSurfaceIndex } from "./surface-index";
import type { LoreUnit } from "./units";

function unit(id: string, title: string, aliases: string[] = []): LoreUnit {
  return {
    id,
    title,
    file: id,
    start: 0,
    end: 0,
    aliases,
    relations: [],
    depth: 0,
    hash: "h",
    chars: 0,
  };
}

const units = [
  unit("people/marren.md", "Marren Koll", ["the Ledgerman"]),
  unit("people/tovin.md", "Tovin Ashe"),
  unit("places/ivory-gate.md", "The Ivory Gate"),
  unit("sessions/01.md", "Session One"),
  unit("sessions/02.md", "Session Two"),
];

const bodies: Record<string, string> = {
  "people/marren.md": "A ledger-keeper of the city. Serves no one gladly.",
  // Names Marren only in prose — no link, no title match. This is the case
  // that similarity over digests cannot reach.
  "people/tovin.md": "A dockhand. Owes money to Marren Koll and resents it.",
  "places/ivory-gate.md": "A gate of pale stone.",
  "sessions/01.md": "The party met Marren Koll. Marren Koll refused them twice.",
  "sessions/02.md": "They returned to the Ivory Gate. The Ledgerman was waiting.",
};

/** Subjects as the planner supplies them: an id and every name it answers to. */
const MARREN = { id: "people/marren.md", forms: ["marren koll", "the ledgerman"] };
const TOVIN = { id: "people/tovin.md", forms: ["tovin ashe"] };
const GATE = { id: "places/ivory-gate.md", forms: ["the ivory gate"] };

const surface = buildSurfaceIndex(units);
const index = buildMentionIndex(units, surface, id => bodies[id] ?? null);

describe("buildMentionIndex", () => {
  it("finds a subject named in prose by a unit about something else", () => {
    // The recall hole in similarity-only selection: a unit's digest describes
    // what the unit is about, so a passing mention of another subject leaves
    // no trace an embedding could match.
    const hits = unitsMentioning(index, [MARREN]).map(h => h.unitId);
    expect(hits).toContain("people/tovin.md");
  });

  it("counts repeated mentions so a discussion outranks a passing reference", () => {
    const hits = unitsMentioning(index, [MARREN]);
    expect(hits[0].unitId).toBe("sessions/01.md");
    expect(hits[0].count).toBe(2);
  });

  it("reaches a mention written as an alias, not just as the name", () => {
    // The subject is asked about by name; the corpus names it by epithet. A
    // lookup keyed on the asker's wording would miss this entirely.
    expect(unitsMentioning(index, [MARREN]).map(h => h.unitId)).toContain("sessions/02.md");
  });

  it("does not count a unit as mentioning itself", () => {
    // It is retrieved directly as the subject; counting it here would rank it
    // twice for the same reason.
    const hits = unitsMentioning(index, [MARREN]).map(h => h.unitId);
    expect(hits).not.toContain("people/marren.md");
  });

  it("leaves a name nobody wrote down with no postings", () => {
    expect(unitsMentioning(index, [TOVIN])).toEqual([]);
  });
});

describe("unitsMentioning — ranking", () => {
  it("puts units naming BOTH subjects first", () => {
    // For "how does A relate to B", a unit naming both once beats a unit
    // naming A twenty times: only the first can answer the question asked.
    const hits = unitsMentioning(index, [MARREN, GATE]);
    expect(hits[0].unitId).toBe("sessions/02.md");
    expect(hits[0].subjectsMatched).toBe(2);
  });

  it("honours an exclusion set so a tier does not repeat an earlier one", () => {
    const hits = unitsMentioning(index, [MARREN], new Set(["sessions/01.md"]));
    expect(hits.map(h => h.unitId)).not.toContain("sessions/01.md");
  });

  it("is deterministic for equal scores", () => {
    const a = unitsMentioning(index, [MARREN]).map(h => h.unitId);
    const b = unitsMentioning(index, [MARREN]).map(h => h.unitId);
    expect(a).toEqual(b);
  });
});

describe("DF_CAP — vocabulary, not names", () => {
  it("suppresses a form that turns out to be in almost every unit", () => {
    const many = Array.from({ length: 20 }, (_, i) => unit(`u${i}.md`, `Subject ${i}`));
    many.push(unit("noise.md", "Council"));
    const s = buildSurfaceIndex(many);
    const everywhere = buildMentionIndex(many, s, id =>
      id === "noise.md" ? "" : "the Council met again"
    );
    expect(everywhere.suppressed).toContain("council");
    expect(unitsMentioning(everywhere, [{ id: "noise.md", forms: ["council"] }])).toEqual([]);
  });

  it("keeps a genuinely central subject that is merely common", () => {
    // A central figure in a real campaign is named everywhere; treating that
    // as noise would gut retrieval for exactly the subjects people ask about.
    const many = Array.from({ length: 20 }, (_, i) => unit(`u${i}.md`, `Subject ${i}`));
    many.push(unit("central.md", "Marren Koll"));
    const s = buildSurfaceIndex(many);
    const below = Math.floor(20 * DF_CAP) - 1;
    const idx = buildMentionIndex(many, s, id => {
      const n = Number(id.replace(/\D/g, ""));
      return id.startsWith("u") && n < below ? "Marren Koll was there" : "nothing relevant";
    });
    expect(idx.suppressed).not.toContain("marren koll");
    expect(unitsMentioning(idx, [{ id: "central.md", forms: ["marren koll"] }]).length).toBe(below);
  });

  it("does not suppress anything in a corpus too small to judge", () => {
    const tiny = [unit("a.md", "Marren Koll"), unit("b.md", "Other")];
    const s = buildSurfaceIndex(tiny);
    const idx = buildMentionIndex(tiny, s, () => "Marren Koll everywhere");
    expect(idx.suppressed).toEqual([]);
  });
});

describe("serialisation", () => {
  it("round-trips, because rebuilding postings is the expensive part", () => {
    const back = deserialiseMentionIndex(JSON.parse(JSON.stringify(serialiseMentionIndex(index))));
    expect(back).not.toBeNull();
    expect(unitsMentioning(back!, [MARREN])).toEqual(unitsMentioning(index, [MARREN]));
  });

  it("refuses an index written by a different version", () => {
    const stale = { ...(serialiseMentionIndex(index) as object), version: 999 };
    expect(deserialiseMentionIndex(stale)).toBeNull();
  });

  it("refuses malformed input rather than throwing", () => {
    expect(deserialiseMentionIndex(null)).toBeNull();
    expect(deserialiseMentionIndex({ version: 1 })).toBeNull();
  });
});
