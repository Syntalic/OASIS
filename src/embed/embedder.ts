import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

const MODEL = "Xenova/all-MiniLM-L6-v2";

let embedderPromise: Promise<FeatureExtractionPipeline> | null = null;

function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedderPromise) {
    embedderPromise = pipeline("feature-extraction", MODEL);
  }
  return embedderPromise;
}

export const EMBED_DIM = 384;

export async function embedText(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

export async function embedTexts(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
  batchSize = 32,
): Promise<number[][]> {
  const embedder = await getEmbedder();
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    // One batched forward pass per chunk instead of one call per text.
    const output = await embedder(batch, { pooling: "mean", normalize: true });
    const data = output.data as Float32Array;
    const dim = output.dims[output.dims.length - 1];
    for (let i = 0; i < batch.length; i++) {
      vectors.push(Array.from(data.subarray(i * dim, (i + 1) * dim)));
    }
    onProgress?.(Math.min(start + batchSize, texts.length), texts.length);
  }
  return vectors;
}