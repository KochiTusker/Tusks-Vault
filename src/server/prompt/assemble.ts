import { getKnowledgeBundle } from "../knowledge/loader";
import { getRelevantClarifications } from "../clarifications/retrieve";
import { CANONICAL_RULES_BLOCK, ENGAGEMENT_CLAUSE, PERSONA_VOICE_CLOSURE, hasCanonicalRules } from "./system";
import type { ContentPart } from "../llm/types";
import type { Settings } from "../config/settings";

// The corpus cap now lives in knowledge/loader.ts, which applies it at a
// document boundary and reports what was omitted. Slicing again here would
// re-introduce the mid-sentence cut this was moved to avoid.

export interface AssembleOpts {
  topK?: number;
  threshold?: number;
  // When true, the INSTRUCTIONS block in the user prompt gets a final
  // voice-continuity reminder. Set by the Discord handler whenever a
  // non-default persona is active. Belt-and-braces with the system-prompt
  // closure in buildSystemInstruction — Flash-class models drift between
  // the two anchor points, so we reassert at both.
  personaActive?: boolean;
}

// Stage 3: only inject clarifications that semantically match the query. The
// model still sees the full knowledge base; clarifications are pre-filtered so
// even a hundreds-of-rows clarification table doesn't blow the context budget.
export async function assemblePromptParts(
  userPrompt: string,
  opts: AssembleOpts = {}
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];

  console.log("DEBUG: Compiling Knowledge Base...");
  const knowledge = await getKnowledgeBundle(userPrompt);
  console.log(
    `DEBUG: KB mode=${knowledge.meta.mode} notes=${knowledge.meta.notesIncluded}/${knowledge.meta.notesTotal}` +
      (knowledge.meta.fellBackBecause ? ` (fell back: ${knowledge.meta.fellBackBecause})` : "")
  );
  const matches = await getRelevantClarifications(userPrompt, opts);
  console.log(`DEBUG: Retrieved ${matches.length} relevant clarification(s).`);
  for (const m of matches) {
    console.log(`DEBUG:   - [clarification: ${m.clarification.id}] score=${m.score.toFixed(3)}`);
  }

  // The knowledge base is its own part, marked cacheable: its bytes are
  // stable between consecutive questions (they change only when a lore file
  // changes), so a caching adapter can put its prompt-cache breakpoint here
  // and re-bill only the clarifications + query on each call. The retrieved
  // clarifications vary per query and must stay OUTSIDE the cacheable part —
  // folding them in would invalidate the cache on every question. Adapters
  // concatenate text parts in order, so the model sees the same prompt as
  // when this was one combined block.
  let kbText = "### GLOBAL KNOWLEDGE BASE\n\n";
  if (knowledge.stable) {
    kbText += knowledge.stable;
  } else {
    kbText += "(Knowledge base is currently empty.)\n";
  }
  parts.push({ type: "text", text: kbText, cacheable: true });

  // The per-question half of a mapped vault read: the notes this question
  // selected, in full. Deliberately OUTSIDE the cacheable part — it changes
  // every question, and folding it in would invalidate the cached map and
  // re-bill the whole vault on each call.
  if (knowledge.perQuery) {
    parts.push({ type: "text", text: knowledge.perQuery });
  }

  if (matches.length > 0) {
    parts.push({
      type: "text",
      text:
        "\n\n### RELEVANT DM CLARIFICATIONS\n\n" +
        "These are DM clarifications retrieved by semantic similarity to the user's query. " +
        "Some may be tangentially related rather than directly applicable — judge each on its merits. " +
        "Where a clarification directly answers the user's question, treat it as canonical and prefer " +
        "it over the knowledge base. Ignore clarifications that are not actually relevant.\n\n" +
        matches
          .map(
            m =>
              `[clarification: ${m.clarification.id}] (relevance ${m.score.toFixed(2)})\n` +
              `Q: ${m.clarification.question}\nA: ${m.clarification.answer}`
          )
          .join("\n\n") +
        "\n",
    });
  }
  const personaReminder = opts.personaActive
    ? ` Respond in your persona's voice — vocabulary, mannerisms, and register — consistently from the first word to the last.`
    : ``;

  parts.push({
    type: "text",
    text:
      `### USER QUERY\n\n${userPrompt}\n\n### INSTRUCTIONS\n\n` +
      `Answer using the GLOBAL KNOWLEDGE BASE and RELEVANT DM CLARIFICATIONS above. ` +
      `End every factual claim with a citation marker: \`[filename]\` for knowledge-base facts ` +
      `or \`[clarification: ID]\` for clarification facts. ` +
      `If the answer is not present in either source, emit this exact phrase verbatim: ` +
      `"I am unsure about this detail. I have recorded this as a lore gap for the DM to clarify."` +
      personaReminder,
  });

  return parts;
}

export interface SystemInstructionOpts {
  speculativeMode?: boolean;
  speculativeOverride?: string;
  botName?: string;
  // Active-guardrails block built from settings.guardrails by the Discord
  // handler. Empty string when every category is off. Always appended last
  // so it overrides any "consented fiction" framing earlier in the prompt.
  guardrailsNudge?: string;
  /** Overrides the standing ENGAGEMENT clause. Pass "" to omit it entirely —
   *  the maturity harness does, so it measures the model rather than the
   *  clause. Undefined means the default, which is what every real call
   *  wants. */
  engagementClause?: string;
  // When true, a final VOICE CONTINUITY block is appended after the
  // canonical rules. Set by the Discord handler when a user-selected
  // persona is active. Counter-acts Flash-class voice drift driven by
  // the formal-register canonical block landing late in the prompt.
  personaActive?: boolean;
}

// Compose the final system instruction. The bot's name is patched into the
// stored base instruction so the user can rename it without re-editing the
// system prompt textarea. Mode overrides are appended.
export function buildSystemInstruction(base: string, opts: SystemInstructionOpts = {}): string {
  let out = base;
  if (opts.botName) {
    // Substitute the {{BOT_NAME}} placeholder if the base is a template; if
    // the user has hand-edited the prompt and removed the placeholder, prepend
    // a clear "Your name is X" line so the LLM still knows what to call itself.
    if (out.includes("{{BOT_NAME}}")) {
      out = out.replace(/{{BOT_NAME}}/g, opts.botName);
    } else if (!out.toLowerCase().includes(opts.botName.toLowerCase())) {
      out = `Your name is ${opts.botName}. Identify as ${opts.botName} when asked.\n\n${out}`;
    }
  }
  if (opts.speculativeMode && opts.speculativeOverride) out += opts.speculativeOverride;
  // Unconditional, and appended through an opt so a caller building a prompt
  // for measurement can leave it out and grade the base behaviour. Its own
  // doc comment explains why it is not gated on the guardrail flags: it used
  // to be, which made the permissive setting the least engaged one.
  out += opts.engagementClause ?? ENGAGEMENT_CLAUSE;
  // Guardrails appended last so they override any consented-fiction framing
  // earlier in the prompt. Empty string is a no-op so today's behaviour is
  // unchanged when every category is off.
  if (opts.guardrailsNudge) out += opts.guardrailsNudge;
  // Defense in depth against persona-prompt drift. If the active persona
  // (user-authored or hand-edited preset) doesn't contain all seven core
  // rules, append a canonical enforcement block so citation discipline,
  // lore-gap behaviour, and the no-invention contract hold regardless of
  // what the base prompt says. Presets all include the rules — this only
  // appends for prompts that lost them.
  if (!hasCanonicalRules(out)) {
    out += `\n\n${CANONICAL_RULES_BLOCK}`;
  }
  // Persona-voice closure goes LAST so the model's most-recent instruction
  // — and therefore the strongest behavioural pull on Flash-class models —
  // is "stay in voice" rather than the formal archival register of the
  // canonical rules block. Only emitted when a persona is active; for the
  // default Chronicler this would be redundant with Rule 6 (TONE).
  if (opts.personaActive) {
    out += `\n\n${PERSONA_VOICE_CLOSURE}`;
  }
  return out;
}

export function retrievalOpts(settings: Settings): AssembleOpts {
  return {
    topK: settings.clarificationTopK,
    threshold: settings.clarificationThreshold,
  };
}
