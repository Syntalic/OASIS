import type { FacetDomain, IndexBundle, SearchHit } from "./types.js";
/** Keyword hits are weighted higher so vector acts as recall, not rerank noise. */
export declare const DEFAULT_KEYWORD_WEIGHT = 2;
export declare const DEFAULT_VECTOR_WEIGHT = 1;
export interface HybridFusionOptions {
    keywordWeight?: number;
    vectorWeight?: number;
    candidatePool?: number;
}
export declare function inferQueryDomains(query: string): Set<FacetDomain>;
/**
 * COARSE pre-filter: restrict the candidate capabilities to those whose domain
 * is compatible with the query, on the coarsest axis only (domain) where false
 * negatives are unlikely. Degrades gracefully: if no domain is inferred, or no
 * capability is compatible, returns the full set so recall is never harmed.
 * Returns the set of allowed capability ids, or null to mean "no restriction".
 */
export declare function coarseCapabilityAllowlist(query: string, bundle: IndexBundle): Set<string> | null;
export declare function searchHybrid(query: string, bundle: IndexBundle, lanceDir: string, limit?: number, options?: HybridFusionOptions): Promise<SearchHit[]>;
export declare function searchHybridWithFallback(query: string, bundle: IndexBundle, lanceDir: string | null, limit?: number, options?: HybridFusionOptions): Promise<SearchHit[]>;
