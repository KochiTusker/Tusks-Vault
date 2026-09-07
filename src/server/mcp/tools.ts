// The three tools the MCP endpoint exposes, and nothing else.
//
// The temptation is to mirror the REST API here, one tool per route. Resist it:
// a tool surface that grows to cover the whole dashboard stops being a lore
// interface and becomes a second, worse dashboard — one with no UI, no
// versioning story, and a much larger blast radius.
//
// Three is the whole set:
//
//   ask_lore      a question in, a cited answer out. What Foundry calls.
//   search_lore   retrieval WITHOUT generation — which documents match and why.
//                 Cheap, and the one an agent actually wants when it intends to
//                 read for itself rather than be told.
//   list_sources  what the corpus contains.
//
// Callers are not equal. The `client` on the context was fixed at pairing and
// decides which surface policy applies; nothing here reads a surface out of the
// request payload.

import { ask } from "../chat/ask";
import { getSettings } from "../config/settings";
import { getKnowledgeBundle, listKnowledgeFiles, activeVaultPath } from "../knowledge/loader";
import { splitDocuments } from "../knowledge/corpus-stats";
import { getRelevantClarifications } from "../clarifications/retrieve";
import { retrievalOpts } from "../prompt/assemble";
import type { PairedClient } from "./auth";

export interface ToolContext {
  client: PairedClient;
}

/** MCP tool result. `isError` reports a failure the CALLER should see and
 *  reason about — a refused question, a broken key — as distinct from a
 *  protocol error, which is a JSON-RPC error and never reaches a model. */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

function text(body: string, extra?: Partial<ToolResult>): ToolResult {
  return { content: [{ type: "text", text: body }], ...extra };
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

/** Trim a string argument to something a prompt can survive. An MCP client is
 *  not a form, so nothing upstream has already bounded these. */
function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? Math.trunc(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Who is asking, as far as Vault can tell.
 *
 * `isGM` is a CLAIM. Vault has no channel to Foundry other than the module, so
 * it cannot independently verify authorship — the module derives it from the
 * ChatMessage document author, which Foundry's server sets, but by the time it
 * reaches here it is just a boolean in a payload. `allowPlayers` below is the
 * ceiling that makes forging it worthless.
 */
function parseAsker(value: unknown): { id: string; displayName: string; isGM?: boolean } {
  const raw = (value ?? {}) as Record<string, unknown>;
  const isGM = typeof raw.isGM === "boolean" ? raw.isGM : undefined;
  return {
    id: str(raw.id, 64) || "unknown",
    displayName: str(raw.displayName, 64) || "Unknown",
    isGM,
  };
}

/**
 * The `allowPlayers` ceiling.
 *
 * Deliberately NOT a copy of the module's tri-state access mode. Two copies of
 * one setting is the classic "why isn't my setting working" trap, and the
 * module is the only place that can answer "who may ask at this table" anyway.
 * This asks a different question — may this INSTALL answer non-GMs at all — and
 * it covers the exact residual risk in `isGM` being a claim: forging GM
 * authorship gets a player nothing they could not already get by asking
 * normally, unless the install has opted in.
 *
 * Applied by ALL THREE tools, which it was not. It sat only in ask_lore, so a
 * `foundry` credential could still call search_lore — which returns matching
 * DM clarifications, the GM's own answers to lore gaps — and list_sources,
 * which returns the document list. The ceiling is a property of the
 * credential and its surface, so a check living in one handler is a ceiling
 * with two doors around it. ask_lore passes the asker's GM claim; the other
 * two have no asker to exempt and pass `undefined`.
 */
function playerCeilingBlocks(ctx: ToolContext, isGM: boolean | undefined): boolean {
  if (ctx.client.surface !== "foundry") return false;
  if (isGM === true) return false;
  return getSettings().surfaces?.foundry?.allowPlayers !== true;
}

const PLAYER_REFUSAL =
  "The archivist answers only the GM at this table. " +
  "The GM can allow player questions in Tusk's Vault, under Surfaces → Foundry.";

const askLore: ToolDefinition = {
  name: "ask_lore",
  title: "Ask the archive",
  description:
    "Ask a question about the campaign and get an answer grounded in the loaded lore, " +
    "with citations to the source documents. Use this when you want an answer; use " +
    "search_lore when you would rather read the sources yourself.",
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question to answer, in plain language.",
      },
      asker: {
        type: "object",
        description:
          "Who is asking. Supplied by chat surfaces so the answer can be attributed and " +
          "rate-limited per person.",
        properties: {
          id: { type: "string", description: "Stable per-surface user id." },
          displayName: { type: "string" },
          isGM: {
            type: "boolean",
            description: "True when the asker runs the table. Governs the player ceiling.",
          },
        },
      },
    },
    required: ["question"],
  },
  async handler(args, ctx) {
    const question = str(args.question, 4000);
    if (!question) return text("Ask me something about the chronicle.", { isError: true });

    const asker = parseAsker(args.asker);
    if (playerCeilingBlocks(ctx, asker.isGM)) {
      // Not an isError: the refusal IS the answer, and the surface should post
      // it as prose rather than as a broken-tool notice.
      return text(PLAYER_REFUSAL, { _meta: { "tusks-vault": { refusedBy: "allowPlayers" } } });
    }

    const result = await ask({
      text: question,
      asker,
      surface: ctx.client.surface,
    });

    if (!result.answered) {
      // `paused` and `disabled` are the user's own choices and say so plainly.
      // `empty` is a failure, and silence there is indistinguishable from the
      // bot ignoring the table.
      const why =
        result.skipped === "paused"
          ? "Tusk's Vault is paused right now."
          : result.skipped === "disabled"
            ? "This surface is switched off in Tusk's Vault."
            : result.skipped === "cooldown"
              ? `That was quick — give the archivist ${Math.ceil((result.retryInMs ?? 0) / 1000)}s.`
              : "The model returned nothing. The question may have been blocked, or the provider failed.";
      return text(why, {
        isError: result.skipped === "empty",
        _meta: { "tusks-vault": { skipped: result.skipped } },
      });
    }

    return text(result.text!, {
      _meta: {
        "tusks-vault": {
          modelUsed: result.modelUsed,
          costUsd: result.costUsd,
          loreGapRecorded: result.loreGapRecorded,
          declined: result.declined,
          declineKind: result.declineKind,
        },
      },
    });
  },
};

const searchLore: ToolDefinition = {
  name: "search_lore",
  title: "Search the archive",
  description:
    "Find which lore documents and DM clarifications match a query, without generating an " +
    "answer. Returns document names and matching clarifications so a caller can decide what " +
    "to read. Costs no model tokens.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to look for." },
      limit: {
        type: "integer",
        description: "Maximum clarifications to return (1-25, default 5).",
        minimum: 1,
        maximum: 25,
      },
    },
    required: ["query"],
  },
  async handler(args, ctx) {
    const query = str(args.query, 2000);
    if (!query) return text("Give me something to search for.", { isError: true });

    // The same ceiling ask_lore applies. This tool carries no `asker`, so
    // there is no GM claim to exempt and the ceiling decides alone.
    //
    // It was missing, and the omission mattered more here than the tool's
    // "costs no model tokens" framing suggests: the reply lists matching DM
    // CLARIFICATIONS — the GM's own written answers to lore gaps — which is
    // precisely the material allowPlayers:false exists to withhold. A
    // credential paired as `foundry` could read them while ask_lore refused
    // the same question.
    if (playerCeilingBlocks(ctx, undefined)) {
      return text(PLAYER_REFUSAL, { _meta: { "tusks-vault": { refusedBy: "allowPlayers" } } });
    }

    // Runs the REAL selection rather than a parallel one: whatever this reports
    // as matching is what a question would actually have been answered from.
    // A second, approximate matcher here would drift from the pipeline and
    // quietly start lying about what the model saw.
    const bundle = await getKnowledgeBundle(query);
    const selected = splitDocuments(bundle.perQuery || bundle.stable).map(d => d.name);

    const settings = getSettings();
    const matches = await getRelevantClarifications(query, {
      ...retrievalOpts(settings),
      topK: int(args.limit, 5, 1, 25),
    });

    const lines: string[] = [];
    lines.push(
      `Mode: ${bundle.meta.mode} — ${bundle.meta.notesIncluded} of ${bundle.meta.notesTotal} ` +
        `document(s) selected for this query.`
    );
    if (bundle.meta.fellBackBecause) {
      lines.push(`(Mapped selection unavailable: ${bundle.meta.fellBackBecause})`);
    }
    lines.push("");
    lines.push(selected.length ? "Documents:" : "Documents: none matched.");
    for (const name of selected) lines.push(`  - ${name}`);

    if (matches.length) {
      lines.push("");
      lines.push("DM clarifications:");
      for (const m of matches) {
        lines.push(`  - [clarification: ${m.clarification.id}] (score ${m.score.toFixed(3)})`);
        lines.push(`    ${str(m.clarification.answer, 300)}`);
      }
    }

    return text(lines.join("\n"), {
      _meta: {
        "tusks-vault": {
          surface: ctx.client.surface,
          mode: bundle.meta.mode,
          documents: selected,
          clarificationIds: matches.map(m => m.clarification.id),
        },
      },
    });
  },
};

const listSources: ToolDefinition = {
  name: "list_sources",
  title: "List lore sources",
  description:
    "Describe the corpus: which lore source is active and which documents it contains. " +
    "Use this to find out what the archive can answer about before asking.",
  inputSchema: { type: "object", properties: {} },
  async handler(_args, ctx) {
    // Ceiling first: the document list describes the campaign, and a table
    // that has not opted into answering players has not opted into telling
    // them what the archive holds either.
    if (playerCeilingBlocks(ctx, undefined)) {
      return text(PLAYER_REFUSAL, { _meta: { "tusks-vault": { refusedBy: "allowPlayers" } } });
    }

    const settings = getSettings();
    const vault = activeVaultPath();
    const source = vault ? "obsidian" : settings.loreSource || "folder";

    // Names only. The absolute path of the vault is deliberately NOT reported:
    // a paired client is trusted to read the lore, not to learn the shape of
    // the GM's filesystem.
    const names = vault
      ? splitDocuments((await getKnowledgeBundle()).stable).map(d => d.name)
      : listKnowledgeFiles().filter(f => f.indexed).map(f => f.name);

    const lines = [
      `Lore source: ${source}`,
      `Documents: ${names.length}`,
      "",
      ...names.map(n => `  - ${n}`),
    ];
    return text(lines.join("\n"), {
      _meta: { "tusks-vault": { source, documents: names } },
    });
  },
};

export const TOOLS: ToolDefinition[] = [askLore, searchLore, listSources];

export function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find(t => t.name === name);
}

/** The `tools/list` payload — the definitions minus their handlers. */
export function toolListing(): Array<Omit<ToolDefinition, "handler">> {
  return TOOLS.map(({ handler: _handler, ...rest }) => rest);
}
