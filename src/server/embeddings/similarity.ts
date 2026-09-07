// MiniLM with normalize:true outputs unit vectors, so cosine = dot product.
// The full formula is kept here so the helper works correctly even if a caller
// passes unnormalised vectors (e.g. a different embedding model).
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export interface Scored<T> {
  item: T;
  score: number;
}

export function topK<T>(
  query: Float32Array,
  candidates: Array<{ emb: Float32Array; item: T }>,
  k: number,
  threshold: number
): Scored<T>[] {
  return candidates
    .map(c => ({ item: c.item, score: cosine(query, c.emb) }))
    .filter(s => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
