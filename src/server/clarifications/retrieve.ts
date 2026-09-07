import { embed } from "../embeddings/index";
import { getCachedEmbedding, listCachedIds, setCachedEmbedding } from "../embeddings/cache";
import { topK } from "../embeddings/similarity";
import { getClarifications, Clarification, embeddingText } from "./store";

export interface ClarificationMatch {
  clarification: Clarification;
  score: number;
}

export async function getRelevantClarifications(
  query: string,
  opts: { topK?: number; threshold?: number } = {}
): Promise<ClarificationMatch[]> {
  const k = opts.topK ?? 5;
  const threshold = opts.threshold ?? 0.40;

  const clarifications = getClarifications();
  if (clarifications.length === 0) return [];
  if (!query || !query.trim()) return [];

  const queryEmb = await embed(query);

  const candidates: Array<{ emb: Float32Array; item: Clarification }> = [];
  for (const c of clarifications) {
    const emb = getCachedEmbedding(c.id);
    if (emb) candidates.push({ emb, item: c });
  }

  const matches = topK(queryEmb, candidates, k, threshold);
  return matches.map(m => ({ clarification: m.item, score: m.score }));
}

// One-shot backfill: ensure every stored clarification has an embedding. Handy
// after upgrading from a pre-Stage-3 install or after deleting the embeddings
// cache file. Runs once on server boot via index.ts.
export async function backfillClarificationEmbeddings(): Promise<void> {
  const clarifications = getClarifications();
  if (clarifications.length === 0) return;

  const cachedIds = listCachedIds();
  const missing = clarifications.filter(c => !cachedIds.has(c.id));
  if (missing.length === 0) return;

  console.log(`[embeddings] Backfilling ${missing.length} clarification(s)...`);
  for (const c of missing) {
    try {
      const emb = await embed(embeddingText(c));
      setCachedEmbedding(c.id, emb);
    } catch (err) {
      console.warn(`[embeddings] Failed to embed clarification ${c.id}:`, err);
    }
  }
  console.log("[embeddings] Backfill complete");
}
