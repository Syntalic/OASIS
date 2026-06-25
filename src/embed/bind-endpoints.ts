// Endpoint→intent binding: dense + sparse HYBRID.
//
// Dense embeddings (gemini/MiniLM) give semantic RECALL, but gemini's cosine scale is
// compressed (~0.78–0.82 for almost everything), so a dense argmax binds weakly-
// distinctive endpoints (generic aggregator names, payment-boilerplate) onto whatever
// high-prior intent edges them out by ~0.003. A TF-IDF SPARSE arm adds lexical
// DISCRIMINATION: it breaks those near-ties (the term "travel" hits travel, "eth_call"
// hits RPC) and gates endpoints that share no task vocabulary with any near intent
// (the "0.013 USDC" price-strings, meta files). This one principled signal replaces the
// earlier hand-tuned margin + spec-bar gates. The sparse space is embedder-independent,
// so it works on both the gemini and MiniLM paths.
//
// Endpoint dense vectors are reused across runs via the build-time cache.
import { CURATED_INTENT_IDS } from "../search/intent-match.js";
import type { CapabilityIntent, CuratedIntentSource, EndpointRecord } from "../core/types.js";
import { EMBED_BACKEND, embedTexts } from "./embedder.js";
import { embedEndpointsCached } from "./endpoint-cache.js";
import { capabilityEmbedText } from "./lance-index.js";
import { endpointEmbedText } from "./endpoint-text.js";

const CURATED = new Set<string>(CURATED_INTENT_IDS);

/** Well-known meta files served by many hosts — not paid task endpoints. (The sparse
 *  floor would catch most anyway, but this is an explicit, free structural skip.) */
const META_FILE = /(robots\.txt|llms\.txt|sitemap|\.well-known|openapi\.json|swagger\.json|\/status$|favicon)/i;

/** Dot product == cosine: the embedder returns L2-normalized vectors. */
function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// --- TF-IDF sparse arm (embedder-independent lexical discriminator) ---
const STOP = new Set(
  "the a an and or of to for in on with by from get post put delete api key data your you this that is are be use using paid endpoint service via per call return returns request response price token usd usdc x402 mpp http https www com io app dev net org based one all any can will".split(
    " ",
  ),
);
/** Lowercase, alphanumeric, stopword-stripped, crudely stemmed tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map((t) => t.replace(/(ing|ed|es|s)$/, ""))
    .filter((t) => t.length > 2);
}
/** L2-normalized TF-IDF vector as a token→weight map (sparse). */
function tfidfVector(tokens: string[], idf: (t: string) => number): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  let norm = 0;
  for (const [t, c] of m) {
    const w = c * idf(t);
    m.set(t, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of m) m.set(t, w / norm);
  return m;
}
function sparseCosine(a: Map<string, number>, b: Map<string, number>): number {
  let s = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [t, w] of small) {
    const w2 = large.get(t);
    if (w2) s += w * w2;
  }
  return s;
}

export interface BindOptions {
  /** Minimum DENSE cosine for an intent to be a binding candidate. */
  floor?: number;
  /** Minimum SPARSE (TF-IDF) similarity to the chosen intent — gates endpoints with no
   *  shared task vocabulary (payment-boilerplate / degenerate metadata). */
  sparseFloor?: number;
  /** SPARSE similarity strong enough to PROMOTE an intent into the candidate set even when its
   *  dense cosine is below `floor`. Rescues mechanics-heavy endpoints whose raw text dilutes
   *  the dense vector below the floor for the right intent while a high-IDF capability term
   *  (e.g. "reddit") still matches that intent's alias/label. Must sit well above `sparseFloor`
   *  (a gating floor) so only discriminative matches promote. NEEDS CALIBRATION against the
   *  orphan audit + eval before the default is trusted. */
  strongSparseFloor?: number;
  /** Discrimination margin: when an endpoint's top intent is only a DENSE-floor pass with weak
   *  sparse overlap, require its dense cosine to beat the runner-up by at least this much — else
   *  orphan it (don't spill). gemini's dense scale is compressed, so a near-tie + weak lexical
   *  overlap is the spill signature (e.g. satellite-tile → maps.geocode). */
  denseMargin?: number;
  /** Max intents a single endpoint may bind to. */
  topKPerEndpoint?: number;
  /** Per-intent DENSE floor overrides — lower the floor for sparse intents the global
   *  floor would otherwise starve (the sparse floor still guards precision). */
  floorOverrides?: Record<string, number>;
  /** Build-time embedding cache dir (e.g. dist/cache) for endpoint dense vectors. */
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
  /** Endpoints skipped as well-known meta files. */
  gatedMeta: number;
  /** Endpoints left unbound by the sparse-vocabulary floor (no task terms shared with
   *  any dense-near intent — boilerplate/degenerate metadata). */
  gatedSparse: number;
  /** Endpoints bound ONLY because a strong sparse match promoted an intent the dense floor
   *  rejected — the orphan-rescue path. Observability for the promotion threshold. */
  promotedSparse: number;
  /** Endpoints orphaned by the discrimination margin — top intent was an ambiguous near-tie with
   *  weak sparse overlap (a spill we declined to bind). */
  gatedMargin: number;
}

/** Reciprocal-rank-fusion constant — merges the dense and sparse rankings. */
const RRF_K = 60;

/**
 * Mutates `endpoints[*].capabilities` in place with the hybrid-bound curated intent
 * id(s). Returns counts.
 */
export async function bindEndpointsByEmbedding(
  endpoints: EndpointRecord[],
  intentSources: CuratedIntentSource[],
  opts: BindOptions = {},
): Promise<BindResult> {
  const isGoogle = EMBED_BACKEND.startsWith("google");
  const floor = opts.floor ?? (isGoogle ? 0.78 : 0.45);
  const sparseFloor = opts.sparseFloor ?? 0.035;
  // Promotion floor — calibrated on a full gemini run (31,810-endpoint corpus, 4-floor sweep):
  // 0.12 is the knee that captures real Apify-class binds (the founding Apify reddit-scraper-lite
  // case sits at sparse 0.1364, so 0.15 would strand it) while the precision cost is dominated by
  // boilerplate providers now dropped at the gate (content-free summaries). See docs/proposals/completed/ingestion-overhaul.md.
  const strongSparseFloor = opts.strongSparseFloor ?? 0.12;
  // Discrimination margin — orphan ambiguous near-ties (the spill). Calibrate via the gatedMargin
  // count + the coverage eval before trusting the default.
  const denseMargin = opts.denseMargin ?? 0.02;
  const topK = opts.topKPerEndpoint ?? (isGoogle ? 1 : 2);
  const floorOverrides = opts.floorOverrides ?? {};
  const floorFor = (id: string): number => floorOverrides[id] ?? floor;

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

  // TF-IDF sparse space: IDF from the endpoint corpus; intents projected into the SAME
  // space so a shared-vocabulary score between an endpoint and an intent is comparable.
  const endpointTokens = endpointTexts.map(tokenize);
  const df = new Map<string, number>();
  for (const toks of endpointTokens) for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = endpoints.length;
  const idf = (t: string): number => Math.log(N / (1 + (df.get(t) ?? 0)));
  const endpointSparse = endpointTokens.map((toks) => tfidfVector(toks, idf));
  const intentSparse = curated.map((s) =>
    tfidfVector(
      tokenize([s.id.replace(/[._]/g, " "), s.label, s.description, ...(s.aliases ?? [])].join(" ")),
      idf,
    ),
  );

  const perIntent = new Map<string, number>();
  let bound = 0;
  let gatedMeta = 0;
  let gatedSparse = 0;
  let promotedSparse = 0;
  let gatedMargin = 0;
  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    if (META_FILE.test(ep.path ?? "")) {
      ep.capabilities = [];
      gatedMeta += 1;
      continue;
    }
    const ev = endpointVecs[i];
    const esp = endpointSparse[i];
    const scored = curated.map((s, j) => ({
      id: s.id,
      dense: cosine(ev, intentVecs[j]),
      sparse: sparseCosine(esp, intentSparse[j]),
    }));
    // Fuse the dense and sparse rankings with RRF. Candidates = dense-floor passers PLUS any
    // intent with a STRONG sparse match (the orphan-rescue promotion). Dense passers are kept
    // ahead of promotions, so promotion is strictly ADDITIVE: it can only fill top-K slots a
    // dense passer didn't claim — an endpoint that already had a dense binding keeps exactly
    // it. So this rescues orphans (e.g. the Apify Reddit actor → media.social_data) without
    // displacing a correct binding.
    const dRank = new Map<string, number>();
    [...scored].sort((a, b) => b.dense - a.dense).forEach((x, r) => dRank.set(x.id, r));
    const sRank = new Map<string, number>();
    [...scored].sort((a, b) => b.sparse - a.sparse).forEach((x, r) => sRank.set(x.id, r));
    const denseOk = (x: { id: string; dense: number }): boolean => x.dense >= floorFor(x.id);
    const promotedBySparse = (x: { id: string; dense: number; sparse: number }): boolean =>
      !denseOk(x) && x.sparse >= strongSparseFloor;
    const passers = scored
      .filter((x) => denseOk(x) || promotedBySparse(x))
      .map((x) => ({
        id: x.id,
        sparse: x.sparse,
        dense: x.dense,
        promoted: promotedBySparse(x),
        rrf: 1 / (RRF_K + (dRank.get(x.id) ?? 0)) + 1 / (RRF_K + (sRank.get(x.id) ?? 0)),
      }))
      .sort((a, b) => b.rrf - a.rrf);
    // Dense passers first, then promotions — this is what keeps promotion additive (above).
    const ranked = [
      ...passers.filter((p) => !p.promoted),
      ...passers.filter((p) => p.promoted),
    ];
    // Discrimination gate: gemini's dense scale is compressed, so a bare dense-floor pass on a
    // near-tie with weak sparse is a spill (satellite-tile → maps.geocode). Require the winner to
    // be a real lexical match OR beat the runner-up's dense by `denseMargin`; else orphan it.
    let maxDense = -Infinity;
    let secondDense = -Infinity;
    for (const s of scored) {
      if (s.dense > maxDense) { secondDense = maxDense; maxDense = s.dense; }
      else if (s.dense > secondDense) secondDense = s.dense;
    }
    const discriminative = (p: { sparse: number; dense: number }): boolean =>
      p.sparse >= strongSparseFloor || p.dense - (p.dense >= maxDense ? secondDense : maxDense) >= denseMargin;
    // Keep the top-K that share real task vocabulary (sparse floor) AND discriminate.
    const sparsePassing = ranked.slice(0, topK).filter((x) => x.sparse >= sparseFloor);
    const matches = sparsePassing.filter(discriminative);
    if (!matches.length) {
      if (sparsePassing.length) gatedMargin += 1;
      else if (passers.length) gatedSparse += 1;
    }
    // Always overwrite: clear stale bindings even when nothing matches.
    ep.capabilities = matches.map((m) => m.id);
    if (matches.length) {
      bound += 1;
      if (matches.some((m) => m.promoted)) promotedSparse += 1;
      for (const m of matches) perIntent.set(m.id, (perIntent.get(m.id) ?? 0) + 1);
    }
  }
  return { bound, perIntent, embedded, reused, gatedMeta, gatedSparse, promotedSparse, gatedMargin };
}
