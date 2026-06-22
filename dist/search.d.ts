import type { CapabilityIntent, EndpointRecord, FacetDomain, FacetModality, SearchHit } from "./types.js";
/** Inferred query-side facets, mapping surface cues to facet VALUES. */
export interface InferredQueryFacets {
    domain?: FacetDomain;
    primary_entity?: string;
    output_entity?: string;
    modality?: FacetModality[];
}
/**
 * Map free-text query cues onto facet VALUES. Pure/deterministic, returns only
 * the axes it is confident about (absent axis == no signal). Exported so the
 * hybrid pre-filter (M1) can reuse the exact same inference.
 */
export declare function inferQueryFacets(query: string): InferredQueryFacets;
export declare function searchIndex(query: string, endpoints: EndpointRecord[], capabilities: CapabilityIntent[], limit?: number): SearchHit[];
