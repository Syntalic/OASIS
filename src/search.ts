import type { CapabilityIntent, EndpointRecord, SearchHit } from "./types.js";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9._\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
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

export function searchIndex(
  query: string,
  endpoints: EndpointRecord[],
  capabilities: CapabilityIntent[],
  limit = 10,
): SearchHit[] {
  const queryTokens = tokenize(query);
  const hits: SearchHit[] = [];

  for (const cap of capabilities) {
    const corpus = [
      cap.id,
      cap.label,
      cap.description,
      ...(cap.aliases ?? []),
      ...(cap.schema_org ?? []),
    ]
      .filter(Boolean)
      .join(" ");
    const score = scoreTokens(queryTokens, corpus);
    if (score <= 0) continue;
    hits.push({
      kind: "capability",
      score: score * 1.2,
      capability_id: cap.id,
      label: cap.label,
      summary: cap.description ?? cap.label,
    });
  }

  for (const ep of endpoints) {
    const score = scoreTokens(queryTokens, ep.search_text);
    if (score <= 0) continue;
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