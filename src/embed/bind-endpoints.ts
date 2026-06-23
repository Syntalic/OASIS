// Embedding-driven endpoint→intent binding. Replaces the regex INTENT_MATCHERS:
// embed every endpoint and every curated intent, then bind each endpoint to the
// curated intent(s) it is closest to (cosine ≥ floor, top-K). This is what kills
// the satisfies[] junk — an off-topic endpoint (e.g. "Search prediction markets")
// is simply far from finance.stock_quote and never binds. Precision comes from
// the floor, not from per-intent rules, so it scales as the index grows.
//
// Endpoint vectors are reused across runs via the build-time cache (endpoint-cache.ts):
// an unchanged endpoint is embedded once, ever. Uses the active embedder — run the
// build/enrich WITHOUT GOOGLE_API_KEY to bind with local MiniLM (offline, no quota);
// runtime query→intent routing uses gemini independently (separate similarity spaces).
import { CURATED_INTENT_IDS } from "../intent-match.js";
import type { CapabilityIntent, CuratedIntentSource, EndpointRecord } from "../types.js";
import { EMBED_BACKEND, embedTexts } from "./embedder.js";
import { embedEndpointsCached } from "./endpoint-cache.js";
import { capabilityEmbedText } from "./lance-index.js";

const CURATED = new Set<string>(CURATED_INTENT_IDS);

/** Endpoint text to embed — task signal only (summary/description/path/inputs),
 *  never origin/provider (which would leak vendor names into the match). */
function endpointEmbedText(ep: EndpointRecord): string {
  return [ep.summary, ep.description, ep.path, ...(ep.inputs ?? [])]
    .filter(Boolean)
    .join(" ");
}

/** Dot product == cosine: the embedder returns L2-normalized vectors. */
function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export interface BindOptions {
  /** Minimum cosine similarity to bind an endpoint to an intent. */
  floor?: number;
  /** Max intents a single endpoint may bind to. */
  topKPerEndpoint?: number;
  /** Build-time embedding cache dir (e.g. dist/cache). Reuses unchanged endpoint
   *  vectors across runs so a rebuild embeds only the delta, not all 30k. */
  cacheDir?: string;
  onProgress?: (done: number, total: number) => void;
}

export interface BindResult {
  bound: number;
  perIntent: Map<string, number>;
  /** Endpoints freshly embedded this run (cache miss). */
  embedded: number;
  /** Endpoints served from the embedding cache. */
  reused: number;
}

/**
 * Mutates `endpoints[*].capabilities` in place: clears any prior (regex-seeded)
 * binding and sets the semantically-matched curated intent ids. Returns counts.
 */
export async function bindEndpointsByEmbedding(
  endpoints: EndpointRecord[],
  intentSources: CuratedIntentSource[],
  opts: BindOptions = {},
): Promise<BindResult> {
  // Gemini's cosine scale sits high and a wrong-but-related intent can score ~0.81,
  // so bind argmax-only (topK=1) above a high floor — this also cures the
  // over-binding (one endpoint → one best intent, not six). MiniLM separates lower
  // and tolerates topK=2. Backend-aware defaults; callers may override.
  const isGoogle = EMBED_BACKEND.startsWith("google");
  const floor = opts.floor ?? (isGoogle ? 0.78 : 0.45);
  const topK = opts.topKPerEndpoint ?? (isGoogle ? 1 : 2);

  const curated = intentSources.filter((s) => CURATED.has(s.id));
  const intentVecs = await embedTexts(
    curated.map((s) => capabilityEmbedText({ ...s, satisfies: [] } as unknown as CapabilityIntent)),
    undefined,
    { taskType: "RETRIEVAL_DOCUMENT" },
  );

  const endpointTexts = endpoints.map(endpointEmbedText);
  let endpointVecs: ArrayLike<number>[];
  let embedded = endpointTexts.length;
  let reused = 0;
  if (opts.cacheDir) {
    const r = await embedEndpointsCached(endpointTexts, opts.cacheDir, opts.onProgress);
    endpointVecs = r.vectors;
    embedded = r.embedded;
    reused = r.reused;
  } else {
    endpointVecs = await embedTexts(endpointTexts, opts.onProgress, {
      taskType: "RETRIEVAL_DOCUMENT",
      batchSize: 64,
    });
  }

  const perIntent = new Map<string, number>();
  let bound = 0;
  for (let i = 0; i < endpoints.length; i++) {
    const ev = endpointVecs[i];
    const matches = curated
      .map((s, j) => ({ id: s.id, sim: cosine(ev, intentVecs[j]) }))
      .filter((x) => x.sim >= floor)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, topK);
    // Always overwrite: clear stale regex bindings even when nothing matches, so
    // materialize never falls through to a legacy candidate set.
    endpoints[i].capabilities = matches.map((m) => m.id);
    if (matches.length) {
      bound += 1;
      for (const m of matches) perIntent.set(m.id, (perIntent.get(m.id) ?? 0) + 1);
    }
  }
  return { bound, perIntent, embedded, reused };
}
