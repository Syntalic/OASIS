import { CURATED_INTENT_IDS } from "./intent-match.js";
import type {
  CapabilityIntent,
  EndpointRecord,
  FacetDomain,
  FacetModality,
  SearchHit,
} from "../core/types.js";

const CURATED_CAPABILITY_IDS = new Set<string>(CURATED_INTENT_IDS);

const GENERIC_SUMMARY =
  /^(authenticate|prove action|delete a memory|get mcp|api info|free health|purchase |buy )/i;

// Smaller, justified stopword list: only true English glue words that never
// carry discriminating intent. We deliberately KEEP paid/api/keys/agent —
// they are the exact words of the "paid API without keys" framing and were
// silently dropping signal before.
const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "your", "need", "want",
  "via",
  // Generic interrogative / copula filler — no API-intent signal. (Without these,
  // "what is the forecast..." matches crypto/stock aliases like "what is ETH
  // trading at" and drowns out the real intent.) Kept minimal: broader filler
  // (prepositions) regressed a curated query for no multi-label gain.
  "what", "whats", "is", "are", "be", "am", "was", "were",
]);

/**
 * Light, deterministic stemmer: strips a single common plural/verb suffix so
 * that 'prices'/'pricing'/'priced' collapse to a shared stem while keeping
 * unrelated words apart ('call' stays 'call', 'recall' stays 'recall').
 * Intentionally conservative — no aggressive Porter-style rewriting.
 */
function stem(token: string): string {
  if (token.length <= 4) return token;
  if (token.endsWith("ies") && token.length > 4) return token.slice(0, -3) + "y";
  if (token.endsWith("sses")) return token.slice(0, -2); // addresses -> address
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9._\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Token-BOUNDARY scoring with light stemming. Each query token earns:
 *   1.0  for an exact corpus-token match,
 *   0.6  for a stem match (plural/verb-suffix variance only),
 *   0.5  for a closed-compound match where the query token ENDS WITH a whole
 *        corpus token (robocall -> call, megapixel -> pixel),
 * and nothing for incidental substring overlap. This removes the old 0.5
 * blanket substring credit that let 'call' match 'recall': the compound rule
 * is asymmetric (only query.endsWith(corpusToken)) and requires the query to be
 * a genuine prefix-compound (>= 3 chars longer), so the query token 'call'
 * never matches the corpus token 'recall'.
 */
function compoundMatch(q: string, corpusTokens: string[]): boolean {
  for (const c of corpusTokens) {
    if (c.length >= 4 && q.length >= c.length + 3 && q.endsWith(c)) return true;
  }
  return false;
}

function scoreTokens(queryTokens: string[], corpus: string): number {
  if (queryTokens.length === 0) return 0;
  const corpusTokens = tokenize(corpus);
  const corpusSet = new Set(corpusTokens);
  const corpusStems = new Set(corpusTokens.map(stem));
  let hits = 0;
  for (const q of queryTokens) {
    if (corpusSet.has(q)) {
      hits += 1;
    } else if (corpusStems.has(stem(q))) {
      hits += 0.6;
    } else if (compoundMatch(q, corpusTokens)) {
      hits += 0.5;
    }
  }
  return hits / queryTokens.length;
}

function phraseBoost(query: string, phrases: string[]): number {
  const q = query.toLowerCase().replace(/[^a-z0-9._\s-]/g, " ");
  let boost = 0;
  for (const phrase of phrases) {
    const p = phrase.toLowerCase().trim();
    if (p.length < 4) continue;
    if (q.includes(p)) {
      boost += Math.min(2.5, 0.5 + p.split(/\s+/).length * 0.2);
    }
  }
  return boost;
}

function intentIdBoost(query: string, intentId: string): number {
  const q = query.toLowerCase();
  const parts = intentId.replace(/[._-]/g, " ").split(/\s+/).filter((p) => p.length > 2);
  if (parts.length === 0) return 0;
  const matched = parts.filter((p) => q.includes(p)).length;
  return matched / parts.length * 0.4;
}

/** Inferred query-side facets, mapping surface cues to facet VALUES. */
export interface InferredQueryFacets {
  domain?: FacetDomain;
  primary_entity?: string;
  output_entity?: string;
  modality?: FacetModality[];
}

// Cue tables: ordered so the first match wins per axis. Patterns are
// word-ish so they do not fire on incidental substrings.
const DOMAIN_CUES: Array<[FacetDomain, RegExp]> = [
  ["maps", /\b(near\s?by|nearby|near me|near downtown|points? of interest|\bpoi\b|coffee shop|restaurant|cafe|open now|street address|geocod|lat(itude)?\b|directions?)\b/i],
  ["blockchain", /\b(crypto|on.?chain|onchain|wallet address|token balance|erc-?20|blockchain|defi)\b/i],
  ["shop", /\b(cheapest|best price|on sale|discount|coupon|deal|clearance|retailer)\b/i],
  ["comms", /\b(send (an )?(email|sms|text|fax)|outbound (email|sms|call)|voice call|cold email)\b/i],
];

const ENTITY_CUES: Array<[string, RegExp]> = [
  ["Ticker", /\b(stock|equity|equities|shares?|ticker|nasdaq|nyse|\bnvda\b|\baapl\b|\btsla\b|\bspy\b|s&p)\b/i],
  ["CryptoAsset", /\b(bitcoin|\bbtc\b|ethereum|\beth\b|solana|\bsol\b|crypto(currency)?|coin|altcoin|token price|spot price for)\b/i],
  ["Domain", /\b(domain( name)?|corporate domain|\.com\b|registrar|whois|nameserver)\b/i],
  ["Document", /\b(pdf|document|invoice|receipt|contract|spreadsheet)\b/i],
  ["Image", /\b(photo|picture|image|\bjpe?g\b|\bpng\b|screenshot|scanned)\b/i],
  ["Webpage", /\b(url|web ?page|website|web site)\b/i],
];

const OUTPUT_CUES: Array<[string, RegExp]> = [
  ["StructuredRecord", /\b(structured (data|json|output|record)|extracted fields?|json output|key.?value|line items|extract .*fields)\b/i],
  ["CitedAnswer", /\b(citation|sources?|cited|grounded|with references)\b/i],
  ["SearchResults", /\b(serp|organic results|search results|google results|ranked links)\b/i],
  ["PriceSignal", /\b(price history|price drop|price trend|cheapest)\b/i],
];

const MODALITY_CUES: Array<[FacetModality, RegExp]> = [
  ["markdown", /\b(markdown|clean text|readable text|md format)\b/i],
  ["citations", /\b(citation|sources?|cited|grounded|with references)\b/i],
  ["json", /\b(serp|organic results|json output|structured json)\b/i],
  ["image", /\b(screenshot|png|render the page|visual snapshot|capture the page)\b/i],
  ["html", /\b(raw html|full html|page html)\b/i],
  ["audio", /\b(audio|mp3|spoken|text.?to.?speech|narration)\b/i],
  ["timeseries", /\b(time series|historical (data|prices)|over time|trend over)\b/i],
];

/**
 * Map free-text query cues onto facet VALUES. Pure/deterministic, returns only
 * the axes it is confident about (absent axis == no signal). Exported so the
 * hybrid pre-filter (M1) can reuse the exact same inference.
 */
export function inferQueryFacets(query: string): InferredQueryFacets {
  const q = query.toLowerCase();
  const out: InferredQueryFacets = {};

  for (const [domain, re] of DOMAIN_CUES) {
    if (re.test(q)) { out.domain = domain; break; }
  }
  for (const [entity, re] of ENTITY_CUES) {
    if (re.test(q)) { out.primary_entity = entity; break; }
  }
  for (const [entity, re] of OUTPUT_CUES) {
    if (re.test(q)) { out.output_entity = entity; break; }
  }
  const modality: FacetModality[] = [];
  for (const [m, re] of MODALITY_CUES) {
    if (re.test(q)) modality.push(m);
  }
  if (modality.length) out.modality = modality;

  return out;
}

export function searchIndex(
  query: string,
  endpoints: EndpointRecord[],
  capabilities: CapabilityIntent[],
  limit = 10,
): SearchHit[] {
  const queryTokens = tokenize(query);
  const hits: SearchHit[] = [];

  for (const cap of capabilities) {
    if (!CURATED_CAPABILITY_IDS.has(cap.id)) continue;

    const phrases = [
      cap.label,
      cap.description,
      ...(cap.aliases ?? []),
    ].filter(Boolean) as string[];

    const corpus = [cap.id, ...phrases, ...(cap.schema_org ?? [])].join(" ");
    const tokenScore = scoreTokens(queryTokens, corpus);
    const boost =
      phraseBoost(query, phrases) +
      intentIdBoost(query, cap.id);
    let score = tokenScore + boost;
    if (score <= 0) continue;

    // Confidence-scaled capability weight (replaces the flat 2.2). A strong
    // capability match (tokenScore >= 0.5) keeps the full ~2.2 multiplier; a
    // weak one-token match earns proportionally less, so it can no longer
    // outrank a strongly-overlapping endpoint.
    const confidence = Math.min(1, tokenScore / 0.5);
    const capMultiplier = 1 + 1.2 * confidence;
    score *= capMultiplier;

    hits.push({
      kind: "capability",
      score,
      capability_id: cap.id,
      label: cap.label,
      summary: cap.description ?? cap.label,
    });
  }

  for (const ep of endpoints) {
    let score = scoreTokens(queryTokens, ep.search_text);
    if (score <= 0) continue;

    if (GENERIC_SUMMARY.test(ep.summary)) score *= 0.35;
    if (ep.guidance_available) score *= 1.15;
    if (ep.payment.price_usd != null) score *= 1.05;

    hits.push({
      kind: "endpoint",
      score,
      endpoint_id: ep.id,
      capability_id: ep.capabilities?.[0],
      label: ep.summary,
      summary: `${ep.method} ${ep.path}`,
      origin: ep.origin,
      method: ep.method,
      path: ep.path,
      price_usd: ep.payment.price_usd,
      payment_rails: ep.payment.rails.map((r) => r.protocol),
      provider_fqn: ep.provider_fqn,
    });
  }

  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
