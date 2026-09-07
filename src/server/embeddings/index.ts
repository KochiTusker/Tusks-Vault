import { pipeline, env } from "@huggingface/transformers";
import fs from "fs";
import { MODELS_CACHE_DIR } from "../config/paths";

// Local model cache lives inside the repo (models/ is gitignored). Keeps the
// user's ~/.cache clean and makes "delete the install" a single-folder action.
if (!fs.existsSync(MODELS_CACHE_DIR)) fs.mkdirSync(MODELS_CACHE_DIR, { recursive: true });
env.cacheDir = MODELS_CACHE_DIR;
env.allowLocalModels = true;
env.allowRemoteModels = true;
// `useBrowserCache` only matters in browser builds; harmless to set false here.
(env as any).useBrowserCache = false;

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384;

let extractorPromise: Promise<any> | null = null;

async function getExtractor(): Promise<any> {
  if (!extractorPromise) {
    console.log(`[embeddings] Loading ${EMBEDDING_MODEL} (first call may download ~25 MB)...`);
    extractorPromise = pipeline("feature-extraction", EMBEDDING_MODEL).then(p => {
      console.log("[embeddings] Model ready");
      return p;
    });
  }
  return extractorPromise;
}

export async function embed(text: string): Promise<Float32Array> {
  if (!text || !text.trim()) throw new Error("embed(): empty input");
  const extractor = await getExtractor();
  const out = await extractor(text, { pooling: "mean", normalize: true });
  // `out.data` is a TypedArray (Float32Array). Copy so consumers can't mutate
  // the pipeline's internal buffer.
  return new Float32Array(out.data as Float32Array);
}

// Fire-and-forget warmup at server boot. The first real `embed()` call still
// awaits the same promise so there's no race; this just pulls the cold-start
// cost forward so the first Discord message isn't ~3-5 s slower.
export function warmupEmbeddings(): void {
  void getExtractor().catch(err => {
    console.error("[embeddings] Failed to load model:", err);
  });
}
