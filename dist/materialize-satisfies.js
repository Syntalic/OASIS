import { CURATED_INTENT_IDS, matchEndpointsForIntent } from "./intent-match.js";
import { rankEndpointsNeutral } from "./score-endpoint.js";

const MAX_SATISFIES = 12;

function endpointToRef(ep) {
    return {
        origin: ep.origin,
        method: ep.method,
        path: ep.path,
    };
}

export function materializeCuratedIntent(source, endpoints) {
    const matches = matchEndpointsForIntent(source.id, endpoints);
    const ranked = rankEndpointsNeutral(matches, MAX_SATISFIES);
    const satisfies = ranked.map(endpointToRef);
    return {
        id: source.id,
        label: source.label,
        description: source.description,
        aliases: source.aliases,
        schema_org: source.schema_org,
        related: source.related,
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