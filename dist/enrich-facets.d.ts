#!/usr/bin/env node
export interface EnrichResult {
    endpoints: number;
    endpoints_with_facets: number;
    capabilities: number;
    capabilities_facets_derived: number;
}
export declare function enrichFacets(distDir: string): Promise<EnrichResult>;
