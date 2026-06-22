import type { CapabilityIntent, CuratedIntentSource } from "./types.js";
export declare function loadOntologySources(intentsDir: string): Promise<CuratedIntentSource[]>;
/** @deprecated Use loadOntologySources — bundle capabilities come from materialize step. */
export declare function loadOntology(intentsDir: string): Promise<CapabilityIntent[]>;
export declare function linkCapabilitiesToEndpoints(capabilities: CapabilityIntent[], endpointIndex: Map<string, {
    capabilities?: string[];
}>): void;
