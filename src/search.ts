import { CURATED_INTENT_IDS } from "./intent-match.js";
import type { CapabilityIntent, EndpointRecord, SearchHit } from "./types.js";

const CURATED_CAPABILITY_IDS = new Set<string>(CURATED_INTENT_IDS);
const CAPABILITY_SCORE_MULTIPLIER = 2.2;

const GENERIC_SUMMARY =
  /^(authenticate|prove action|delete a memory|get mcp|api info|free health|purchase |buy )/i;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "your", "need", "want",
  "paid", "api", "via", "micropayment", "agent", "without", "keys",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9._\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function scoreTokens(queryTokens: string[], corpus: string): number {
  if (queryTokens.length === 0) return 0;
  const corpusTokens = new Set(tokenize(corpus));
  let hits = 0;
  for (const q of queryTokens) {
    if (corpusTokens.has(q)) hits += 1;
    else {
      for (const c of corpusTokens) {
        if (c.includes(q) || q.includes(c)) {
          hits += 0.5;
          break;
        }
      }
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

    if (cap.id === "ai.web_research" && /google|organic|serp|web results/i.test(query)) {
      score *= 0.25;
    }
    if (cap.id === "search.web" && /google|organic|serp|web results|announcements/i.test(query)) {
      score *= 1.35;
    }

    hits.push({
      kind: "capability",
      score: score * CAPABILITY_SCORE_MULTIPLIER,
      capability_id: cap.id,
      label: cap.label,
      summary: cap.description ?? cap.label,
    });
  }

  for (const ep of endpoints) {
    let score = scoreTokens(queryTokens, ep.search_text);
    if (score <= 0) continue;

    if (GENERIC_SUMMARY.test(ep.summary)) score *= 0.35;
    if (/gas|fmv|trademark|proxy pattern/i.test(ep.summary) && /price|call|enrich|screenshot|homes/i.test(query)) {
      score *= 0.15;
    }
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