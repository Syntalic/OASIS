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

function endpointText(ep: EndpointRecord): string {
  const base =
    ep.search_text && ep.search_text.length
      ? ep.search_text
      : `${ep.summary} ${ep.description ?? ""} ${ep.path} ${(ep.inputs ?? []).join(" ")}`;
  return base.toLowerCase();
}

/** Fraction of the query's content tokens present in the endpoint's text. */
function lexicalQueryScore(ep: EndpointRecord, qTokens: string[]): number {
  if (qTokens.length === 0) return 0;
  const text = endpointText(ep);
  let hits = 0;
  for (const t of qTokens) if (text.includes(t)) hits += 1;
  return hits / qTokens.length;
}

/** Weight on the lexical query↔endpoint term, relative to the neutral prior. */
export const DEFAULT_QUERY_WEIGHT = 10;

/**
 * Query-AWARE resolve: rank an intent's candidate endpoints against the actual
 * user query, blending the neutral quality prior + the intent's typed-port
 * relevance + a lexical query↔endpoint-text term. The selection scorer was
 * previously query-blind (every query that hit an intent got the same endpoint
 * order); this is the missing signal that makes resolve depend on what was asked.
 */
export function resolveEndpointsForQuery(
  intent: CapabilityIntent,
  endpoints: EndpointRecord[],
  query: string,
  max = 10,
  queryWeight = DEFAULT_QUERY_WEIGHT,
): EndpointRecord[] {
  const candidates = satisfiesRefsToEndpoints(intent.satisfies, endpoints);
  const qTokens = queryTokens(query);
  if (qTokens.length === 0) return rankEndpointsNeutral(candidates, max, intent);

  return [...candidates]
    .map((ep) => ({
      ep,
      score:
        scoreEndpointNeutral(ep, intent) +
        queryWeight * lexicalQueryScore(ep, qTokens),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.ep);
}