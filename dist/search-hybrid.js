import { existsSync } from "node:fs";
import { embedText } from "./embed/embedder.js";
import { openLanceTable } from "./embed/lance-index.js";
import { searchIndex } from "./search.js";
const RRF_K = 60;
/** Keyword hits are weighted higher so vector acts as recall, not rerank noise. */
export const DEFAULT_KEYWORD_WEIGHT = 2;
export const DEFAULT_VECTOR_WEIGHT = 1;
function hitKey(hit) {
    // Endpoint rows must not collapse onto shared capability_id tags.
    if (hit.kind === "endpoint" && hit.endpoint_id)
        return `ep:${hit.endpoint_id}`;
    if (hit.capability_id)
        return `cap:${hit.capability_id}`;
    if (hit.endpoint_id)
        return `ep:${hit.endpoint_id}`;
    return `label:${hit.label}`;
}
function lanceKey(kind, id) {
    // The vector index embeds capabilities only; other kinds are ignored.
    return kind === "capability" ? `cap:${id}` : `other:${id}`;
}
function rrfScore(rank, weight) {
    return weight / (RRF_K + rank);
}
function capabilityToHit(cap, score) {
    return {
        kind: "capability",
        score,
        capability_id: cap.id,
        label: cap.label,
        summary: cap.description ?? cap.label,
    };
}
function mergeKeywordAndVector(keywordHits, vectorHits, bundle, limit, fusion) {
    const scores = new Map();
    for (let i = 0; i < keywordHits.length; i++) {
        const key = hitKey(keywordHits[i]);
        const existing = scores.get(key) ?? {
            key,
            rrf: 0,
            keywordRank: null,
            vectorRank: null,
        };
        existing.rrf += rrfScore(i + 1, fusion.keywordWeight);
        existing.keywordRank = i + 1;
        scores.set(key, existing);
    }
    for (let i = 0; i < vectorHits.length; i++) {
        const { kind, id } = vectorHits[i];
        const key = lanceKey(kind, id);
        const existing = scores.get(key) ?? {
            key,
            rrf: 0,
            keywordRank: null,
            vectorRank: null,
        };
        existing.rrf += rrfScore(i + 1, fusion.vectorWeight);
        existing.vectorRank = i + 1;
        scores.set(key, existing);
    }
    const ranked = [...scores.values()].sort((a, b) => b.rrf - a.rrf);
    const hits = [];
    const seen = new Set();
    for (const item of ranked) {
        let hit = null;
        if (item.key.startsWith("cap:")) {
            const capId = item.key.slice(4);
            const cap = bundle.capabilities.find((c) => c.id === capId);
            if (cap)
                hit = capabilityToHit(cap, item.rrf);
        }
        else if (item.key.startsWith("ep:")) {
            const epId = item.key.slice(3);
            const ep = bundle.endpoints.find((e) => e.id === epId);
            if (ep) {
                hit = {
                    kind: "endpoint",
                    score: item.rrf,
                    endpoint_id: ep.id,
                    capability_id: ep.capabilities?.[0],
                    label: ep.summary,
                    summary: `${ep.method} ${ep.path}`,
                    origin: ep.origin,
                    method: ep.method,
                    path: ep.path,
                    price_usd: ep.payment.price_usd,
                    payment_rails: ep.payment.rails.map((r) => r.protocol),
                    provider_fqn: ep.provider_fqn,
                };
            }
        }
        if (!hit)
            continue;
        // Dedupe by identity within kind: endpoints by endpoint_id, capabilities by
        // capability_id. Endpoint hits also carry capabilities[0], so keying every
        // hit on capability_id would collapse distinct endpoints under one tag
        // (the exact collapse hitKey above is written to avoid).
        const dedupe = hit.kind === "endpoint"
            ? hit.endpoint_id ?? hit.label
            : hit.capability_id ?? hit.label;
        if (seen.has(dedupe))
            continue;
        seen.add(dedupe);
        hit.score = item.rrf;
        hits.push(hit);
        if (hits.length >= limit)
            break;
    }
    return hits;
}
export async function searchHybrid(query, bundle, lanceDir, limit = 10, options = {}) {
    const keywordWeight = options.keywordWeight ?? DEFAULT_KEYWORD_WEIGHT;
    const vectorWeight = options.vectorWeight ?? DEFAULT_VECTOR_WEIGHT;
    const candidatePool = options.candidatePool ?? 50;
    const keywordHits = searchIndex(query, bundle.endpoints, bundle.capabilities, candidatePool);
    // No vector index built yet: degrade to keyword-only silently (expected path).
    if (!existsSync(lanceDir)) {
        return keywordHits.slice(0, limit);
    }
    let vectorHits = [];
    try {
        const table = await openLanceTable(lanceDir);
        const queryVector = await embedText(query);
        const rows = await table
            .vectorSearch(queryVector)
            .limit(candidatePool)
            .toArray();
        vectorHits = rows.map((r) => ({
            kind: r.kind,
            id: r.id,
        }));
    }
    catch (err) {
        // The index exists but the lookup failed (corrupt table, dimension
        // mismatch, model load error): surface it instead of masking, then degrade.
        console.warn(`hybrid search: vector lookup failed, using keyword-only results (${err instanceof Error ? err.message : String(err)})`);
        return keywordHits.slice(0, limit);
    }
    return mergeKeywordAndVector(keywordHits, vectorHits, bundle, limit, {
        keywordWeight,
        vectorWeight,
    });
}
export async function searchHybridWithFallback(query, bundle, lanceDir, limit = 10, options = {}) {
    if (!lanceDir) {
        return searchIndex(query, bundle.endpoints, bundle.capabilities, limit);
    }
    return searchHybrid(query, bundle, lanceDir, limit, options);
}
//# sourceMappingURL=search-hybrid.js.map