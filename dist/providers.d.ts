import type { EndpointRecord, PaySkillsProvider, ProviderRecord } from "./types.js";
export declare function buildProviderRecords(endpoints: EndpointRecord[], paySkillsProviders?: PaySkillsProvider[]): ProviderRecord[];
export declare function enrichEndpointsWithProviders(endpoints: EndpointRecord[], providers: ProviderRecord[]): void;
