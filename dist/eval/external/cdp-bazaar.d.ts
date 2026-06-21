import { type ParsedEndpointRef } from "../url-match.js";
export interface CdpBazaarHit extends ParsedEndpointRef {
    resource: string;
    description?: string;
    rank: number;
}
export declare function searchCdpBazaar(query: string, limit?: number): Promise<CdpBazaarHit[]>;
