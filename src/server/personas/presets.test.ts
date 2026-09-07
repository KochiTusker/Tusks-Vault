import { describe, expect, it } from "vitest";
import { PERSONA_PRESETS, getPresetById } from "./presets";

/**
 * The presets are prompts, so most of what matters about them cannot be
 * asserted — whether a voice actually lands is a reading, not a test. What CAN
 * be asserted is the part every preset has to keep no matter how it sounds:
 * the citation discipline, and the fact that a persona replaces the base
 * prompt rather than composing with it.
 */
describe("persona presets", () => {
  it("gives every preset a unique id and a description", () => {
    const ids = PERSONA_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PERSONA_PRESETS) {
      expect(p.name.trim().length).toBeGreaterThan(0);
      expect(p.description.trim().length).toBeGreaterThan(0);
      expect(p.prompt.length).toBeGreaterThan(200);
    }
  });

  it("names no real person and no licensed character, in any preset", () => {
    // This repo is MIT-licensed and indexed, so a preset is redistributed
    // wherever it is forked. Five of these shipped as named impressions — a
    // living actor with one of his film lines quoted, two television
    // characters, a film wizard whose prompt reproduced a line of Tolkien
    // verbatim, and a film sidekick. They are archetypes now.
    //
    // The list below is the specific set that was here, not a general filter:
    // it exists so a well-meaning "let's bring back the fun ones" edit fails
    // loudly rather than quietly restoring the problem. If you add a preset,
    // the rule is the archetype, not this list.
    const named = [
      /schwarzenegger/i,
      /\bhomer\b/i,
      /simpson/i,
      /griffin/i,
      /gandalf/i,
      /shrek/i,
      /\bdonkey\b/i,
      /middle-earth/i,
      /come with me if you want to live/i,
      /a wizard is never late/i,
    ];
    for (const p of PERSONA_PRESETS) {
      for (const pattern of named) {
        expect(
          `${p.id} ${p.name} ${p.description} ${p.prompt}`,
          `preset "${p.id}" names something it must not`
        ).not.toMatch(pattern);
      }
    }
  });

  it("carries the citation rule into every voice, however silly", () => {
    // A persona replaces the base prompt outright, so a preset that forgot the
    // rules would produce an archivist that invents — the one failure this
    // project exists to prevent.
    for (const p of PERSONA_PRESETS) {
      expect(p.prompt).toContain("CORE RULES");
      expect(p.prompt).toMatch(/citation marker/i);
      expect(p.prompt).toMatch(/I am unsure about this detail/);
    }
  });

  it("carries the fiction framing into every voice", async () => {
    // A persona REPLACES the base prompt, so it inherits nothing by default.
    // Without this block a voice gets rule 2's "recount it faithfully" and
    // none of the context explaining why that is correct — and the personas
    // with an edge are exactly the ones a model talks itself out of. Shared
    // constant rather than a copy per preset, so there is one wording to keep
    // true rather than eight.
    const { MATERIAL_CONTEXT } = await import("../prompt/system");
    for (const p of PERSONA_PRESETS) {
      expect(p.prompt).toContain(MATERIAL_CONTEXT);
    }
  });

  it("states the ceiling as the chronicle's own content, in both directions", async () => {
    // The clause that keeps this context rather than a permission slip. It
    // bounds the model in BOTH directions — no sanitising, and no escalating
    // past what the author wrote — and rules 2 and 3 enforce the same bound
    // from the other side. Losing the second half would turn a description of
    // the material into an invitation.
    const { MATERIAL_CONTEXT } = await import("../prompt/system");
    expect(MATERIAL_CONTEXT).toMatch(/never less than that, and never more/i);
    expect(MATERIAL_CONTEXT).toMatch(/already written/i);
  });

  it("keeps the bot-name placeholder so a renamed bot stays renamed", () => {
    for (const p of PERSONA_PRESETS) {
      expect(p.prompt).toContain("{{BOT_NAME}}");
    }
  });
});

/**
 * Brainrot was a global boolean that appended an override to whichever prompt
 * was active. As a toggle it composed with every other persona and produced
 * combinations nobody designed — a solemn wizard voice with the slang bolted
 * on. It is a VOICE, so it is a persona, and personas are mutually exclusive
 * by construction.
 */
describe("the brainrot persona", () => {
  const brainrot = getPresetById("brainrot");

  it("exists as a preset, and the old toggle's constant does not", async () => {
    expect(brainrot).toBeDefined();
    const system = await import("../prompt/system");
    expect("BRAINROT_OVERRIDE" in system).toBe(false);
  });

  it("holds the citation rules like any other voice", () => {
    expect(brainrot!.prompt).toContain("CORE RULES");
    expect(brainrot!.prompt).toMatch(/citation/i);
  });

  it("tells the model to drop the comedy when the material is grim", () => {
    // The toggle had no such instruction, which is how a bit intended for
    // tavern banter ended up applied to a character's death.
    expect(brainrot!.prompt).toMatch(/grief|violence|horror|heavy|serious/i);
  });

  it("does not demand a fixed list of slang terms", () => {
    // The override named specific words and required their use, which read as
    // a word-search rather than a voice. Register first; vocabulary follows.
    expect(brainrot!.prompt).not.toMatch(/skibidi|gyatt|fanum tax|mewing/i);
  });
});

/**
 * The unfiltered preset. Its whole reason to exist is that it is ruder than
 * the others, so the assertions here are about the two boundaries that make
 * that shippable rather than about the rudeness itself.
 */
describe("the sellsword persona", () => {
  const sellsword = getPresetById("sellsword");

  it("exists", () => {
    expect(sellsword).toBeDefined();
  });

  it("aims the insults at the chronicle, not at the table", () => {
    // The load-bearing line. On Discord or in a Foundry chat log the reply is
    // read by everyone present, so "rude about a character" and "rude about
    // the person asking" are not close to the same thing.
    expect(sellsword!.prompt).toMatch(/never about the person asking/i);
    expect(sellsword!.prompt).toMatch(/no slurs/i);
  });

  it("still drops the comedy when the material is grim", () => {
    expect(sellsword!.prompt).toMatch(/grief|violence|horror/i);
  });

  it("keeps the citation discipline every other voice keeps", () => {
    expect(sellsword!.prompt).toContain("CORE RULES");
    expect(sellsword!.prompt).toMatch(/citations are non-negotiable/i);
  });
});
