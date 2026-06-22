export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
export interface PaymentRail {
    protocol: "x402" | "mpp";
    version?: string;
    networks?: string[];
}
export interface PaymentInfo {
    price_usd?: number;
    paid: boolean;
    rails: PaymentRail[];
}
/** Facet enum axes (mirror spec/ontology-source.schema.json). */
export type FacetDomain = "shop" | "ai" | "data" | "web" | "comms" | "finance" | "maps" | "travel" | "realestate" | "social" | "media" | "marketing" | "analyst" | "cloud" | "compute" | "devtools" | "storage" | "search" | "crypto";
export type FacetAction = "search" | "lookup" | "compare" | "extract" | "generate" | "transform" | "validate" | "send" | "provision" | "analyze" | "execute" | "monitor";
export type FacetModality = "text" | "html" | "markdown" | "json" | "image" | "audio" | "vector" | "citations" | "timeseries";
export type FacetFreshness = "realtime" | "recent" | "historical" | "forecast" | "static";
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
    type: "alternative_of" | "sibling_of" | "pipes_to" | "narrower_of" | "broader_of";
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
    guidance_available?: boolean;
    openapi_url?: string;
    search_text: string;
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
export interface PaySkillsProvider {
    fqn: string;
    name: string;
    title: string;
    description: string;
    use_case: string;
    category: string;
    service_url: string;
    openapi_path: string;
    capabilities?: string[];
    spend_patterns?: string[];
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
