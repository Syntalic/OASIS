import type { EndpointRecord, Port } from "./types.js";

const GENERIC_SUMMARY =
  /^(authenticate|prove action|delete a memory|get mcp|api info|free health|x402 defi)/i;
const GENERIC_PATH =
  /\/(health|authenticate|auth|prove|memory|mcp-tools|api-info|defi-nontokenized)(\/|$)/i;

export function isGenericEndpoint(ep: EndpointRecord): boolean {
  if (GENERIC_SUMMARY.test(ep.summary)) return true;
  if (GENERIC_PATH.test(ep.path)) return true;
  return false;
}

/**
 * Minimal intent shape consumed by the relevance term: only the typed
 * input/output ports. Accepting a structural subset (not the full
 * CapabilityIntent) keeps the relevance lever decoupled from materialization.
 */
export interface IntentPorts {
  consumes?: Port[];
  produces?: Port[];
}

/**
 * Maps a vocab entity (spec/entity-vocab.json) to the input-parameter tokens
 * that corroborate it. Lowercase, matched against endpoint `inputs[]` tokens.
 * Vendor-neutral: keyed on the typed noun, never on origin/provider.
 */
const ENTITY_INPUT_TOKENS: Record<string, string[]> = {
  Product: ["product", "product_uid", "sku", "asin", "upc", "gtin", "item", "q"],
  ProductCategory: ["category", "department", "product_category"],
  Money: ["price", "budget", "max_price", "amount", "amount_usd"],
  Currency: ["currency", "vs_currency", "base", "quote", "fiat"],
  Query: ["query", "q", "search", "keyword", "term", "prompt"],
  Webpage: ["url", "page_url", "link", "website", "uri"],
  Document: ["document", "documentnumber", "file", "pdf", "doc", "documenttype"],
  Image: ["image", "image_url", "imageurl", "base64", "photo", "img"],
  AudioClip: ["audio", "audio_url", "voice", "speech", "sound"],
  Text: ["text", "input", "content", "transcript", "body"],
  Contact: ["to", "email", "phone", "recipient", "contact", "number"],
  Mailbox: ["inbox", "mailbox", "from"],
  Location: ["location", "lat", "lon", "lng", "latitude", "longitude", "coordinates", "city", "place"],
  Company: ["company", "organization", "org", "business", "domain"],
  Person: ["person", "name", "people", "fullname", "full_name"],
  CryptoAsset: ["coin", "token", "asset", "symbol", "currency"],
  WalletAddress: ["address", "wallet", "wallet_address", "account", "holder"],
  BlockchainNetwork: ["chain", "network", "blockchain", "chain_id", "rpc"],
  Ticker: ["ticker", "symbol", "stock", "equity"],
  Domain: ["domain", "hostname", "host", "fqdn"],
  IpAddress: ["ip", "ip_address", "ipaddress", "addr"],
};

function entityInputTokens(entity: string): string[] {
  return ENTITY_INPUT_TOKENS[entity] ?? [];
}

/**
 * Per-intent relevance bonus: rewards endpoints whose declared inputs[] tokens
 * corroborate the resolving intent's consumes[].entity, plus a smaller bonus
 * when the endpoint's derived output_entity matches the intent's produced
 * entity. This is the only relevance-aware lever (moves select@k / resolve-rank);
 * it never reads origin/provider, so vendor neutrality is preserved.
 */
export function intentRelevanceBonus(
  ep: EndpointRecord,
  intent: IntentPorts,
): number {
  let bonus = 0;

  const consumes = intent.consumes ?? [];
  if (consumes.length) {
    const inputs = (ep.inputs ?? []).map((i) => i.toLowerCase());
    const inputSet = new Set(inputs);
    const haystack = `${ep.path} ${ep.summary} ${ep.description ?? ""}`.toLowerCase();
    const primaryEntity = ep.facets?.primary_entity;

    for (const port of consumes) {
      const tokens = entityInputTokens(port.entity);
      // Strong corroboration: a declared input parameter names the entity.
      if (tokens.some((t) => inputSet.has(t))) {
        bonus += 4;
        continue;
      }
      // Weaker corroboration: the entity surfaces in path/summary/description.
      if (tokens.some((t) => haystack.includes(t))) {
        bonus += 2;
      }
      // Derived primary_entity agreement is independent additional evidence.
      if (primaryEntity && primaryEntity === port.entity) {
        bonus += 2;
      }
    }
  }

  const producedEntity = intent.produces?.[0]?.entity;
  const outputEntity = ep.facets?.output_entity;
  if (producedEntity && outputEntity && producedEntity === outputEntity) {
    bonus += 3;
  }

  return bonus;
}

/**
 * Neutral endpoint quality score for agent selection among candidates.
 * Uses only index metadata (description, inputs, payment, guidance) — never
 * origin, provider_fqn, or vendor-specific path fragments.
 *
 * When `intent` is supplied, the neutral prior is blended with a per-intent
 * input-identifier-overlap term (see intentRelevanceBonus). Without an intent
 * the score is byte-identical to the neutral-only prior, so callers that do not
 * pass an intent keep their existing behavior.
 */
export function scoreEndpointNeutral(
  ep: EndpointRecord,
  intent?: IntentPorts,
): number {
  if (isGenericEndpoint(ep)) return -100;

  let score = 0;
  if (ep.description && ep.description.length > 20) score += 3;
  if (ep.inputs?.length) score += Math.min(ep.inputs.length, 5);
  if (ep.payment.price_usd != null) score += 2;
  if (ep.payment.paid) score += 1;
  if (ep.guidance_available) score += 2;
  if (ep.openapi_url) score += 1;

  const depth = ep.path.split("/").filter(Boolean).length;
  score += Math.max(0, 6 - depth);

  if (ep.summary.length > 12) score += 1;

  if (intent) score += intentRelevanceBonus(ep, intent);

  return score;
}

export function rankEndpointsNeutral(
  endpoints: EndpointRecord[],
  max = 12,
  intent?: IntentPorts,
): EndpointRecord[] {
  const paid = endpoints.filter((e) => e.payment.paid || e.payment.rails.length);
  const pool = paid.length ? paid : endpoints;

  return [...pool]
    .sort((a, b) => scoreEndpointNeutral(b, intent) - scoreEndpointNeutral(a, intent))
    .slice(0, max);
}
