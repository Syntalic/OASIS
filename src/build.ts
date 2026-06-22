import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { materializeCuratedIntents } from "./materialize-satisfies.js";
import { linkCapabilitiesToEndpoints, loadOntologySources } from "./ontology.js";
import {
  expandOntologyFromProviders,
  inferCapabilityLinks,
} from "./ontology-expand.js";
import { isStubEndpoint } from "./openapi-fetch.js";
import { parseOpenApi } from "./openapi-parser.js";
import { ingestMppCatalog } from "./ingest/mpp-catalog.js";
import { ingestScanSitemap } from "./ingest/scan-sitemap.js";
import { ingestPaySkills } from "./pay-skills.js";
import { buildProviderRecords, enrichEndpointsWithProviders } from "./providers.js";
import type {
  CapabilityLink,
  CuratedIntentSource,
  EndpointFacets,
  EndpointRecord,
  FacetDomain,
  FacetModality,
  IndexBundle,
  PaySkillsProvider,
} from "./types.js";
import { validateBundle } from "./validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");
const SPEC_VERSION = "0.1.0";
const INDEX_VERSION = "0.1.0";

/**
 * Map an endpoint `category` (provider-supplied) onto a facet domain. Categories
 * use a slightly different vocabulary than the facet enum, so a few are aliased.
 */
const CATEGORY_DOMAIN: Record<string, FacetDomain> = {
  shop: "shop",
  shopping: "shop",
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
  marketing: "marketing",
  analyst: "analyst",
  cloud: "cloud",
  compute: "compute",
  devtools: "devtools",
  storage: "storage",
  search: "search",
  crypto: "crypto",
  blockchain: "crypto",
  translation: "data",
  security: "devtools",
};

/**
 * Domain inference by keyword over the endpoint corpus. Ordered most-specific
 * first; the first axis whose pattern matches wins. Vocabulary is grounded in
 * the facet `domain` enum.
 */
const DOMAIN_KEYWORDS: Array<[FacetDomain, RegExp]> = [
  ["crypto", /\b(crypto|blockchain|onchain|on-chain|wallet|token|erc20|evm|solana|ethereum|rpc|web3)\b/],
  ["finance", /\b(stock|ticker|equity|forex|exchange[- ]?rate|quote|market|fmv|sec filing)\b/],
  ["shop", /\b(price|retail|product|sku|deal|cart|checkout|store|merchant|coupon)\b/],
  ["comms", /\b(email|sms|fax|inbox|mailbox|voice call|messaging|send a message)\b/],
  ["maps", /\b(map|geocode|geocoding|places?|route|directions|latitude|longitude|address lookup)\b/],
  ["travel", /\b(travel|hotel|flight|reviews?|itinerary|booking)\b/],
  ["realestate", /\b(real estate|property|listing|mls|rent|mortgage|zillow)\b/],
  ["social", /\b(influencer|follower|social profile|instagram|tiktok|twitter|x\.com)\b/],
  ["media", /\b(media|video|podcast|broadcast|streaming)\b/],
  ["marketing", /\b(marketing|campaign|brand|competitive|seo|advertis)\b/],
  ["search", /\b(serp|search engine|google search|web search|results page)\b/],
  ["web", /\b(scrape|crawl|markdown|screenshot|webpage|render page|html|web page)\b/],
  ["ai", /\b(llm|completion|prompt|embedding|generate|ocr|transcribe|speech|text-to|image generat|chat model)\b/],
  ["cloud", /\b(domain register|dns|provision|hosting|deploy|nameserver)\b/],
  ["compute", /\b(compute|sandbox|execute code|serverless|function run)\b/],
  ["devtools", /\b(captcha|proxy|webhook|developer tool|api key)\b/],
  ["storage", /\b(storage|bucket|file upload|object store|cdn)\b/],
  ["analyst", /\b(inflation|index|trend|analytics|forecast|aggregate)\b/],
  ["data", /\b(lookup|enrich|validate|whois|ip|weather|translate|person|company|job)\b/],
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

/**
 * Coerce a legacy `related[]` list into `links[]` of type `sibling_of`, merging
 * with any authored links and dropping duplicate targets (authored links win).
 * Used during materialization to give the deprecated `related[]` a typed home.
 */
export function coerceRelatedToLinks(
  source: Pick<CuratedIntentSource, "links" | "related">,
): CapabilityLink[] | undefined {
  const authored = source.links ?? [];
  const seen = new Set(authored.map((l) => `${l.type}:${l.to}`));
  const coerced: CapabilityLink[] = [...authored];
  for (const to of source.related ?? []) {
    const key = `sibling_of:${to}`;
    // Skip if an authored link of any type already targets `to`.
    if (seen.has(key) || authored.some((l) => l.to === to)) continue;
    seen.add(key);
    coerced.push({ type: "sibling_of", to });
  }
  return coerced.length ? coerced : undefined;
}

export interface BuildOptions {
  paySkillsDir?: string;
  openapiFile?: string;
  origin?: string;
  outputDir?: string;
  ontologyDir?: string;
  /** Ingest x402scan.com server sitemap + per-origin OpenAPI (default: true). */
  x402scan?: boolean;
  /** Ingest mppscan.com server sitemap + mpp.dev catalog (default: true). */
  mppscan?: boolean;
  maxScanServers?: number;
  skipPaySkills?: boolean;
}

function mergeEndpointPair(
  existing: EndpointRecord,
  ep: EndpointRecord,
): EndpointRecord {
  const prefer =
    isStubEndpoint(existing) && !isStubEndpoint(ep)
      ? ep
      : !isStubEndpoint(existing) && isStubEndpoint(ep)
        ? existing
        : ep;
  const other = prefer === ep ? existing : ep;
  const railKey = (r: { protocol: string }) => r.protocol;
  const rails = [...existing.payment.rails, ...ep.payment.rails];
  const railsDeduped = [...new Map(rails.map((r) => [railKey(r), r])).values()];
  return {
    ...other,
    ...prefer,
    capabilities: [
      ...new Set([...(existing.capabilities ?? []), ...(ep.capabilities ?? [])]),
    ],
    provider_fqn: existing.provider_fqn ?? ep.provider_fqn,
    provider_title: prefer.provider_title ?? other.provider_title,
    category: prefer.category ?? other.category,
    summary:
      prefer.summary.length >= other.summary.length ? prefer.summary : other.summary,
    description: prefer.description ?? other.description,
    inputs: prefer.inputs?.length ? prefer.inputs : other.inputs,
    operation_id: prefer.operation_id ?? other.operation_id,
    tags: prefer.tags?.length ? prefer.tags : other.tags,
    guidance_available: prefer.guidance_available || other.guidance_available,
    openapi_url: prefer.openapi_url ?? other.openapi_url,
    payment: {
      paid: existing.payment.paid || ep.payment.paid,
      price_usd: prefer.payment.price_usd ?? other.payment.price_usd,
      rails: railsDeduped.length ? railsDeduped : existing.payment.rails,
    },
    search_text: `${existing.search_text} ${ep.search_text}`.trim(),
  };
}

function dedupeEndpoints(endpoints: EndpointRecord[]): EndpointRecord[] {
  const map = new Map<string, EndpointRecord>();
  for (const ep of endpoints) {
    const existing = map.get(ep.id);
    map.set(ep.id, existing ? mergeEndpointPair(existing, ep) : ep);
  }
  return [...map.values()].sort((a, b) =>
    `${a.origin}${a.path}`.localeCompare(`${b.origin}${b.path}`),
  );
}

export async function buildIndex(options: BuildOptions = {}): Promise<IndexBundle> {
  const builtAt = new Date().toISOString();
  const outputDir = options.outputDir ?? path.join(PACKAGE_ROOT, "dist");
  const ontologyDir =
    options.ontologyDir ?? path.join(PACKAGE_ROOT, "ontology", "intents");
  const curatedSources = await loadOntologySources(ontologyDir);

  const sources: IndexBundle["sources"] = [];
  let endpoints: EndpointRecord[] = [];
  let paySkillsProviders: PaySkillsProvider[] = [];

  const useScans = options.x402scan !== false || options.mppscan !== false;

  const paySkillsDir =
    options.skipPaySkills || options.openapiFile
      ? options.paySkillsDir
      : (options.paySkillsDir ?? defaultPaySkillsPath());

  if (paySkillsDir) {
    try {
      await access(paySkillsDir);
      const ingested = await ingestPaySkills(paySkillsDir, builtAt);
      paySkillsProviders = ingested.providers;
      endpoints.push(...ingested.endpoints);
      sources.push({
        name: "pay-skills",
        path: paySkillsDir,
        providers: ingested.providers.length,
        endpoints: ingested.endpoints.length,
      });
    } catch (err) {
      console.warn(
        `pay-skills ingest skipped (${paySkillsDir}): ${(err as Error).message}`,
      );
    }
  }

  if (options.mppscan !== false) {
    try {
      const mpp = await ingestMppCatalog(builtAt);
      endpoints.push(...mpp);
      sources.push({
        name: "mpp-catalog",
        path: "https://mpp.dev/api/services",
        endpoints: mpp.length,
      });
    } catch (err) {
      console.warn(`mpp catalog ingest failed: ${(err as Error).message}`);
    }
  }

  if (options.x402scan !== false && useScans) {
    try {
      const x402 = await ingestScanSitemap({
        sitemapUrl: "https://www.x402scan.com/sitemap.xml",
        sourceName: "x402scan",
        builtAt,
        maxServers: options.maxScanServers,
        fetchOpenApi: true,
      });
      endpoints.push(...x402.endpoints);
      sources.push({
        name: "x402scan",
        path: "https://www.x402scan.com/sitemap.xml",
        providers: x402.origins,
        endpoints: x402.endpoints.length,
      });
      console.log(
        `  x402scan: ${x402.servers} servers → ${x402.origins} origins → ${x402.endpoints.length} endpoints`,
      );
    } catch (err) {
      console.warn(`x402scan ingest failed: ${(err as Error).message}`);
    }
  }

  if (options.mppscan !== false && useScans) {
    try {
      const mppScan = await ingestScanSitemap({
        sitemapUrl: "https://www.mppscan.com/sitemap.xml",
        sourceName: "mppscan",
        builtAt,
        maxServers: options.maxScanServers,
        fetchOpenApi: true,
      });
      endpoints.push(...mppScan.endpoints);
      sources.push({
        name: "mppscan",
        path: "https://www.mppscan.com/sitemap.xml",
        providers: mppScan.origins,
        endpoints: mppScan.endpoints.length,
      });
      console.log(
        `  mppscan: ${mppScan.servers} servers → ${mppScan.origins} origins → ${mppScan.endpoints.length} endpoints`,
      );
    } catch (err) {
      console.warn(`mppscan ingest failed: ${(err as Error).message}`);
    }
  }

  if (options.openapiFile) {
    const raw = await readFile(options.openapiFile, "utf8");
    const doc = JSON.parse(raw) as Record<string, unknown>;
    const parsed = parseOpenApi(doc, {
      origin: options.origin,
      builtAt,
    });
    endpoints.push(...parsed);
    sources.push({
      name: "openapi",
      path: options.openapiFile,
      endpoints: parsed.length,
    });
  }

  endpoints = dedupeEndpoints(endpoints);

  const providers = buildProviderRecords(endpoints, paySkillsProviders);
  enrichEndpointsWithProviders(endpoints, providers);

  let capabilities = materializeCuratedIntents(curatedSources, endpoints);
  const emptyCurated = capabilities.filter((c) => c.satisfies.length === 0);
  if (emptyCurated.length) {
    console.warn(
      `  curated intents with 0 candidates: ${emptyCurated.map((c) => c.id).join(", ")}`,
    );
  }
  const curatedLinks = capabilities.reduce((n, c) => n + c.satisfies.length, 0);
  console.log(
    `  materialized ${capabilities.length} curated intents → ${curatedLinks} endpoint candidates`,
  );
  capabilities = expandOntologyFromProviders(
    capabilities,
    paySkillsProviders,
    endpoints,
  );

  const endpointIndex = new Map<string, EndpointRecord>();
  for (const ep of endpoints) {
    endpointIndex.set(`${ep.origin}|${ep.method}|${ep.path}`, ep);
  }
  linkCapabilitiesToEndpoints(capabilities, endpointIndex);
  const capabilityLinks = inferCapabilityLinks(capabilities, endpointIndex);
  endpoints = [...endpointIndex.values()]
    .map(deriveEndpointFacets)
    .sort((a, b) => `${a.origin}${a.path}`.localeCompare(`${b.origin}${b.path}`));

  // Re-materialize curated satisfies[] now that endpoint.capabilities is populated
  // (linkCapabilitiesToEndpoints, above). The first pass at materialize time ran
  // BEFORE linking, so it fell back to the low-precision regex matchers — which
  // bound e.g. college/OSHA/geocoding endpoints to data.weather_forecast. The
  // capabilities binding is far cleaner; swap in only the improved satisfies (this
  // is the in-build equivalent of the offline enrich-facets re-pass).
  const rematerializedSatisfies = new Map(
    materializeCuratedIntents(curatedSources, endpoints).map((c) => [c.id, c.satisfies]),
  );
  for (const cap of capabilities) {
    const better = rematerializedSatisfies.get(cap.id);
    if (better && better.length) cap.satisfies = better;
  }

  const origins = new Set(endpoints.map((e) => e.origin));
  const stubEndpoints = endpoints.filter(isStubEndpoint).length;
  const linkedEndpoints = endpoints.filter((e) => e.capabilities?.length).length;

  const bundle: IndexBundle = {
    index_version: INDEX_VERSION,
    spec_version: SPEC_VERSION,
    built_at: builtAt,
    sources,
    stats: {
      providers: providers.length,
      endpoints: endpoints.length,
      capabilities: capabilities.length,
      origins: origins.size,
      capability_links: linkedEndpoints,
      stub_endpoints: stubEndpoints,
    },
    endpoints,
    capabilities,
    providers,
  };

  const issues = await validateBundle(bundle);
  if (issues.length > 0) {
    console.warn("Validation warnings:");
    for (const issue of issues) console.warn(`  - ${issue}`);
  }

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, "index.json"),
    JSON.stringify(bundle, null, 2),
  );
  await writeFile(
    path.join(outputDir, "endpoints.json"),
    JSON.stringify(
      {
        index_version: bundle.index_version,
        spec_version: bundle.spec_version,
        built_at: bundle.built_at,
        stats: bundle.stats,
        endpoints: bundle.endpoints,
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(outputDir, "capabilities.json"),
    JSON.stringify(
      {
        index_version: bundle.index_version,
        spec_version: bundle.spec_version,
        built_at: bundle.built_at,
        capabilities: bundle.capabilities,
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(outputDir, "providers.json"),
    JSON.stringify(
      {
        index_version: bundle.index_version,
        spec_version: bundle.spec_version,
        built_at: bundle.built_at,
        stats: { providers: providers.length },
        providers: bundle.providers,
      },
      null,
      2,
    ),
  );

  return bundle;
}

export function defaultPaySkillsPath(): string | undefined {
  return path.join(PACKAGE_ROOT, "..", "..", "crush", "api", "pay-skills");
}