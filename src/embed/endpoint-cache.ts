// Build-time cache of endpoint embeddings. An endpoint's vector is a pure
// function of its text + the embedding model, so once computed it never needs
// recomputing — only NEW or CHANGED endpoints are embedded on a rebuild. This is
// the difference between "embed 30k every build" (slow, hot, costly, quota-heavy)
// and "embed only the delta".
//
// Keyed by sha256(text) within a per-model file. The cache is a BUILD artifact
// (dist/cache/, gitignored) and is NEVER shipped to the runtime image — the
// server only embeds the live query, never endpoints. Stored as a flat Float32
// buffer + a JSON sidecar (hash order + model/dim) so 30k×3072 stays ~375MB on
// disk and loads as one mmap-friendly read.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { EMBED_BACKEND, EMBED_DIM, embedTexts } from "./embedder.js";

interface CacheSidecar {
  model: string;
  dim: number;
  hashes: string[]; // row order in the .bin buffer
}

const hashText = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

function cachePaths(cacheDir: string): { bin: string; idx: string } {
  const tag = EMBED_BACKEND.replace(/[^a-z0-9]+/gi, "_");
  return {
    bin: path.join(cacheDir, `endpoint-vecs.${tag}.bin`),
    idx: path.join(cacheDir, `endpoint-vecs.${tag}.json`),
  };
}

async function loadCache(cacheDir: string): Promise<Map<string, Float32Array>> {
  const { bin, idx } = cachePaths(cacheDir);
  const map = new Map<string, Float32Array>();
  if (!existsSync(bin) || !existsSync(idx)) return map;
  try {
    const sidecar = JSON.parse(await readFile(idx, "utf8")) as CacheSidecar;
    // A different model or dimensionality invalidates the whole cache.
    if (sidecar.model !== EMBED_BACKEND || sidecar.dim !== EMBED_DIM) return map;
    const buf = await readFile(bin);
    const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    for (let i = 0; i < sidecar.hashes.length; i++) {
      map.set(sidecar.hashes[i], all.subarray(i * sidecar.dim, (i + 1) * sidecar.dim));
    }
  } catch {
    return new Map();
  }
  return map;
}

async function saveCache(cacheDir: string, cache: Map<string, Float32Array>): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const { bin, idx } = cachePaths(cacheDir);
  const hashes = [...cache.keys()];
  const flat = new Float32Array(hashes.length * EMBED_DIM);
  hashes.forEach((h, i) => flat.set(cache.get(h)!, i * EMBED_DIM));
  await writeFile(bin, Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength));
  const sidecar: CacheSidecar = { model: EMBED_BACKEND, dim: EMBED_DIM, hashes };
  await writeFile(idx, JSON.stringify(sidecar));
}

export interface CachedEmbedResult {
  vectors: Float32Array[]; // aligned to the input `texts`
  embedded: number; // how many were freshly embedded (the delta)
  reused: number; // how many came from the cache
}

/**
 * Embed `texts`, reusing the on-disk cache for any whose content hash is already
 * known and embedding only the rest. Persists the (possibly extended) cache.
 * De-dupes identical texts so a repeated endpoint is embedded at most once.
 */
export async function embedEndpointsCached(
  texts: string[],
  cacheDir: string,
  onProgress?: (done: number, total: number) => void,
): Promise<CachedEmbedResult> {
  const cache = await loadCache(cacheDir);
  const hashes = texts.map(hashText);

  const missByHash = new Map<string, string>(); // hash -> text (unique)
  for (let i = 0; i < texts.length; i++) {
    if (!cache.has(hashes[i])) missByHash.set(hashes[i], texts[i]);
  }
  const missHashes = [...missByHash.keys()];
  const missTexts = [...missByHash.values()];

  if (missTexts.length) {
    const fresh = await embedTexts(missTexts, onProgress, {
      taskType: "RETRIEVAL_DOCUMENT",
      batchSize: EMBED_BACKEND.startsWith("google") ? 100 : 64,
    });
    for (let i = 0; i < missHashes.length; i++) {
      cache.set(missHashes[i], Float32Array.from(fresh[i]));
    }
    await saveCache(cacheDir, cache);
  }

  return {
    vectors: texts.map((_, i) => cache.get(hashes[i])!),
    embedded: missTexts.length,
    reused: texts.length - missTexts.length,
  };
}
