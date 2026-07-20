/**
 * Entity → request-parameter token helpers.
 *
 * Tokens corroborate typed ports against endpoint `inputs[]` / path / summary
 * (see intentRelevanceBonus). Base tokens are vendor-neutral hardcoded fallbacks;
 * optional entity-vocab `properties[].name|aliases` enrich them so the closed
 * vocabulary is the single source of field-level truth.
 */

export interface EntityProperty {
  name: string;
  type?: "string" | "number" | "integer" | "boolean" | "enum" | "date" | "datetime";
  is_identifier?: boolean;
  aliases?: string[];
  description?: string;
  values?: string[];
}

export interface EntityVocabDef {
  role?: string;
  kind?: "identity" | "observation" | "abstract";
  bridge_eligible?: boolean;
  deprecated?: boolean;
  absorbed_by?: string;
  absorbs?: string[];
  schema_org?: string[];
  properties?: EntityProperty[];
}

/** Hardcoded baseline — used when vocab has no properties (or for unit tests offline). */
export const BASE_ENTITY_INPUT_TOKENS: Record<string, string[]> = {
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
  Place: ["place", "location", "city", "lat", "lon", "lng", "latitude", "longitude", "address"],
  Company: ["company", "organization", "org", "business", "domain"],
  Person: ["person", "name", "people", "fullname", "full_name"],
  CryptoAsset: ["coin", "token", "asset", "symbol", "currency"],
  WalletAddress: ["address", "wallet", "wallet_address", "account", "holder"],
  BlockchainNetwork: ["chain", "network", "blockchain", "chain_id", "rpc"],
  Ticker: ["ticker", "symbol", "stock", "equity"],
  Domain: ["domain", "hostname", "host", "fqdn"],
  IpAddress: ["ip", "ip_address", "ipaddress", "addr"],
};

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Flatten property names + aliases into lowercase input tokens. */
export function tokensFromProperties(properties: EntityProperty[] | undefined): string[] {
  if (!properties?.length) return [];
  const out: string[] = [];
  for (const p of properties) {
    if (p.name) out.push(normalizeToken(p.name));
    for (const a of p.aliases ?? []) out.push(normalizeToken(a));
  }
  return [...new Set(out.filter(Boolean))];
}

/**
 * Merge base tokens with vocab property aliases. Property tokens never *remove*
 * base coverage — only extend it — so scoring never regresses when properties are added.
 */
export function buildEntityInputTokens(
  vocab?: Record<string, EntityVocabDef>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, tokens] of Object.entries(BASE_ENTITY_INPUT_TOKENS)) {
    out[name] = [...tokens];
  }
  if (!vocab) return out;
  for (const [name, def] of Object.entries(vocab)) {
    const fromProps = tokensFromProperties(def.properties);
    if (!fromProps.length) continue;
    out[name] = [...new Set([...(out[name] ?? []), ...fromProps])];
  }
  return out;
}

/** Identifier properties for an entity (is_identifier === true, or first property as fallback). */
export function identifierProperties(def: EntityVocabDef | undefined): EntityProperty[] {
  if (!def?.properties?.length) return [];
  const ids = def.properties.filter((p) => p.is_identifier);
  return ids.length ? ids : [];
}
