import fs from "fs";
import { CLARIFICATIONS_PATH } from "../config/paths";
import { embed } from "../embeddings/index";
import { setCachedEmbedding, removeCachedEmbedding, listCachedIds } from "../embeddings/cache";

export interface Clarification {
  id: string;
  question: string;
  answer: string;
  timestamp: string;
}

export function getClarifications(): Clarification[] {
  try {
    if (fs.existsSync(CLARIFICATIONS_PATH)) {
      return JSON.parse(fs.readFileSync(CLARIFICATIONS_PATH, "utf-8"));
    }
  } catch (err) {
    console.error("Error reading clarifications:", err);
  }
  return [];
}

export function saveClarifications(clarifications: Clarification[]): void {
  fs.writeFileSync(CLARIFICATIONS_PATH, JSON.stringify(clarifications, null, 2));
}

// Async so we can wait for the embedding before responding to the route — the
// UI then shows "Embedded" on the new row immediately. Embedding failures are
// logged but don't break the save (the user keeps their data; the row just
// won't match semantically until a backfill runs).
export async function upsertClarification(
  input: { id?: string; question: string; answer: string }
): Promise<Clarification> {
  const clarifications = getClarifications();
  let saved: Clarification;

  if (input.id) {
    const index = clarifications.findIndex(c => c.id === input.id);
    if (index !== -1) {
      clarifications[index] = { ...clarifications[index], question: input.question, answer: input.answer };
      saved = clarifications[index];
    } else {
      saved = {
        id: input.id,
        question: input.question,
        answer: input.answer,
        timestamp: new Date().toISOString(),
      };
      clarifications.push(saved);
    }
  } else {
    saved = {
      id: Date.now().toString(),
      question: input.question,
      answer: input.answer,
      timestamp: new Date().toISOString(),
    };
    clarifications.push(saved);
  }

  saveClarifications(clarifications);

  try {
    // Embed question AND answer together so retrieval matches when the user's
    // query phrasing is closer to a clarification's answer than its question.
    // (Common for FAQ-style stores: stored Qs are terse, answers carry the
    // semantic content that matches paraphrased queries.)
    const emb = await embed(embeddingText(saved));
    setCachedEmbedding(saved.id, emb);
  } catch (err) {
    console.warn(`[clarifications] embedding failed for ${saved.id}:`, err);
  }

  return saved;
}

export function embeddingText(c: { question: string; answer: string }): string {
  return `${c.question}\n${c.answer}`;
}

export function deleteClarification(id: string): void {
  const filtered = getClarifications().filter(c => c.id !== id);
  saveClarifications(filtered);
  removeCachedEmbedding(id);
}

export function hasEmbedding(id: string): boolean {
  return listCachedIds().has(id);
}
