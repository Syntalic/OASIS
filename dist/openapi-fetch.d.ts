import type { EndpointRecord } from "./types.js";
export declare function openapiCandidates(origin: string): string[];
export declare function fetchOpenApiForOrigin(origin: string, builtAt: string, timeoutMs?: number): Promise<{
    endpoints: EndpointRecord[];
    openapi_url?: string;
}>;
export declare function isStubEndpoint(ep: EndpointRecord): boolean;
