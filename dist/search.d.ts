import type { CapabilityIntent, EndpointRecord, SearchHit } from "./types.js";
export declare function searchIndex(query: string, endpoints: EndpointRecord[], capabilities: CapabilityIntent[], limit?: number): SearchHit[];
