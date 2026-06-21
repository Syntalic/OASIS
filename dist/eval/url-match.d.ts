import type { EvalQuery } from "./discovery-benchmark.js";
export interface ParsedEndpointRef {
    origin: string;
    method: string;
    path: string;
}
export declare function parseResourceUrl(resource: string, method?: string): ParsedEndpointRef | null;
export declare function endpointRefId(ref: ParsedEndpointRef): string;
export declare function matchesExpectedEndpoint(hit: ParsedEndpointRef, expected: NonNullable<EvalQuery["expect_endpoint"]>): boolean;
export declare function rankExternalHits(hits: ParsedEndpointRef[], expected: EvalQuery["expect_endpoint"]): number | null;
