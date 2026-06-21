import type { IndexBundle, SearchHit } from "./types.js";
/** Keyword hits are weighted higher so vector acts as recall, not rerank noise. */
export declare const DEFAULT_KEYWORD_WEIGHT = 2;
export declare const DEFAULT_VECTOR_WEIGHT = 1;
export interface HybridFusionOptions {
    keywordWeight?: number;
    vectorWeight?: number;
    candidatePool?: number;
}
export declare function searchHybrid(query: string, bundle: IndexBundle, lanceDir: string, limit?: number, options?: HybridFusionOptions): Promise<SearchHit[]>;
export declare function searchHybridWithFallback(query: string, bundle: IndexBundle, lanceDir: string | null, limit?: number, options?: HybridFusionOptions): Promise<SearchHit[]>;
