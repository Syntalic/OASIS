import type { CapabilityLink, CuratedIntentSource, EndpointRecord, IndexBundle } from "./types.js";
/**
 * Derive cached facets for an endpoint from its path + summary + description +
 * inputs + category. Honest framing: this caches the existing path/summary
 * signal as structured facets — it is not new information. Domain/entity/modality
 * vocabulary is the same closed set used by curated intents.
 */
export declare function deriveEndpointFacets(ep: EndpointRecord): EndpointRecord;
/**
 * Coerce a legacy `related[]` list into `links[]` of type `sibling_of`, merging
 * with any authored links and dropping duplicate targets (authored links win).
 * Used during materialization to give the deprecated `related[]` a typed home.
 */
export declare function coerceRelatedToLinks(source: Pick<CuratedIntentSource, "links" | "related">): CapabilityLink[] | undefined;
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
export declare function buildIndex(options?: BuildOptions): Promise<IndexBundle>;
export declare function defaultPaySkillsPath(): string | undefined;
