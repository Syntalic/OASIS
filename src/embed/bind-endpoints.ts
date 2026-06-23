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

/** Well-known meta files served by many hosts — not paid task endpoints, so they
 *  must never bind to a task intent (they otherwise sink into catch-all intents). */
const META_FILE = /(robots\.txt|llms\.txt|sitemap|\.well-known|openapi\.json|swagger\.json|\/status$|favicon)/i;

/** Access-cost boilerplate ("this endpoint requires a payment of $X USDC") — NOT a
 *  task description, and its crypto/payment vocabulary actively poisons the vector
 *  toward finance/blockchain intents. Distinct from a real payments API ("process a
 *  payment"), which this does not match. */
const PAYMENT_BOILER =
  /this endpoint requires a payment|requires (a |an )?(x402 |micropayment )?payment of\b|requires x402 payment|payment of\s+\*{0,2}\$?[\d.]+\s*(usdc|usd|eth)|\bx402 payment\b/i;

/** A summary carries no task signal if it is empty, a bare method+path, a price
 *  string, or just a product name ("… API"). */
function summaryWeak(s: string): boolean {
  return (
    s.length < 8 ||
    /^(get|post|put|delete)\s+\//i.test(s) ||
    /^"?\W*\$?\d[\d.,]*\s*(usdc|usd)?"?\W*$/i.test(s) ||
    /\bAPI"?\s*$/i.test(s)
  );
}

/** Spec-quality bar: an endpoint below the bar carries no usable task semantics —
 *  its description is payment/access boilerplate AND its summary gives no signal.
 *  Such an endpoint can't embed distinctively, so it argmax-dumps into a high-prior
 *  intent. Gate it from BINDING (still searchable via vector/keyword) rather than
 *  let it pollute a precise intent's resolve pool. */
function belowSpecBar(ep: EndpointRecord): boolean {
  const d = (ep.description ?? "").trim();
  const s = (ep.summary ?? "").trim();
  return PAYMENT_BOILER.test(d) && summaryWeak(s);
}

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
  /** Min gap between the best and 2nd-best intent to accept an argmax binding.
   *  In gemini's compressed cosine band (~0.78–0.82) a near-tie means the top
   *  intent is noise, not a real match — gate it out (topK=1 path only). */
  margin?: number;
  /** Per-intent floor overrides — lower the bind floor for sparse intents the
   *  global floor would otherwise starve (e.g. shop.price_drop_alert). */
  floorOverrides?: Record<string, number>;
  /** Build-time embedding cache dir (e.g. dist/cache). Reuses unchanged endpoint
   *  vectors across runs so a rebuild embeds only the delta, not all 30k. */
  cacheDir?: string;
  onProgress?: (done: number, total: number) => void;
}

export interface BindResult {
  bound: number;
  perIntent: Map<string, number>;
  /** Endpoints skipped as well-known meta files (robots/llms/.well-known/…). */
  gatedMeta: number;
  /** Endpoints skipped as below the spec-quality bar (boilerplate-only metadata). */
  gatedSpec: number;
  /** Endpoints left unbound because the argmax was a low-confidence near-tie. */
  gatedMargin: number;
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
  const margin = opts.margin ?? (isGoogle ? 0.01 : 0);
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

  const perIntent = new Map<string, number>();
  let bound = 0;
  let gatedMeta = 0;
  let gatedSpec = 0;
  let gatedMargin = 0;
  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    // Meta files (robots/llms/.well-known/…) are not paid task endpoints.
    if (META_FILE.test(ep.path ?? "")) {
      ep.capabilities = [];
      gatedMeta += 1;
      continue;
    }
    // Below the spec-quality bar (boilerplate-only metadata) → never bind.
    if (belowSpecBar(ep)) {
      ep.capabilities = [];
      gatedSpec += 1;
      continue;
    }
    const ev = endpointVecs[i];
    const sims = curated
      .map((s, j) => ({ id: s.id, sim: cosine(ev, intentVecs[j]) }))
      .sort((a, b) => b.sim - a.sim);

    let matches: { id: string; sim: number }[];
    if (topK === 1) {
      // Argmax binding with a CONFIDENCE MARGIN: the best intent must clear its
      // floor AND beat the runner-up by `margin`. A near-tie in gemini's
      // compressed band is noise — leave it unbound (vector search still finds
      // the endpoint) rather than pollute a precise intent's resolve pool.
      const best = sims[0];
      const second = sims[1];
      const clears = best && best.sim >= floorFor(best.id);
      const confident = !second || best.sim - second.sim >= margin;
      if (clears && confident) {
        matches = [best];
      } else {
        matches = [];
        if (clears && !confident) gatedMargin += 1;
      }
    } else {
      matches = sims.filter((x) => x.sim >= floorFor(x.id)).slice(0, topK);
    }

    // Always overwrite: clear stale bindings even when nothing matches, so
    // materialize never falls through to a legacy candidate set.
    ep.capabilities = matches.map((m) => m.id);
    if (matches.length) {
      bound += 1;
      for (const m of matches) perIntent.set(m.id, (perIntent.get(m.id) ?? 0) + 1);
    }
  }
  return { bound, perIntent, embedded, reused, gatedMeta, gatedSpec, gatedMargin };
}
