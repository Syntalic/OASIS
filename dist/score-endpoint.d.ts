import type { EndpointRecord, Port } from "./types.js";
export declare function isGenericEndpoint(ep: EndpointRecord): boolean;
/**
 * Minimal intent shape consumed by the relevance term: only the typed
 * input/output ports. Accepting a structural subset (not the full
 * CapabilityIntent) keeps the relevance lever decoupled from materialization.
 */
export interface IntentPorts {
    consumes?: Port[];
    produces?: Port[];
}
/**
 * Per-intent relevance bonus: rewards endpoints whose declared inputs[] tokens
 * corroborate the resolving intent's consumes[].entity, plus a smaller bonus
 * when the endpoint's derived output_entity matches the intent's produced
 * entity. This is the only relevance-aware lever (moves select@k / resolve-rank);
 * it never reads origin/provider, so vendor neutrality is preserved.
 */
export declare function intentRelevanceBonus(ep: EndpointRecord, intent: IntentPorts): number;
/**
 * Neutral endpoint quality score for agent selection among candidates.
 * Uses only index metadata (description, inputs, payment, guidance) — never
 * origin, provider_fqn, or vendor-specific path fragments.
 *
 * When `intent` is supplied, the neutral prior is blended with a per-intent
 * input-identifier-overlap term (see intentRelevanceBonus). Without an intent
 * the score is byte-identical to the neutral-only prior, so callers that do not
 * pass an intent keep their existing behavior.
 */
export declare function scoreEndpointNeutral(ep: EndpointRecord, intent?: IntentPorts): number;
export declare function rankEndpointsNeutral(endpoints: EndpointRecord[], max?: number, intent?: IntentPorts): EndpointRecord[];
