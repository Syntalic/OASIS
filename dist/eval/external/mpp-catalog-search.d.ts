import type { EndpointRecord, SearchHit } from "../../types.js";
export declare function loadMppCatalogEndpoints(force?: boolean): Promise<EndpointRecord[]>;
export declare function searchMppCatalogLive(query: string, limit?: number): Promise<SearchHit[]>;
export declare function clearMppCatalogCache(): void;
