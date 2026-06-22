import { endpointId } from "./id.js";
import { rankEndpointsNeutral } from "./score-endpoint.js";
import type { CapabilityIntent, EndpointRecord, SatisfiesRef } from "./types.js";

export function satisfiesRefsToEndpoints(
  refs: SatisfiesRef[],
  endpoints: EndpointRecord[],
): EndpointRecord[] {
  const byKey = new Map(
    endpoints.map((e) => [`${e.origin}|${e.method}|${e.path}`, e]),
  );
  const out: EndpointRecord[] = [];
  for (const ref of refs) {
    const key = `${ref.origin}|${ref.method.toUpperCase()}|${ref.path.startsWith("/") ? ref.path : `/${ref.path}`}`;
    const ep = byKey.get(key);
    if (ep) out.push(ep);
  }
  return out;
}

/** Rank candidate endpoints for an intent using neutral quality signals only. */
export function selectEndpointsForIntent(
  intent: CapabilityIntent,
  endpoints: EndpointRecord[],
  max = 10,
): EndpointRecord[] {
  const candidates = satisfiesRefsToEndpoints(intent.satisfies, endpoints);
  return rankEndpointsNeutral(candidates, max);
}

export function selectRank(
  intent: CapabilityIntent,
  expectedEndpointId: string,
  endpoints: EndpointRecord[],
): number | null {
  const ranked = selectEndpointsForIntent(intent, endpoints);
  const idx = ranked.findIndex((ep) => ep.id === expectedEndpointId);
  return idx >= 0 ? idx + 1 : null;
}