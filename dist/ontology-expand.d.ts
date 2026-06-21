import type { CapabilityIntent, EndpointRecord, PaySkillsProvider } from "./types.js";
export declare function expandOntologyFromProviders(curated: CapabilityIntent[], paySkillsProviders: PaySkillsProvider[], endpoints: EndpointRecord[]): CapabilityIntent[];
export declare function expandOntologyFromKeywords(intents: CapabilityIntent[], endpoints: EndpointRecord[]): CapabilityIntent[];
export declare function inferCapabilityLinks(intents: CapabilityIntent[], endpointIndex: Map<string, {
    capabilities?: string[];
    search_text?: string;
    summary?: string;
    path?: string;
}>): number;
