import type { CapabilityIntent, CuratedIntentSource, EndpointRecord } from "./types.js";
export declare function materializeCuratedIntent(source: CuratedIntentSource, endpoints: EndpointRecord[]): CapabilityIntent;
export declare function materializeCuratedIntents(sources: CuratedIntentSource[], endpoints: EndpointRecord[]): CapabilityIntent[];
