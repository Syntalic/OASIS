export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

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

export interface PaymentInfo {
  /** Derived convenience: cheapest charge offer expressed in USD. */
  price_usd?: number;
  paid: boolean;
  rails: PaymentRail[];
  /** Canonical multi-offer payment terms parsed from x-payment-info. */
  offers?: PaymentOffer[];
  /** Currency of the offer used to derive price_usd. */
  currency?: string;
}

/** Facet enum axes (mirror spec/ontology-source.schema.json). */
export type FacetDomain =
  | "shop"
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
  | "marketing"
  | "analyst"
  | "cloud"
  | "compute"
  | "devtools"
  | "storage"
  | "search"
  | "crypto";

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
  primary_entity?: string;
  output_entity?: string;
  modality?: FacetModality[];
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
  /** Declared responses presence; draft-payment-discovery-00 requires 402 on payable ops. */
  responses?: { has200?: boolean; has402?: boolean };
  /** Payable operation lacking a requestBody schema (the spec's "schema-missing"). */
  schema_missing?: boolean;
  guidance_available?: boolean;
  openapi_url?: string;
  search_text: string;
  /** Ingest-time local keyphrases (spaCy noun-chunks/POS, lemmatized) — powers the serve-time
   *  keyword-relevance match (string ops only; no live model). See scripts/keyx/enrich_keyphrases.py. */
  keyphrases?: string[];
  /** Ingest-time enrichment text harvested from the source spec — response-schema property
   *  names/descriptions, parameter descriptions, x-guidance, .well-known/x402 categories. Fields
   *  the publisher wrote that the flat record dropped; folded into the lexical/embed task signal. */
  enrichment?: string;
  /** # of distinct curated intents this endpoint's host is bound to — a catch-all/precision
   *  signal. A host bound to 50+ intents (2s.io, agentutility) is a generic multi-tool whose
   *  broad endpoints flood specialist buckets; used to down-weight it so specialists win rank-1. */
  host_breadth?: number;
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
}