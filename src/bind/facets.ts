// Endpoint facet derivation. (The legacy `cli.js build` heuristic index — buildIndex + the
// pay-skills/scan ingest helpers — was removed; production builds via `ingest → enrich`. This
// module now only caches path/summary signal as structured facets, used by enrich-facets.)
import type { EndpointFacets, EndpointRecord, FacetDomain, FacetModality } from "../core/types.js";

/**
 * Map an endpoint `category` (provider-supplied) onto a facet domain. Categories
 * use a slightly different vocabulary than the facet enum, so a few are aliased.
 */
const CATEGORY_DOMAIN: Record<string, FacetDomain> = {
  shop: "commerce",
  shopping: "commerce",
  commerce: "commerce",
  ai: "ai",
  ai_ml: "ai",
  data: "data",
  web: "web",
  comms: "comms",
  messaging: "comms",
  finance: "finance",
  maps: "maps",
  travel: "travel",
  realestate: "realestate",
  social: "social",
  media: "media",
  marketing: "commerce",
  analyst: "commerce",
  cloud: "cloud",
  compute: "compute",
  devtools: "devtools",
  storage: "cloud",
  search: "web",
  crypto: "blockchain",
  blockchain: "blockchain",
  identity: "identity",
  agent: "agent",
  utility: "utility",
  science: "science",
  health: "science",
  medical: "science",
  pharma: "science",
  gov: "gov",
  government: "gov",
  translation: "ai",
  security: "devtools",
};

/**
 * Domain inference by keyword over the endpoint corpus. Ordered most-specific
 * first; the first axis whose pattern matches wins. Vocabulary is grounded in
 * the facet `domain` enum.
 */
const DOMAIN_KEYWORDS: Array<[FacetDomain, RegExp]> = [
  ["blockchain", /\b(crypto|blockchain|onchain|on-chain|wallet|token|erc20|evm|solana|ethereum|rpc|web3|nft|airdrop|defi|gas price)\b/],
  ["finance", /\b(stock|ticker|equity|forex|exchange[- ]?rate|quote|market|fmv|sec filing)\b/],
  ["identity", /\b(company enrich|firmographic|people search|person lookup|contact enrich|kyc|kyb|entity resolution|business registry)\b/],
  ["gov", /\b(government|\bgov\b|civic|voter|election|elected official|legislat|regulatory|\blei\b|legal entity identifier|public record)\b/],
  ["science", /\b(scientific|research paper|genome|\bgene\b|protein|chemistry|compound|\bdrug\b|pharma|medication|clinical|agricultur|\bcrop\b|usda)\b/],
  ["commerce", /\b(price|retail|product|sku|deal|cart|checkout|store|merchant|coupon|competitive|inflation|e-commerce)\b/],
  ["comms", /\b(email|sms|fax|inbox|mailbox|voice call|messaging|send a message)\b/],
  ["maps", /\b(map|geocode|geocoding|places?|route|directions|latitude|longitude|address lookup)\b/],
  ["travel", /\b(travel|hotel|flight|reviews?|itinerary|booking)\b/],
  ["realestate", /\b(real estate|property|listing|mls|rent|mortgage|zillow)\b/],
  ["social", /\b(influencer|follower|social profile|instagram|tiktok|twitter|x\.com)\b/],
  ["media", /\b(media|video|podcast|broadcast|streaming|anime|movie|book|isbn|news|headline|sports? score)\b/],
  ["web", /\b(scrape|crawl|markdown|screenshot|webpage|render page|html|web page|serp|search engine|web search|results page)\b/],
  ["ai", /\b(llm|completion|prompt|embedding|generate|ocr|transcribe|speech|text-to|image generat|chat model|translate|moderat)\b/],
  ["cloud", /\b(domain register|dns|provision|hosting|deploy|nameserver|bucket|file upload|object store|cdn)\b/],
  ["compute", /\b(compute|sandbox|execute code|serverless|function run|convert unit|calculator)\b/],
  ["utility", /\b(validate (email|phone|address)|email valid|phone valid|\biban\b|vat number|format convert|checksum)\b/],
  ["devtools", /\b(captcha|proxy|webhook|developer tool|api key|code repo|github|repository|ip address|ip lookup|whois)\b/],
  ["agent", /\b(agent memory|agent marketplace|context store|agent registry)\b/],
  ["data", /\b(lookup|enrich|weather|forecast|holiday|calendar|job|hiring)\b/],
];

/**
 * Output entity inference by keyword. Result is an entity name from
 * spec/entity-vocab.json (closed vocabulary).
 */
const OUTPUT_ENTITY_KEYWORDS: Array<[string, RegExp]> = [
  ["PriceSignal", /\b(price|deal|cheapest|lowest price|inflation|price history)\b/],
  ["MarketQuote", /\b(stock quote|spot price|exchange rate|ticker|market quote)\b/],
  ["CitedAnswer", /\b(cited|citation|with sources|research answer)\b/],
  ["SearchResults", /\b(serp|search results|results page|web search)\b/],
  ["WebContent", /\b(scrape|markdown|html|page content|article text)\b/],
  ["Image", /\b(screenshot|image|render|png|jpeg|photo generat)\b/],
  ["AudioClip", /\b(speech|tts|text-to-speech|audio|voice synth)\b/],
  ["Text", /\b(transcribe|speech-to-text|ocr|translate|extract text)\b/],
  ["StructuredRecord", /\b(document extract|structured|fields|parse|json output)\b/],
  ["Embedding", /\b(embedding|vector|embed text)\b/],
  ["Message", /\b(send (an )?(email|sms|fax)|deliver message|outbound)\b/],
  ["Place", /\b(places?|local business|reviews?|venue)\b/],
  ["Company", /\b(company|organization|firm|business enrich)\b/],
  ["Person", /\b(person|people search|contact enrich)\b/],
  ["SocialProfile", /\b(influencer|social profile|follower)\b/],
  ["DnsRecord", /\b(whois|dns|nameserver|domain record)\b/],
  ["Answer", /\b(answer|compute answer|llm|completion|chat)\b/],
];

/**
 * Primary (input) entity inference by keyword over path + inputs. Result is an
 * entity name from the closed vocabulary.
 */
const PRIMARY_ENTITY_KEYWORDS: Array<[string, RegExp]> = [
  ["Webpage", /\b(url|webpage|web page|website|scrape|crawl|render)\b/],
  ["Document", /\b(document|pdf|file extract|invoice)\b/],
  ["Image", /\b(image|photo|ocr|screenshot input)\b/],
  ["AudioClip", /\b(audio|speech|recording|transcribe)\b/],
  ["Product", /\b(product|sku|item|airpods|asin)\b/],
  ["Ticker", /\b(ticker|symbol|stock)\b/],
  ["CryptoAsset", /\b(coin|crypto|token symbol)\b/],
  ["WalletAddress", /\b(wallet|address balance|0x)\b/],
  ["Currency", /\b(currency|exchange rate|fx)\b/],
  ["Contact", /\b(email address|phone number|recipient)\b/],
  ["Location", /\b(location|address|geocode|lat|lng|coordinates)\b/],
  ["Domain", /\b(domain|whois|dns)\b/],
  ["IpAddress", /\bip\b|\bip address\b/],
  ["Company", /\b(company|organization|firm)\b/],
  ["Person", /\b(person|people|name lookup)\b/],
  ["Query", /\b(query|search|q=|keyword|prompt)\b/],
];

const MODALITY_KEYWORDS: Array<[FacetModality, RegExp]> = [
  ["markdown", /\bmarkdown\b/],
  ["html", /\bhtml\b/],
  ["image", /\b(image|screenshot|png|jpeg|photo)\b/],
  ["audio", /\b(audio|speech|voice|tts)\b/],
  ["citations", /\b(citation|cited|sources)\b/],
  ["vector", /\b(embedding|vector)\b/],
  ["timeseries", /\b(history|time series|timeseries|historical|trend)\b/],
  ["json", /\b(json|structured|fields)\b/],
  ["text", /\b(text|markdown|transcribe|translate)\b/],
];

function firstMatch<T>(corpus: string, table: Array<[T, RegExp]>): T | undefined {
  for (const [value, pattern] of table) {
    if (pattern.test(corpus)) return value;
  }
  return undefined;
}

/**
 * Derive cached facets for an endpoint from its path + summary + description +
 * inputs + category. Honest framing: this caches the existing path/summary
 * signal as structured facets — it is not new information. Domain/entity/modality
 * vocabulary is the same closed set used by curated intents.
 */
export function deriveEndpointFacets(ep: EndpointRecord): EndpointRecord {
  const corpus = [
    ep.path,
    ep.summary,
    ep.description ?? "",
    (ep.inputs ?? []).join(" "),
    ep.category ?? "",
  ]
    .join(" ")
    .toLowerCase();

  const domain: FacetDomain | undefined =
    (ep.category ? CATEGORY_DOMAIN[ep.category.toLowerCase()] : undefined) ??
    firstMatch(corpus, DOMAIN_KEYWORDS);
  const primary_entity = firstMatch(corpus, PRIMARY_ENTITY_KEYWORDS);
  const output_entity = firstMatch(corpus, OUTPUT_ENTITY_KEYWORDS);
  const modality = MODALITY_KEYWORDS.filter(([, re]) => re.test(corpus)).map(
    ([m]) => m,
  );

  const facets: EndpointFacets = {};
  if (domain) facets.domain = domain;
  if (primary_entity) facets.primary_entity = primary_entity;
  if (output_entity) facets.output_entity = output_entity;
  if (modality.length) facets.modality = modality;

  if (Object.keys(facets).length === 0) return ep;
  return { ...ep, facets };
}
