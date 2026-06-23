import { endpointId } from "./id.js";
import { rankEndpointsNeutral, scoreEndpointNeutral } from "./score-endpoint.js";
import type { CapabilityIntent, EndpointRecord, SatisfiesRef } from "./types.js";

export function satisfiesRefsToEndpoints(
  refs: SatisfiesRef[],
  endpoints: EndpointRecord[],
): EndpointRecord[] {
  const byKey = new Map(
    endpoints.map((e) => [`${e.origin}|${e.method}|${e.path}`, e]),
  );
  const out: EndpointRecord[] = [];
  for (const ref of refs) {
    const key = `${ref.origin}|${ref.method.toUpperCase()}|${ref.path.startsWith("/") ? ref.path : `/${ref.path}`}`;
    const ep = byKey.get(key);
    if (ep) out.push(ep);
  }
  return out;
}

/** Rank candidate endpoints for an intent using neutral quality signals only. */
export function selectEndpointsForIntent(
  intent: CapabilityIntent,
  endpoints: EndpointRecord[],
  max = 10,
): EndpointRecord[] {
  const candidates = satisfiesRefsToEndpoints(intent.satisfies, endpoints);
  // Pass the intent so its typed ports drive the per-relevance term, not just
  // the neutral quality prior.
  return rankEndpointsNeutral(candidates, max, intent);
}

export function selectRank(
  intent: CapabilityIntent,
  expectedEndpointId: string,
  endpoints: EndpointRecord[],
): number | null {
  const ranked = selectEndpointsForIntent(intent, endpoints);
  const idx = ranked.findIndex((ep) => ep.id === expectedEndpointId);
  return idx >= 0 ? idx + 1 : null;
}

const QUERY_STOP = new Set([
  "the", "and", "for", "with", "from", "this", "that", "you", "your", "what",
  "are", "how", "get", "give", "need", "want", "find", "into", "out", "now",
  "can", "should", "would", "could", "please", "tell", "show", "make", "have",
  "use", "let", "know", "any", "some", "one", "all", "than", "then", "they",
  // generic API/web filler that pollutes intent label/alias vocab (e.g. weather
  // aliases "get current weather", "air quality index" leak get/current/api/today)
  "api", "current", "today", "new", "app", "via", "using", "per", "data", "info",
  "service", "request", "response", "returns", "return", "will", "live", "real",
]);

function queryTokens(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2 && !QUERY_STOP.has(t)),
    ),
  ];
}

// Match against the endpoint's OWN description, not search_text — the latter folds
// in the origin/provider title, so a reverse-geocode endpoint at host "openweather"
// or a market-cap endpoint at "crypto.*" spuriously matched the id tokens
// weather/crypto. Summary + path + inputs is the clean task signal.
function endpointText(ep: EndpointRecord): string {
  return `${ep.summary ?? ""} ${ep.description ?? ""} ${ep.path} ${(ep.inputs ?? []).join(" ")}`.toLowerCase();
}

/** Fraction of the given content tokens present in the endpoint's text. */
function lexicalScore(ep: EndpointRecord, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const text = endpointText(ep);
  let hits = 0;
  for (const t of tokens) if (text.includes(t)) hits += 1;
  return hits / tokens.length;
}

/** Absolute count of the given tokens present in the endpoint's text. Used for the
 *  id term so a long id (`crypto_spot_price`) isn't diluted: matching the head noun
 *  ("price") counts fully rather than as 1/3. */
function matchCount(ep: EndpointRecord, tokens: string[]): number {
  const text = endpointText(ep);
  let hits = 0;
  for (const t of tokens) if (text.includes(t)) hits += 1;
  return hits;
}

/**
 * The intent id's own tokens (minus the domain prefix) — the cleanest, lowest-noise
 * task discriminator: `data.weather_forecast` → [weather, forecast],
 * `finance.stock_quote` → [stock, quote]. Unlike the alias list, it carries no
 * generic filler, so an endpoint that mentions these words is almost certainly
 * on-task. This is the PRIMARY resolve-ranking signal.
 */
function intentIdTokens(intent: CapabilityIntent): string[] {
  const local = intent.id.split(".").slice(1).join(" ");
  return queryTokens(local.replace(/[_-]+/g, " "));
}

/** Broader task vocabulary (label + aliases, generic filler stopped out) — recall
 *  for cases where the id tokens don't literally appear in a good endpoint's text
 *  (e.g. speech_to_text vs a "transcribe audio" endpoint). */
function intentVocabTokens(intent: CapabilityIntent): string[] {
  return queryTokens([intent.label, ...(intent.aliases ?? [])].join(" "));
}

/** Weight on the lexical query↔endpoint term (per-request disambiguation). */
export const DEFAULT_QUERY_WEIGHT = 10;
/** Weight on the intent label/alias vocabulary fraction (recall). */
export const DEFAULT_VOCAB_WEIGHT = 12;
/** Per-token weight on intent-id matches (the primary, dominant relevance signal). */
export const DEFAULT_ID_WEIGHT = 25;
/**
 * The neutral quality prior is a TIEBREAKER, not a ranker — scaled well below the
 * lexical task-fit terms. At full weight it ranked a "fake-data generator" (quality
 * score 26) above the real weather endpoint; task fit must win, quality only breaks
 * ties among comparably on-task endpoints.
 */
export const DEFAULT_NEUTRAL_SCALE = 0.15;
/**
 * Popularity / trust from on-chain PAYMENT ACTIVITY — historical volume, revenue, and a
 * recent uptick (trending up). THIS is the quality signal endpoint ranking optimizes for:
 * among many endpoints that do the same task, the heavily-used and growing one is the one
 * an agent should prefer. It is **not yet ingested** — x402scan/mppscan observe every
 * x402/MPP settlement on-chain, so the data exists at the source; pulling it into endpoint
 * records is the next step (see docs/scaling.md). Until then this returns 0 and ranking
 * falls back to task fit + weak structural quality proxies.
 */
export const DEFAULT_POPULARITY_WEIGHT = 30;
function popularityScore(_ep: EndpointRecord, _weight: number): number {
  // const u = _ep.usage; if (!u) return 0;
  // return _weight * (norm(u.revenue_30d) + trendBonus(u.volume_7d, u.volume_30d));
  return 0; // pending on-chain volume/revenue ingestion
}

/** Weak INTERIM quality proxy — documented + a real input schema. Structural (harder to
 *  game than self-description), but a placeholder until popularity lands. */
export const DEFAULT_QUALITY_WEIGHT = 4;
function qualityScore(ep: EndpointRecord, weight: number): number {
  let q = 0;
  if (ep.guidance_available) q += 0.5;
  if ((ep.inputs?.length ?? 0) > 0) q += 0.5;
  return weight * q;
}

/** Price is NOT an optimization target — only a guard against the absurd. An endpoint
 *  priced far above the candidate median is pushed down; otherwise price is ignored. */
export const DEFAULT_PRICE_OUTLIER_PENALTY = 8;
function priceMedian(candidates: EndpointRecord[]): number | null {
  const ps = candidates
    .map((e) => e.payment?.price_usd)
    .filter((p): p is number => typeof p === "number" && p > 0)
    .sort((a, b) => a - b);
  return ps.length ? ps[Math.floor(ps.length / 2)] : null;
}
function priceOutlierGuard(ep: EndpointRecord, median: number | null, penalty: number): number {
  const p = ep.payment?.price_usd;
  if (median == null || typeof p !== "number") return 0;
  return p > 20 * median ? -penalty : 0; // "insanely expensive" → deprioritize; don't prefer cheapest
}

/**
 * Query-AWARE resolve: rank an intent's candidate endpoints by task fit — relevance
 * to the intent id (primary, per-token) + label/alias vocabulary (recall) + the
 * actual user query (disambiguation) — with the neutral quality prior as a scaled
 * tiebreaker. The id term is the workhorse: it surfaces endpoints that actually do
 * the task regardless of how oblique the query is.
 */
export function resolveEndpointsForQuery(
  intent: CapabilityIntent,
  endpoints: EndpointRecord[],
  query: string,
  max = 10,
  queryWeight = DEFAULT_QUERY_WEIGHT,
  vocabWeight = DEFAULT_VOCAB_WEIGHT,
  idWeight = DEFAULT_ID_WEIGHT,
  neutralScale = DEFAULT_NEUTRAL_SCALE,
  popularityWeight = DEFAULT_POPULARITY_WEIGHT,
  qualityWeight = DEFAULT_QUALITY_WEIGHT,
  priceOutlierPenalty = DEFAULT_PRICE_OUTLIER_PENALTY,
): EndpointRecord[] {
  const candidates = satisfiesRefsToEndpoints(intent.satisfies, endpoints);
  const qTokens = queryTokens(query);
  const idTokens = intentIdTokens(intent);
  const vocabTokens = intentVocabTokens(intent);
  const median = priceMedian(candidates);

  return [...candidates]
    .map((ep) => ({
      ep,
      // Task fit (id/vocab/query) GATES; among on-task endpoints, popularity (on-chain
      // usage — the target, 0 until ingested) decides, with weak structural quality as the
      // interim proxy and an outlier guard against absurd prices.
      score:
        neutralScale * scoreEndpointNeutral(ep, intent) +
        idWeight * matchCount(ep, idTokens) +
        vocabWeight * lexicalScore(ep, vocabTokens) +
        queryWeight * lexicalScore(ep, qTokens) +
        popularityScore(ep, popularityWeight) +
        qualityScore(ep, qualityWeight) +
        priceOutlierGuard(ep, median, priceOutlierPenalty),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.ep);
}