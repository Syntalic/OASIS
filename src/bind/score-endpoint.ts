import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EndpointRecord, FieldMap, Port } from "../core/types.js";
import {
  BASE_ENTITY_INPUT_TOKENS,
  buildEntityInputTokens,
  type EntityVocabDef,
} from "../entity/entity-tokens.js";

const GENERIC_SUMMARY =
  /^(authenticate|prove action|delete a memory|get mcp|api info|free health|x402 defi)/i;
const GENERIC_PATH =
  /\/(health|authenticate|auth|prove|memory|mcp-tools|api-info|defi-nontokenized)(\/|$)/i;

const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function isGenericEndpoint(ep: EndpointRecord): boolean {
  if (GENERIC_SUMMARY.test(ep.summary)) return true;
  if (GENERIC_PATH.test(ep.path)) return true;
  return false;
}

/**
 * Minimal intent shape consumed by the relevance term: only the typed
 * input/output ports. Accepting a structural subset (not the full
 * CapabilityIntent) keeps the relevance lever decoupled from materialization.
 */
export interface IntentPorts {
  consumes?: Port[];
  produces?: Port[];
}

/** Live token table — starts as base; hydrateEntityInputTokens merges vocab properties. */
let ENTITY_INPUT_TOKENS: Record<string, string[]> = { ...BASE_ENTITY_INPUT_TOKENS };
let _hydrated = false;

/**
 * Merge entity-vocab property names/aliases into the token table.
 * Safe to call multiple times; never removes base coverage (no ranking regression).
 */
export function hydrateEntityInputTokens(vocab: Record<string, EntityVocabDef>): void {
  ENTITY_INPUT_TOKENS = buildEntityInputTokens(vocab);
  _hydrated = true;
}

/** Test/reset helper — restores the hardcoded baseline (disables auto-hydrate until next ensure). */
export function resetEntityInputTokens(): void {
  ENTITY_INPUT_TOKENS = { ...BASE_ENTITY_INPUT_TOKENS };
  _hydrated = false;
}

/** Lazy-load shipped entity-vocab properties once (serve path + CLI). */
function ensureEntityTokensHydrated(): void {
  if (_hydrated) return;
  _hydrated = true;
  try {
    const raw = JSON.parse(
      readFileSync(path.join(PACKAGE_ROOT, "spec", "entity-vocab.json"), "utf8"),
    ) as { entities?: Record<string, EntityVocabDef> };
    if (raw.entities) ENTITY_INPUT_TOKENS = buildEntityInputTokens(raw.entities);
  } catch {
    /* keep base tokens if vocab unreadable */
  }
}

export function entityInputTokens(entity: string): string[] {
  ensureEntityTokensHydrated();
  return ENTITY_INPUT_TOKENS[entity] ?? [];
}

/**
 * Strong corroboration when a curated field_map ties a consumed entity to a
 * concrete request location (query/body/path/header). Stronger than bare token
 * overlap because a maintainer asserted the mapping.
 */
export function fieldMapRelevanceBonus(
  fieldMaps: FieldMap[] | undefined,
  consumes: Port[] | undefined,
  inputs: string[] | undefined,
): number {
  if (!fieldMaps?.length || !consumes?.length) return 0;
  const consumed = new Set(consumes.map((p) => p.entity));
  const inputParts = new Set<string>();
  for (const inp of (inputs ?? []).map((i) => i.toLowerCase())) {
    inputParts.add(inp);
    for (const part of inp.split(/[_\-\s.]+/)) if (part) inputParts.add(part);
  }

  let bonus = 0;
  for (const fm of fieldMaps) {
    if (!consumed.has(fm.entity)) continue;
    // Authored map for a consumed entity is itself strong evidence.
    bonus += 6;
    // Extra: the mapped path token appears in declared inputs.
    const pathToken = fm.path.split(/[.\{\}\[\]/]+/).filter(Boolean).pop()?.toLowerCase();
    if (pathToken && (inputParts.has(pathToken) || inputParts.has(fm.property.toLowerCase()))) {
      bonus += 2;
    }
  }
  return bonus;
}

/**
 * Per-intent relevance bonus: rewards endpoints whose declared inputs[] tokens
 * corroborate the resolving intent's consumes[].entity, plus a smaller bonus
 * when the endpoint's derived output_entity matches the intent's produced
 * entity. Curated field_maps add a stronger signal when present.
 * Vendor-neutral: never reads origin/provider.
 */
export function intentRelevanceBonus(
  ep: EndpointRecord,
  intent: IntentPorts,
): number {
  let bonus = 0;

  const consumes = intent.consumes ?? [];
  if (consumes.length) {
    const inputs = (ep.inputs ?? []).map((i) => i.toLowerCase());
    // Normalized parameter parts: split snake/kebab/space names so e.g.
    // "phone_number" corroborates Contact ("phone"/"number"), "product_uid"
    // corroborates Product, "vs_currencies" corroborates Currency.
    const inputParts = new Set<string>();
    for (const inp of inputs) {
      inputParts.add(inp);
      for (const part of inp.split(/[_\-\s]+/)) if (part) inputParts.add(part);
    }
    const inputMatches = (t: string): boolean => inputParts.has(t);
    const haystack = `${ep.path} ${ep.summary} ${ep.description ?? ""}`.toLowerCase();
    const primaryEntity = ep.facets?.primary_entity;

    for (const port of consumes) {
      const tokens = entityInputTokens(port.entity);
      // Strong corroboration: a declared input parameter names the entity.
      if (tokens.some(inputMatches)) {
        bonus += 4;
        continue;
      }
      // Weaker corroboration: the entity surfaces in path/summary/description.
      if (tokens.some((t) => haystack.includes(t))) {
        bonus += 2;
      }
      // Derived primary_entity agreement is independent additional evidence.
      if (primaryEntity && primaryEntity === port.entity) {
        bonus += 2;
      }
    }

    bonus += fieldMapRelevanceBonus(ep.field_maps, consumes, ep.inputs);
  }

  const producedEntity = intent.produces?.[0]?.entity;
  const outputEntity = ep.facets?.output_entity;
  if (producedEntity && outputEntity && producedEntity === outputEntity) {
    bonus += 3;
  }

  return bonus;
}

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
export function scoreEndpointNeutral(
  ep: EndpointRecord,
  intent?: IntentPorts,
): number {
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

  if (intent) score += intentRelevanceBonus(ep, intent);

  return score;
}

export function rankEndpointsNeutral(
  endpoints: EndpointRecord[],
  max = 12,
  intent?: IntentPorts,
): EndpointRecord[] {
  const paid = endpoints.filter((e) => e.payment.paid || e.payment.rails.length);
  const pool = paid.length ? paid : endpoints;

  return [...pool]
    .sort((a, b) => scoreEndpointNeutral(b, intent) - scoreEndpointNeutral(a, intent))
    .slice(0, max);
}
