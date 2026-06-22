import type { CapabilityIntent, EndpointRecord, SatisfiesRef } from "./types.js";
export declare function satisfiesRefsToEndpoints(refs: SatisfiesRef[], endpoints: EndpointRecord[]): EndpointRecord[];
/** Rank candidate endpoints for an intent using neutral quality signals only. */
export declare function selectEndpointsForIntent(intent: CapabilityIntent, endpoints: EndpointRecord[], max?: number): EndpointRecord[];
export declare function selectRank(intent: CapabilityIntent, expectedEndpointId: string, endpoints: EndpointRecord[]): number | null;
