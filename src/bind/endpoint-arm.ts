// DIRECT endpoint-embedding retrieval arm — a confidence-GATED fallback for the
// queries the intent layer fails. Two failure modes the intent buckets can't fix:
//   • ROUTING mispick — the query embeds closer to a sibling intent (whois → cloud.domains),
//     so the right (correctly-bound) endpoints are never resolved.
//   • BINDING misassignment — the right endpoints are bound to the wrong intent or unbound
//     (smart-money endpoints → crypto_spot_price / unbound), so they're unreachable.
// A direct query→endpoint cosine search bypasses BOTH: it scores the query against each
// endpoint's OWN gemini vector, regardless of routing or binding.
//
// This is a *fallback*, never a merge: intent-routing + concentration wins 38/40, and a
// naive union dilutes those wins (measured: −27 queries). So the caller only consults this
// arm when the ROUTER was unsure — the top-two intents are separated by a hair (see the
// margin gate in mcp/tools.mjs).
//
// Two vector sources, in preference order:
//   1. dist/endpoint-index.i8.{bin,json} — the SHIPPED int8 index (per-vector symmetric
//      quantization, ~86MB), produced by scripts/build-endpoint-index.mjs. ~86MB resident,
//      cosine = scale * dot(query_f32, endpoint_int8).
//   2. dist/cache/endpoint-vecs.<backend>.{bin,json} — the dev-only f32 cache (~344MB,
//      gitignored, deleted from the server image).
// Keyed by sha256 of the SAME endpointEmbedText the binder embedded. When NEITHER is present
// the arm reports notReady() and the caller transparently keeps pure concentration — so the
// code is safe to ship before the index is.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EMBED_BACKEND, EMBED_DIM } from "../embed/embedder.js";
import { endpointEmbedText } from "../embed/endpoint-text.js";
import type { EndpointRecord } from "../core/types.js";

/** Same well-known meta files the binder skips — never paid task endpoints. */
const META_FILE = /(robots\.txt|llms\.txt|sitemap|\.well-known|openapi\.json|swagger\.json|\/status$|favicon)/i;

const hashText = (t: string): string => createHash("sha256").update(t).digest("hex");

const endpointKey = (ep: { method: string; origin: string; path: string }): string =>
  `${ep.method} ${ep.origin}${ep.path}`;

export interface ArmHit {
  ep: EndpointRecord;
  score: number; // cosine to the query
}

export interface EndpointArm {
  ready: boolean;
  /** Which vector source loaded: "quantized" (shipped int8) | "f32" (dev cache) | null. */
  source: "quantized" | "f32" | null;
  /** Searchable endpoints (meta-files / vector-less / empty-text excluded). */
  size: number;
  /** Top-k endpoints by query↔endpoint cosine over the whole corpus. */
  topK(queryVec: number[], k: number): ArmHit[];
  /** Cosine of the query to ONE endpoint (for the gate signal). null if no vector. */
  cosineToEndpoint(queryVec: number[], key: string): number | null;
}

const NOT_READY: EndpointArm = {
  ready: false,
  source: null,
  size: 0,
  topK: () => [],
  cosineToEndpoint: () => null,
};

/** A vector + its dequantization scale (1 for f32). L2-normalized source → dot == cosine. */
interface Vec {
  v: Float32Array | Int8Array;
  scale: number;
}

function score(q: number[], e: Vec): number {
  const { v, scale } = e;
  let s = 0;
  for (let i = 0; i < q.length; i++) s += q[i] * v[i];
  return scale === 1 ? s : s * scale;
}

/** Load the shipped int8 index → hash -> {Int8Array, scale}. */
function loadQuantized(dir: string): Map<string, Vec> | null {
  const bin = path.join(dir, "endpoint-index.i8.bin");
  const idx = path.join(dir, "endpoint-index.i8.json");
  if (!existsSync(bin) || !existsSync(idx)) return null;
  try {
    const meta = JSON.parse(readFileSync(idx, "utf8")) as {
      model: string;
      dim: number;
      hashes: string[];
      scales: number[];
    };
    if (meta.model !== EMBED_BACKEND || meta.dim !== EMBED_DIM) return null;
    const buf = readFileSync(bin);
    const all = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const map = new Map<string, Vec>();
    for (let i = 0; i < meta.hashes.length; i++) {
      map.set(meta.hashes[i], {
        v: all.subarray(i * meta.dim, (i + 1) * meta.dim),
        scale: meta.scales[i],
      });
    }
    return map;
  } catch {
    return null;
  }
}

/** Load the dev f32 cache → hash -> {Float32Array, scale:1}. */
function loadF32(cacheDir: string): Map<string, Vec> | null {
  const tag = EMBED_BACKEND.replace(/[^a-z0-9]+/gi, "_");
  const bin = path.join(cacheDir, `endpoint-vecs.${tag}.bin`);
  const idx = path.join(cacheDir, `endpoint-vecs.${tag}.json`);
  if (!existsSync(bin) || !existsSync(idx)) return null;
  try {
    const meta = JSON.parse(readFileSync(idx, "utf8")) as { model: string; dim: number; hashes: string[] };
    if (meta.model !== EMBED_BACKEND || meta.dim !== EMBED_DIM) return null;
    const buf = readFileSync(bin);
    const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    const map = new Map<string, Vec>();
    for (let i = 0; i < meta.hashes.length; i++) {
      map.set(meta.hashes[i], { v: all.subarray(i * meta.dim, (i + 1) * meta.dim), scale: 1 });
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * Load the endpoint-vector index (shipped quantized, else dev f32) and bind it to the live
 * endpoint records. `distDir` holds both endpoint-index.i8.* and cache/. Returns NOT_READY
 * (caller keeps pure concentration) when neither source is present or it's stale.
 */
export function loadEndpointArm(distDir: string, endpoints: EndpointRecord[]): EndpointArm {
  let vecByHash = loadQuantized(distDir);
  let source: "quantized" | "f32" = "quantized";
  if (!vecByHash) {
    vecByHash = loadF32(path.join(distDir, "cache"));
    source = "f32";
  }
  if (!vecByHash) return NOT_READY;

  const corpus: Array<{ ep: EndpointRecord; vec: Vec }> = [];
  const vecByKey = new Map<string, Vec>();
  for (const ep of endpoints) {
    const vec = vecByHash.get(hashText(endpointEmbedText(ep)));
    if (!vec) continue;
    vecByKey.set(endpointKey(ep), vec);
    // The searchable corpus excludes meta-files and text-less endpoints — when the gate
    // fires we don't want to surface junk the binder would also have skipped.
    if (META_FILE.test(ep.path ?? "")) continue;
    if (!(ep.summary || ep.description)) continue;
    corpus.push({ ep, vec });
  }
  if (corpus.length === 0) return NOT_READY;

  return {
    ready: true,
    source,
    size: corpus.length,
    topK(queryVec, k) {
      return corpus
        .map((c) => ({ ep: c.ep, score: score(queryVec, c.vec) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
    cosineToEndpoint(queryVec, key) {
      const e = vecByKey.get(key);
      return e ? score(queryVec, e) : null;
    },
  };
}

export { endpointKey };
