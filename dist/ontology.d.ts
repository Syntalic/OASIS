import type { CapabilityIntent } from "./types.js";
export declare function loadOntology(intentsDir: string): Promise<CapabilityIntent[]>;
export declare function linkCapabilitiesToEndpoints(capabilities: CapabilityIntent[], endpointIndex: Map<string, {
    capabilities?: string[];
}>): void;
