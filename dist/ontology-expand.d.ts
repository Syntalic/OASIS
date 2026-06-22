import type { CapabilityIntent, EndpointFacets, EndpointRecord, Facets, PaySkillsProvider } from "./types.js";
export declare function expandOntologyFromProviders(curated: CapabilityIntent[], paySkillsProviders: PaySkillsProvider[], endpoints: EndpointRecord[]): CapabilityIntent[];
/** @deprecated Replaced by materializeCuratedIntents + intent-match.ts */
export declare function expandOntologyFromKeywords(intents: CapabilityIntent[], _endpoints: EndpointRecord[]): CapabilityIntent[];
type LinkableEndpoint = {
    capabilities?: string[];
    search_text?: string;
    summary?: string;
    path?: string;
};
/**
 * Tag previously-unbound endpoints with their best-matching curated/generated
 * intent via the alias/label substring signal.
 *
 * Determinism: the legacy implementation was *first-match-wins by intent array
 * order* — whichever intent happened to iterate first claimed a contested
 * endpoint. This version scores every candidate intent for each unbound endpoint
 * and assigns the single best one, so the result no longer depends on iteration
 * order. The eligibility rule is unchanged (an endpoint is bound iff ≥1 intent
 * term substring-hits its corpus), so the *set* of bound endpoints is identical
 * to the legacy binder — only the winner among contested matches becomes a
 * deterministic best-score pick instead of an arbitrary order-dependent one.
 *
 * Score = number of distinct matching terms; ties break toward the more specific
 * (longer total matched-term length), then curated intents over generated ones
 * (curated aliases are vetted, so this reduces mis-binds), then the
 * lexicographically smallest intent id for a fully stable, reproducible result.
 */
export declare function inferCapabilityLinks(intents: CapabilityIntent[], endpointIndex: Map<string, LinkableEndpoint>): number;
/**
 * Endpoints that bound to no intent (after curated satisfies + inferred links).
 * Returned for visibility / coverage reporting; does not mutate anything.
 */
export declare function unboundEndpoints<T extends {
    capabilities?: string[];
}>(endpoints: Iterable<T>): T[];
/** Count of endpoints that bound to no intent. */
export declare function countUnboundEndpoints(endpoints: Iterable<{
    capabilities?: string[];
}>): number;
/**
 * OPTIONAL precision signal: does an endpoint's derived facets agree with an
 * intent's authored facets? Returns `true` when nothing contradicts (absent
 * facets never contradict, so this is permissive by design). Intended as an
 * *additional* gate on top of the existing binder — NOT a replacement — so it
 * must never widen or change the default binding set on its own.
 */
export declare function facetGateAgrees(intentFacets: Facets | undefined, endpointFacets: EndpointFacets | undefined): boolean;
export {};
