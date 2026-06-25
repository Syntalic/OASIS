// Quantize the build-time f32 endpoint-vector cache into the SHIPPABLE endpoint index.
//
//   dist/cache/endpoint-vecs.<backend>.bin   (gemini 3072-dim f32, ~344MB, gitignored,
//                                              produced by `pnpm build` / the binder)
//        →  dist/endpoint-index.i8.{bin,json} (~86MB int8, shipped in the server image)
//
// The server's endpoint arm (src/endpoint-arm.ts) loads THIS index when present. Per-vector
// symmetric int8: q = round(v / scale), scale = max|v| / 127. Since the source vectors are
// L2-normalized, cosine is recovered at query time as scale * dot(query_f32, q_int8) — no
// dequantize, ~86MB resident. Run after `pnpm build`, before `fly deploy`:
//   pnpm run build:endpoint-index
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { endpointEmbedText } from "../dist/embed/endpoint-text.js";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const hashText = (t) => createHash("sha256").update(t).digest("hex");
// The binder tags the cache file by embedding backend; gemini is the production embedder.
const TAG = "google_gemini_embedding_001";
const srcBin = path.join(DIST, "cache", `endpoint-vecs.${TAG}.bin`);
const srcIdx = path.join(DIST, "cache", `endpoint-vecs.${TAG}.json`);
if (!existsSync(srcBin) || !existsSync(srcIdx)) {
  console.error(`No f32 endpoint cache at ${srcBin}\nRun the gemini index build first (GOOGLE_API_KEY=... pnpm build).`);
  process.exit(1);
}

const sidecar = JSON.parse(readFileSync(srcIdx, "utf8"));
const { dim, hashes, model } = sidecar;
const buf = readFileSync(srcBin);
const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const total = hashes.length;
if (f32.length !== total * dim) {
  console.error(`cache size mismatch: ${f32.length} floats != ${total} x ${dim}`);
  process.exit(1);
}

// Ship ONLY vectors the current index.json references. The cache is content-addressed by
// embed text and outlives any single corpus, so it can carry vectors for records the gate
// later dropped (e.g. the content-free boilerplate). The endpoint arm only ever searches
// live endpoints, but shipping the extras is dead weight — filter to the live text hashes.
const index = JSON.parse(readFileSync(path.join(DIST, "index.json"), "utf8"));
const liveHashes = new Set((index.endpoints ?? []).map((e) => hashText(endpointEmbedText(e))));
const keep = [];
for (let i = 0; i < total; i++) if (liveHashes.has(hashes[i])) keep.push(i);
const n = keep.length;
console.log(`cache ${total} vectors → ${n} live (index ${index.endpoints?.length ?? 0} endpoints, ${liveHashes.size} unique texts)`);

const out = new Int8Array(n * dim);
const scales = new Float32Array(n);
const keptHashes = new Array(n);
for (let j = 0; j < n; j++) {
  const src = keep[j] * dim;
  const off = j * dim;
  keptHashes[j] = hashes[keep[j]];
  let max = 0;
  for (let d = 0; d < dim; d++) {
    const a = Math.abs(f32[src + d]);
    if (a > max) max = a;
  }
  const scale = max / 127 || 1;
  scales[j] = scale;
  for (let d = 0; d < dim; d++) {
    let q = Math.round(f32[src + d] / scale);
    if (q > 127) q = 127;
    else if (q < -127) q = -127;
    out[off + d] = q;
  }
}

const outBin = path.join(DIST, "endpoint-index.i8.bin");
const outIdx = path.join(DIST, "endpoint-index.i8.json");
writeFileSync(outBin, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
writeFileSync(outIdx, JSON.stringify({ model, dim, count: n, hashes: keptHashes, scales: Array.from(scales) }));
console.log(
  `Quantized ${n} x ${dim}-dim vectors -> ${path.relative(process.cwd(), outBin)} ` +
    `(${(out.byteLength / 1e6).toFixed(1)}MB int8) + sidecar (${(Buffer.byteLength(readFileSync(outIdx)) / 1e6).toFixed(1)}MB)`,
);
