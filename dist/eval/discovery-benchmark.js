import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { endpointId } from "../id.js";
import { searchIndex } from "../search.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..", "..");
function expectedEndpointId(expect) {
    if (!expect)
        return null;
    return endpointId(expect.origin, expect.method, expect.path);
}
function searchProvidersOnly(query, bundle, limit) {
    if (bundle.providers?.length) {
        const proxyEndpoints = bundle.providers.map((p) => ({
            id: p.fqn,
            origin: p.service_url,
            method: "GET",
            path: "/",
            summary: p.title,
            description: p.description,
            provider_fqn: p.fqn,
            provider_title: p.title,
            category: p.category,
            payment: { paid: true, rails: p.payment_rails.map((r) => ({ protocol: r })) },
            search_text: p.search_text,
            built_at: bundle.built_at,
        }));
        return searchIndex(query, proxyEndpoints, [], limit).map((h) => ({
            ...h,
            kind: "endpoint",
        }));
    }
    const byProvider = new Map();
    for (const ep of bundle.endpoints) {
        const key = ep.provider_fqn ?? ep.origin;
        if (!byProvider.has(key))
            byProvider.set(key, ep);
    }
    const providers = [...byProvider.values()].map((ep) => ({
        ...ep,
        search_text: [
            ep.provider_fqn,
            ep.provider_title,
            ep.category,
            ep.origin,
        ]
            .filter(Boolean)
            .join(" "),
    }));
    return searchIndex(query, providers, [], limit).map((h) => ({
        ...h,
        kind: "endpoint",
    }));
}
function runSearch(query, bundle, mode, limit = 10) {
    let endpoints = bundle.endpoints;
    let capabilities = bundle.capabilities;
    if (mode === "pay-skills-only") {
        endpoints = endpoints.filter((e) => e.provider_fqn &&
            !e.provider_fqn.startsWith("x402scan/") &&
            !e.provider_fqn.startsWith("mppscan/") &&
            !e.provider_fqn.startsWith("mpp-catalog/"));
    }
    switch (mode) {
        case "endpoints-only":
            return searchIndex(query, endpoints, [], limit);
        case "providers-only":
            return searchProvidersOnly(query, bundle, limit);
        case "pay-skills-only":
            return searchIndex(query, endpoints, [], limit);
        default:
            return searchIndex(query, endpoints, capabilities, limit);
    }
}
function rankIntent(hits, intentId) {
    const idx = hits.findIndex((h) => h.capability_id === intentId);
    return idx >= 0 ? idx + 1 : null;
}
function rankEndpoint(hits, endpointIdExpected) {
    const idx = hits.findIndex((h) => h.endpoint_id === endpointIdExpected);
    return idx >= 0 ? idx + 1 : null;
}
function resolveIntentToEndpointIds(intent, endpoints) {
    return intent.satisfies
        .map((ref) => endpointId(ref.origin, ref.method, ref.path))
        .filter((id) => endpoints.some((e) => e.id === id));
}
function workflowRank(hits, expectedIntent, expectedEndpointId, capabilities, endpoints) {
    if (!expectedEndpointId)
        return null;
    for (let i = 0; i < hits.length; i++) {
        const hit = hits[i];
        if (hit.endpoint_id === expectedEndpointId)
            return i + 1;
        if (hit.capability_id) {
            const intent = capabilities.find((c) => c.id === hit.capability_id);
            if (intent) {
                const resolved = resolveIntentToEndpointIds(intent, endpoints);
                if (resolved.includes(expectedEndpointId))
                    return i + 1;
            }
        }
    }
    return null;
}
function mrr(ranks) {
    const scored = ranks.filter((r) => r != null);
    if (!scored.length)
        return 0;
    return scored.reduce((sum, r) => sum + 1 / r, 0) / ranks.length;
}
export function evaluateMode(queries, bundle, mode) {
    const results = [];
    const intentRanks = [];
    const endpointRanks = [];
    const workflowRanks = [];
    for (const q of queries) {
        const hits = runSearch(q.query, bundle, mode, 10);
        const expectedId = expectedEndpointId(q.expect_endpoint);
        const intentRank = q.expect_intent
            ? rankIntent(hits, q.expect_intent)
            : null;
        const endpointRank = expectedId ? rankEndpoint(hits, expectedId) : null;
        const wfRank = workflowRank(hits, q.expect_intent, expectedId, bundle.capabilities, bundle.endpoints);
        if (q.expect_intent)
            intentRanks.push(intentRank);
        if (expectedId) {
            endpointRanks.push(endpointRank);
            workflowRanks.push(wfRank);
        }
        results.push({
            id: q.id,
            query: q.query,
            mode,
            intent_hit: intentRank === 1,
            intent_rank: intentRank,
            endpoint_hit: endpointRank === 1,
            endpoint_rank: endpointRank,
            workflow_hit: wfRank === 1,
            workflow_rank: wfRank,
            top_label: hits[0]?.label ?? null,
        });
    }
    const withIntent = queries.filter((q) => q.expect_intent).length;
    const withEndpoint = queries.filter((q) => q.expect_endpoint).length;
    const intentHitAt = (k) => intentRanks.filter((r) => r != null && r <= k).length;
    const endpointHitAt = (k) => endpointRanks.filter((r) => r != null && r <= k).length;
    const workflowHitAt = (k) => workflowRanks.filter((r) => r != null && r <= k).length;
    return {
        mode,
        queries: queries.length,
        intent_queries: withIntent,
        endpoint_queries: withEndpoint,
        intent_hit_at_1: withIntent ? intentHitAt(1) : 0,
        intent_hit_at_3: withIntent ? intentHitAt(3) : 0,
        intent_hit_at_5: withIntent ? intentHitAt(5) : 0,
        endpoint_hit_at_1: withEndpoint ? endpointHitAt(1) : 0,
        endpoint_hit_at_3: withEndpoint ? endpointHitAt(3) : 0,
        endpoint_hit_at_5: withEndpoint ? endpointHitAt(5) : 0,
        workflow_hit_at_1: withEndpoint ? workflowHitAt(1) : 0,
        workflow_hit_at_3: withEndpoint ? workflowHitAt(3) : 0,
        intent_mrr: mrr(intentRanks),
        endpoint_mrr: mrr(endpointRanks),
        workflow_mrr: mrr(workflowRanks),
        results,
    };
}
export async function loadEvalQueries() {
    const raw = await readFile(path.join(PACKAGE_ROOT, "eval", "queries.json"), "utf8");
    return JSON.parse(raw);
}
export async function runDiscoveryBenchmark(bundle, modes = [
    "full",
    "endpoints-only",
    "providers-only",
    "pay-skills-only",
]) {
    const queries = await loadEvalQueries();
    return modes.map((mode) => evaluateMode(queries, bundle, mode));
}
export function formatReportTable(reports) {
    const header = [
        "mode".padEnd(18),
        "intent@1".padEnd(10),
        "flow@1".padEnd(8),
        "flow@3".padEnd(8),
        "ep@3".padEnd(8),
        "flow MRR".padEnd(9),
    ].join(" ");
    const lines = [header, "-".repeat(header.length)];
    for (const r of reports) {
        lines.push([
            r.mode.padEnd(18),
            `${r.intent_hit_at_1}/${r.intent_queries}`.padEnd(10),
            `${r.workflow_hit_at_1}/${r.endpoint_queries}`.padEnd(8),
            `${r.workflow_hit_at_3}/${r.endpoint_queries}`.padEnd(8),
            `${r.endpoint_hit_at_3}/${r.endpoint_queries}`.padEnd(8),
            r.workflow_mrr.toFixed(3).padEnd(9),
        ].join(" "));
    }
    return lines.join("\n");
}
//# sourceMappingURL=discovery-benchmark.js.map