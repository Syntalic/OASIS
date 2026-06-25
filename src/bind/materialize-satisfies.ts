import { CURATED_INTENT_IDS } from "../search/intent-match.js";
import { rankEndpointsNeutral } from "./score-endpoint.js";
import type {
  CapabilityIntent,
  CapabilityLink,
  CuratedIntentSource,
  EndpointRecord,
  SatisfiesRef,
} from "../core/types.js";

// Retain a generous candidate pool per intent. The old cap of 12 evicted the
// correct endpoint in 54% of resolve cases (it was matched but ranked past 12 by
// the query-BLIND neutral score). Resolve precision is recovered at runtime by
// ranking this pool against the actual query (see resolveEndpointsForQuery).
const MAX_SATISFIES = 50;

/**
 * Materialized `satisfies[]` are derived from the regex INTENT_MATCHERS (the
 * primary binding this round), so every ref is tagged `match_hint`. Refs an
 * author hand-wrote in source YAML would be tagged `curated`; none exist today
 * (source YAMLs never author `satisfies`), but the helper keeps the distinction
 * explicit for when they do.
 */
function endpointToRef(
  ep: EndpointRecord,
  source: SatisfiesRef["source"] = "match_hint",
): SatisfiesRef {
  const ref: SatisfiesRef = {
    origin: ep.origin,
    method: ep.method,
    path: ep.path,
    source,
  };
  return ref;
}

/**
 * Coerce a legacy `related[]` list into `links[]` of type `sibling_of`, merging
 * with any authored links and dropping duplicate targets (an authored link of
 * any type to the same id wins). Mirrors `coerceRelatedToLinks` in build.ts;
 * kept local to avoid a materialize ⇄ build import cycle.
 */
function mergeLinksWithRelated(
  source: Pick<CuratedIntentSource, "links" | "related">,
): CapabilityLink[] | undefined {
  const authored = source.links ?? [];
  const seen = new Set(authored.map((l) => `${l.type}:${l.to}`));
  const merged: CapabilityLink[] = [...authored];
  for (const to of source.related ?? []) {
    if (seen.has(`sibling_of:${to}`) || authored.some((l) => l.to === to)) {
      continue;
    }
    seen.add(`sibling_of:${to}`);
    merged.push({ type: "sibling_of", to });
  }
  return merged.length ? merged : undefined;
}

export function materializeCuratedIntent(
  source: CuratedIntentSource,
  endpoints: EndpointRecord[],
): CapabilityIntent {
  // Prefer the facet/link binding (endpoint.capabilities, set by
  // linkCapabilitiesToEndpoints) when it is populated — it is far higher-precision
  // than the legacy regex INTENT_MATCHERS, which bound e.g. college-scorecard,
  // OSHA and geocoding endpoints to data.weather_forecast while missing every real
  // weather endpoint. When capabilities aren't populated yet (the first materialize
  // pass of a full build, before linkCapabilitiesToEndpoints runs) fall back to the
  // regex matcher so the build is unaffected; the offline `enrich-facets` re-pass
  // then rebuilds satisfies from the now-present capabilities binding.
  // Embedding-bound only. endpoint.capabilities[] is set by bindEndpointsByEmbedding
  // (semantic similarity + floor); the legacy regex INTENT_MATCHERS fallback is gone,
  // so an intent with no semantic match gets fewer (clean) endpoints, never junk.
  const matches = endpoints.filter((e) => e.capabilities?.includes(source.id));
  // Pass the source's typed ports so satisfies[] is ordered by per-intent
  // relevance (input-identifier / output-entity overlap), not just the neutral
  // quality prior — this is what lands the best-fit endpoint at satisfies[0].
  const ranked = rankEndpointsNeutral(matches, MAX_SATISFIES, source);

  const satisfies: SatisfiesRef[] = ranked.map((ep) => endpointToRef(ep));

  const links = mergeLinksWithRelated(source);

  return {
    id: source.id,
    label: source.label,
    description: source.description,
    aliases: source.aliases,
    schema_org: source.schema_org,
    consumes: source.consumes,
    produces: source.produces,
    facets: source.facets,
    negative_terms: source.negative_terms,
    links,
    satisfies,
  };
}

export function materializeCuratedIntents(
  sources: CuratedIntentSource[],
  endpoints: EndpointRecord[],
): CapabilityIntent[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const ordered: CapabilityIntent[] = [];

  for (const id of CURATED_INTENT_IDS) {
    const source = byId.get(id);
    if (!source) continue;
    ordered.push(materializeCuratedIntent(source, endpoints));
  }

  for (const source of sources) {
    if (CURATED_INTENT_IDS.includes(source.id as (typeof CURATED_INTENT_IDS)[number])) continue;
    ordered.push(materializeCuratedIntent(source, endpoints));
  }

  addInverseLinks(ordered);
  return ordered;
}

/**
 * Inverse of each directed/symmetric link type. `pipes_to` (forward, "next
 * step") generates `fed_by` (backward, "what produces my input"), enabling
 * backward planning from a held artifact. `fed_by` is not itself a key, so a
 * generated inverse never spawns another (and authored pipes_to always wins
 * the dedup).
 */
const LINK_INVERSE: Record<string, CapabilityLink["type"]> = {
  alternative_of: "alternative_of",
  sibling_of: "sibling_of",
  broader_of: "narrower_of",
  narrower_of: "broader_of",
  pipes_to: "fed_by",
};

/**
 * Make the typed-link graph bidirectional: an authored `data.web_scrape
 * broader_of web.markdown_extract` yields `web.markdown_extract narrower_of
 * data.web_scrape`, so resolving EITHER side surfaces the other as an
 * alternative/option (the core "find related tools" use case). Authored links
 * always win — a generated inverse is only added when the target has no link
 * to the source yet.
 */
function addInverseLinks(caps: CapabilityIntent[]): void {
  const byId = new Map(caps.map((c) => [c.id, c]));
  for (const cap of caps) {
    for (const link of cap.links ?? []) {
      const inverse = LINK_INVERSE[link.type];
      if (!inverse) continue;
      const target = byId.get(link.to);
      if (!target || target.id === cap.id) continue;
      target.links = target.links ?? [];
      if (target.links.some((l) => l.to === cap.id)) continue; // authored wins
      target.links.push({ type: inverse, to: cap.id, note: "auto-generated inverse" });
    }
  }
}