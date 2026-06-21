import type { EndpointRecord, PaySkillsProvider } from "./types.js";
export declare function scoreEndpointPrimary(ep: EndpointRecord, provider?: PaySkillsProvider, serviceId?: string): number;
export declare function pickPrimaryEndpoints(endpoints: EndpointRecord[], options?: {
    provider?: PaySkillsProvider;
    serviceId?: string;
    max?: number;
}): EndpointRecord[];
