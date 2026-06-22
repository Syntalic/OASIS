import { CURATED_INTENT_IDS, matchEndpointsForIntent } from "./intent-match.js";
import { rankEndpointsNeutral } from "./score-endpoint.js";
const MAX_SATISFIES = 12;
/**
 * Materialized `satisfies[]` are derived from the regex INTENT_MATCHERS (the
 * primary binding this round), so every ref is tagged `match_hint`. Refs an
 * author hand-wrote in source YAML would be tagged `curated`; none exist today
 * (source YAMLs never author `satisfies`), but the helper keeps the distinction
 * explicit for when they do.
 */
function endpointToRef(ep, source = "match_hint") {
    const ref = {
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
function mergeLinksWithRelated(source) {
    const authored = source.links ?? [];
    const seen = new Set(authored.map((l) => `${l.type}:${l.to}`));
    const merged = [...authored];
    for (const to of source.related ?? []) {
        if (seen.has(`sibling_of:${to}`) || authored.some((l) => l.to === to)) {
            continue;
        }
        seen.add(`sibling_of:${to}`);
        merged.push({ type: "sibling_of", to });
    }
    return merged.length ? merged : undefined;
}
export function materializeCuratedIntent(source, endpoints) {
    const matches = matchEndpointsForIntent(source.id, endpoints);
    const ranked = rankEndpointsNeutral(matches, MAX_SATISFIES);
    const satisfies = ranked.map((ep) => endpointToRef(ep));
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
export function materializeCuratedIntents(sources, endpoints) {
    const byId = new Map(sources.map((s) => [s.id, s]));
    const ordered = [];
    for (const id of CURATED_INTENT_IDS) {
        const source = byId.get(id);
        if (!source)
            continue;
        ordered.push(materializeCuratedIntent(source, endpoints));
    }
    for (const source of sources) {
        if (CURATED_INTENT_IDS.includes(source.id))
            continue;
        ordered.push(materializeCuratedIntent(source, endpoints));
    }
    return ordered;
}
//# sourceMappingURL=materialize-satisfies.js.map