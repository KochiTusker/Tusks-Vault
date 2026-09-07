import fs from "fs";
import { EMBEDDINGS_PATH } from "../config/paths";
import { EMBEDDING_DIM, EMBEDDING_MODEL } from "./index";

const VERSION = 1;

interface CacheFile {
  version: number;
  model: string;
  dim: number;
  entries: Record<string, string>; // clarification id → base64-encoded Float32 bytes
}

let inMemory: CacheFile | null = null;

function load(): CacheFile {
  if (inMemory) return inMemory;
  try {
    if (fs.existsSync(EMBEDDINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, "utf-8")) as CacheFile;
      if (raw.version === VERSION && raw.model === EMBEDDING_MODEL && raw.dim === EMBEDDING_DIM) {
        inMemory = raw;
        return inMemory;
      }
      console.warn("[embeddings] cache version/model mismatch; rebuilding next time clarifications save");
    }
  } catch (err) {
    console.error("[embeddings] cache read error:", err);
  }
  inMemory = { version: VERSION, model: EMBEDDING_MODEL, dim: EMBEDDING_DIM, entries: {} };
  return inMemory;
}

function persist(): void {
  if (!inMemory) return;
  fs.writeFileSync(EMBEDDINGS_PATH, JSON.stringify(inMemory, null, 2));
}

export function getCachedEmbedding(id: string): Float32Array | null {
  const cache = load();
  const b64 = cache.entries[id];
  if (!b64) return null;
  const buf = Buffer.from(b64, "base64");
  // Copy into a fresh Float32Array so the caller can't mutate the cache view.
  const f = new Float32Array(buf.byteLength / 4);
  new Uint8Array(f.buffer).set(buf);
  return f;
}

export function setCachedEmbedding(id: string, emb: Float32Array): void {
  const cache = load();
  cache.entries[id] = Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength).toString("base64");
  persist();
}

export function removeCachedEmbedding(id: string): void {
  const cache = load();
  if (id in cache.entries) {
    delete cache.entries[id];
    persist();
  }
}

export function listCachedIds(): Set<string> {
  return new Set(Object.keys(load().entries));
}
