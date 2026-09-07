// The shape of a question and an answer, with no idea where either came from.
//
// Vault answered in exactly one place for its whole life, so the answering
// logic grew inside the Discord message handler. "Answer somewhere else" was
// therefore a rewrite rather than a setting. These types are the seam that
// makes the place a property.

import type { ContentPart } from "../llm/types";
import type { RefusalKind } from "../llm/refusal";

/** Where a question arrived from. Recorded on the question so the access
 *  ceiling, the queue, and the logs can all reason about it. */
export type SurfaceId = "discord" | "foundry" | "mcp";

export interface Asker {
  /** Stable per-surface id — a Discord snowflake, a Foundry user id. Used for
   *  rate limiting, so it must identify a person rather than a request. */
  id: string;
  displayName: string;
  /** Foundry's notion of a GM. Undefined on surfaces where it means nothing;
   *  a surface that cannot establish this must leave it undefined rather than
   *  guessing, because `false` and "unknown" get treated differently. */
  isGM?: boolean;
}

export interface Question {
  text: string;
  /** Pre-parsed attachments. Discord supplies these; Foundry chat has no
   *  attachment concept, so it does not. */
  parts?: ContentPart[];
  asker: Asker;
  surface: SurfaceId;
}

/**
 * Deliberately flat, not a discriminated union.
 *
 * This repo compiles with `strictNullChecks` off, so a union like
 * `{ answered: true; text: string } | { answered: false }` does NOT narrow —
 * TypeScript will happily let you read `.text` on the false branch and it will
 * be undefined at runtime. A flat shape with optional fields is honest about
 * that instead of pretending to a safety the compiler is not providing.
 */
export interface AskResult {
  /** True when there is something to say. */
  answered: boolean;
  /** Why there is nothing to say. Only set when `answered` is false.
   *
   *  - `paused`   — the global kill switch is on. Say nothing at all.
   *  - `disabled` — this surface is switched off. Say nothing at all.
   *  - `cooldown` — this person asked again too soon. Temporary and
   *                 self-resolving, so `retryInMs` says how soon it lifts.
   *  - `empty`    — the model returned nothing. The surface SHOULD tell the
   *                 user, because silence here looks like the bot ignoring
   *                 them, which is a different and more alarming failure. */
  skipped?: "paused" | "disabled" | "cooldown" | "empty";
  /** How long until a `cooldown` skip lifts. Only set for that skip. */
  retryInMs?: number;
  /** Citation-stripped per settings.includeReferences, ready to display. */
  text?: string;
  modelUsed?: string;
  costUsd?: number;
  /** True when the answer tripped the lore-gap phrase and a gap was recorded. */
  loreGapRecorded?: boolean;
  /** True when the model declined the question rather than answering it.
   *
   *  `text` is still populated — the model's own decline, which explains
   *  itself and usually offers a rephrase, is the most useful thing to show.
   *  This flag exists so a surface can mark it AS a decline instead of
   *  letting it read as chronicle content, and so it is never mistaken for a
   *  lore gap: a refusal says nothing about the archive being incomplete. */
  declined?: boolean;
  /** What the model objected to, when it said: the question's wording, the
   *  subject matter, or unstated. */
  declineKind?: RefusalKind;
}
