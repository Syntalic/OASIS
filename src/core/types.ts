export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

/** A JSON Schema (2020-12) object. Advisory: captured from a provider source, may be stale. */
export type JsonSchema = Record<string, unknown>;

export interface PaymentRail {
  protocol: "x402" | "mpp";
  version?: string;
  networks?: string[];
}

/** A single payment offer (draft-payment-discovery-00 x-payment-info.offers[]). */
export interface PaymentOffer {
  /** "charge" (per-request) or "session" (pay-as-you-go). */
  intent: "charge" | "session";
  /** Payment method identifier (e.g. "tempo", "stripe", "x402"). */
  method: string;
  /** Cost in base currency units (integer string), or null for dynamic pricing. */
  amount: string | null;
  /** Token contract address (blockchain methods) or ISO-4217 code (fiat). */
  currency?: string;
  description?: string;
}

/** Merchant wallet declared in OpenAPI (not live-verified). */
export interface DeclaredPayTo {
  payTo: string;
  network?: string;
  asset?: string;
  /** Where it was found, e.g. "x-faremeter-assets.recipient", "x-payment-info.payTo". */
  source?: string;
}

export interface PaymentInfo {
  /** Derived convenience: cheapest charge offer expressed in USD. */
  price_usd?: number;
  paid: boolean;
  rails: PaymentRail[];
  /** Canonical multi-offer payment terms parsed from x-payment-info. */
  offers?: PaymentOffer[];
  /** Currency of the offer used to derive price_usd. */
  currency?: string;
  live_challenge?: LiveChallenge[];
  /**
   * Merchant wallets scraped from OpenAPI extensions (recipient / payTo / pay_to /
   * faremeter assets, nested x-402, …). Used for usage ranking when live_challenge
   * is missing; never confuses token contracts with merchants.
   */
  declared_pay_tos?: DeclaredPayTo[];
}

/** A live payment requirement captured from an unpaid probe's 402 (advisory — re-fetch before paying). */
export interface LiveAccept {
  scheme?: string; network?: string; asset?: string; payTo?: string;
  amount?: string; maxAmountRequired?: string; extra?: Record<string, unknown>;
}
export interface LiveChallenge {
  protocol: "x402" | "mpp";
  accepts?: LiveAccept[];          // x402: validated body accepts
  www_authenticate?: string;       // mpp: raw WWW-Authenticate header (bounded)
  method?: string; intent?: string; realm?: string; // mpp: parsed Payment-scheme params
}

/** Facet enum axes (mirror spec/ontology-source.schema.json). */
export type FacetDomain =
  | "commerce"
  | "ai"
  | "data"
  | "web"
  | "comms"
  | "finance"
  | "maps"
  | "travel"
  | "realestate"
  | "social"
  | "media"
  | "cloud"
  | "compute"
  | "devtools"
  | "blockchain"
  | "identity"
  | "agent"
  | "utility"
  | "science"
  | "gov";

export type FacetAction =
  | "search"
  | "lookup"
  | "compare"
  | "extract"
  | "generate"
  | "transform"
  | "validate"
  | "send"
  | "provision"
  | "analyze"
  | "execute"
  | "monitor";

export type FacetModality =
  | "text"
  | "html"
  | "markdown"
  | "json"
  | "image"
  | "audio"
  | "vector"
  | "citations"
  | "timeseries";

export type FacetFreshness =
  | "realtime"
  | "recent"
  | "historical"
  | "forecast"
  | "static";

/** Query-side facets on an intent. */
export interface Facets {
  domain?: FacetDomain;
  action?: FacetAction;
  modality?: FacetModality[];
  freshness?: FacetFreshness;
}

/** Typed input/output noun (entity from spec/entity-vocab.json). */
export interface Port {
  entity: string;
  role?: "identifier" | "payload" | "constraint";
  format?: string;
  cardinality?: "one" | "many";
}

/**
 * Optional field on a vocab entity (spec/entity-vocab.json properties[]).
 * Progressive: high-traffic identities get structure for scoring + field maps.
 */
export interface EntityProperty {
  name: string;
  type?: "string" | "number" | "integer" | "boolean" | "enum" | "date" | "datetime";
  is_identifier?: boolean;
  aliases?: string[];
  description?: string;
  values?: string[];
}

/**
 * Curated entity-property → HTTP request field mapping (ontology/bindings field_maps).
 * Lets agents prefill bodies from typed entities without guessing OpenAPI param names.
 */
export interface FieldMap {
  entity: string;
  property: string;
  in: "path" | "query" | "header" | "body";
  /** Parameter name or JSON path relative to that location (e.g. "symbol", "$.domain"). */
  path: string;
}

/** Typed intent↔intent edge. */
export interface CapabilityLink {
  type:
    | "alternative_of"
    | "sibling_of"
    | "pipes_to"
    | "fed_by"
    | "narrower_of"
    | "broader_of";
  to: string;
  note?: string;
}

/** Derived per-endpoint facets caching the path/summary/inputs signal. */
export interface EndpointFacets {
  domain?: FacetDomain;
  /** Task verb, mirroring the intent-side FacetAction enum. NOT produced by the regex deriver
   *  (deriveEndpointFacets) — only set from the authored label set, so its mere presence implies
   *  a trusted (authored) classification the binding gates may act on. */
  action?: FacetAction;
  primary_entity?: string;
  output_entity?: string;
  modality?: FacetModality[];
  /** True when this endpoint's facets come from the authored override set rather than the noisy
   *  regex deriver. The domain gate fires ONLY when this is set (regex domains are too noisy to
   *  gate on corpus-wide — see docs/proposals/binding-precision.md). */
  authored?: boolean;
}

/** Service-level metadata from the OpenAPI root x-service-info extension. */
export interface ServiceInfo {
  categories?: string[];
  docs?: {
    apiReference?: string;
    homepage?: string;
    llms?: string;
  };
}

/**
 * On-chain demand snapshot for ranking (origin/payTo-level, shared by endpoints).
 *
 * Two enrichment stages (see enrich-usage.ts):
 *   • stage "activity" — minimal free probe: any inbound transfer / signature at all?
 *   • stage "volume"   — deeper windowed volume/buyers for ranking (later / Dune)
 *
 * Wallets are almost always **service-level** (one payTo shared by many endpoints of
 * an origin). Endpoint.usage is that wallet snapshot stamped onto every endpoint
 * that advertises it — de facto service demand, not per-path revenue.
 */
export interface UsageSnapshot {
  /**
   * Stage-1: false = wallet has no observed on-chain activity (dead for ranking).
   * true = at least one transfer/signature seen. Undefined if never probed.
   */
  active?: boolean;
  /** Which enrich pass last wrote this snapshot. */
  stage?: "activity" | "volume";
  /** Estimated inbound stablecoin volume in USD (stage "volume"). */
  volume_usd?: number;
  /** Transfer / payment event count (stage activity may set 0 or ≥1 only). */
  transactions?: number;
  /** Distinct payer addresses (stage "volume"). */
  unique_buyers?: number;
  /** Window length in days the counts cover (undefined = unbounded sample). */
  window_days?: number;
  observed_at: string;
  /** Free public source(s) used. */
  source: "base-blockscout" | "solana-rpc" | "mixed" | "bazaar" | "dune";
  /** Merchant wallets that contributed to this snapshot. */
  pay_tos?: string[];
}

export interface EndpointRecord {
  id: string;
  origin: string;
  method: HttpMethod;
  path: string;
  operation_id?: string;
  summary: string;
  description?: string;
  tags?: string[];
  provider_fqn?: string;
  provider_title?: string;
  category?: string;
  capabilities?: string[];
  inputs?: string[];
  facets?: EndpointFacets;
  payment: PaymentInfo;
  service?: ServiceInfo;
  /**
   * On-chain usage / revenue proxy from merchant payTo wallets (post-verify enrich).
   * Origin-level snapshot; ranking uses log-compressed volume as a task-fit-gated term.
   */
  usage?: UsageSnapshot;
  /** Declared responses presence; draft-payment-discovery-00 requires 402 on payable ops. */
  responses?: { has200?: boolean; has402?: boolean };
  /** Payable operation lacking a requestBody schema (the spec's "schema-missing"). */
  schema_missing?: boolean;
  guidance_available?: boolean;
  openapi_url?: string;
  /** sha256 ref into dist/schemas.json for the normalized input schema (JSON Schema 2020-12). */
  input_schema_ref?: string;
  /** sha256 ref into dist/schemas.json for the normalized output (2xx) schema. */
  output_schema_ref?: string;
  /** Which crawled source the schema came from. */
  schema_source?: "openapi" | "bazaar";
  /** When the schema was captured (advisory freshness). */
  schema_captured_at?: string;
  /** True when the source schema exceeded the size/depth cap and was dropped. */
  schema_truncated?: boolean;
  /** Live-probe verdict: the endpoint actually issues (verified) / lies about (contradicted) /
   *  couldn't be confirmed (unknown) a payment challenge. Advisory; runtime 402 authoritative. */
  payment_verified?: "verified" | "contradicted" | "unknown";
  payment_verified_at?: string;
  search_text: string;
  /** Ingest-time local keyphrases (spaCy noun-chunks/POS, lemmatized) — powers the serve-time
   *  keyword-relevance match (string ops only; no live model). See scripts/keyx/enrich_keyphrases.py. */
  keyphrases?: string[];
  /** # of distinct curated intents this endpoint's host is bound to — a catch-all/precision
   *  signal. A host bound to 50+ intents (2s.io, agentutility) is a generic multi-tool whose
   *  broad endpoints flood specialist buckets; used to down-weight it so specialists win rank-1. */
  host_breadth?: number;
  /**
   * Curated entity-property → request field maps from ontology/bindings.
   * Materialized by applyBindings; optional — most endpoints have none.
   */
  field_maps?: FieldMap[];
  built_at: string;
}

export interface SatisfiesRef {
  origin: string;
  method: string;
  path: string;
  confidence?: "primary" | "secondary" | "fallback";
  source?: "facet-gate" | "match_hint" | "curated";
  notes?: string;
}

/** Task-only ontology source (ontology/intents/*.yaml). No vendor endpoints required. */
export interface CuratedIntentSource {
  id: string;
  label: string;
  description?: string;
  aliases?: string[];
  schema_org?: string[];
  consumes?: Port[];
  produces?: Port[];
  facets?: Facets;
  negative_terms?: string[];
  links?: CapabilityLink[];
  related?: string[];
}

export interface CapabilityIntent extends CuratedIntentSource {
  satisfies: SatisfiesRef[];
}

export interface ProviderRecord {
  fqn: string;
  title: string;
  description?: string;
  use_case?: string;
  category?: string;
  categories?: string[];
  service_url: string;
  origins: string[];
  endpoint_count: number;
  payment_rails: string[];
  min_price_usd?: number;
  guidance_available?: boolean;
  spend_patterns?: string[];
  alternatives?: string[];
  capabilities?: string[];
  sources: Array<"pay-skills" | "mpp-catalog" | "x402scan" | "mppscan" | "openapi">;
  search_text: string;
}

export interface IndexBundle {
  index_version: string;
  spec_version: string;
  built_at: string;
  sources: Array<{
    name: string;
    path: string;
    providers?: number;
    endpoints?: number;
  }>;
  stats: {
    providers: number;
    endpoints: number;
    capabilities: number;
    origins: number;
    capability_links?: number;
    stub_endpoints?: number;
  };
  endpoints: EndpointRecord[];
  capabilities: CapabilityIntent[];
  providers?: ProviderRecord[];
}

export interface SearchHit {
  kind: "capability" | "endpoint";
  score: number;
  capability_id?: string;
  endpoint_id?: string;
  label: string;
  summary: string;
  origin?: string;
  method?: string;
  path?: string;
  price_usd?: number;
  payment_rails?: string[];
  provider_fqn?: string;
  input_schema_ref?: string;
  output_schema_ref?: string;
  schema_source?: "openapi" | "bazaar";
}