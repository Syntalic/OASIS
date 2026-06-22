import type { EndpointRecord } from "./types.js";

const GENERIC_SUMMARY =
  /^(authenticate|prove action|delete a memory|get mcp|api info|free health|x402 defi)/i;
const GENERIC_PATH =
  /\/(health|authenticate|auth|prove|memory|mcp-tools|api-info|defi-nontokenized)(\/|$)/i;

export function isGenericEndpoint(ep: EndpointRecord): boolean {
  if (GENERIC_SUMMARY.test(ep.summary)) return true;
  if (GENERIC_PATH.test(ep.path)) return true;
  return false;
}

/**
 * Neutral endpoint quality score for agent selection among candidates.
 * Uses only index metadata (description, inputs, payment, guidance) — never
 * origin, provider_fqn, or vendor-specific path fragments.
 */
export function scoreEndpointNeutral(ep: EndpointRecord): number {
  if (isGenericEndpoint(ep)) return -100;

  let score = 0;
  if (ep.description && ep.description.length > 20) score += 3;
  if (ep.inputs?.length) score += Math.min(ep.inputs.length, 5);
  if (ep.payment.price_usd != null) score += 2;
  if (ep.payment.paid) score += 1;
  if (ep.guidance_available) score += 2;
  if (ep.openapi_url) score += 1;

  const depth = ep.path.split("/").filter(Boolean).length;
  score += Math.max(0, 6 - depth);

  if (ep.summary.length > 12) score += 1;

  return score;
}

export function rankEndpointsNeutral(
  endpoints: EndpointRecord[],
  max = 12,
): EndpointRecord[] {
  const paid = endpoints.filter((e) => e.payment.paid || e.payment.rails.length);
  const pool = paid.length ? paid : endpoints;

  return [...pool]
    .sort((a, b) => scoreEndpointNeutral(b) - scoreEndpointNeutral(a))
    .slice(0, max);
}