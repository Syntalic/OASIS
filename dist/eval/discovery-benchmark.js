import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { endpointId } from "../id.js";
import { searchIndex } from "../search.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..", "..");
export function expectedEndpointId(expect) {
    if (!expect)
        return null;
    return endpointId(expect.origin, expect.method, expect.path);
}
// The provider "corpus" depends only on the bundle, so build it once per bundle
// instead of rebuilding it for every query in the providers-only sweep.
const providerCorpusCache = new WeakMap();
function providerCorpus(bundle) {
    const cached = providerCorpusCache.get(bundle);
    if (cached)
        return cached;
    let corpus;
    if (bundle.providers?.length) {
        corpus = bundle.providers.map((p) => ({
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
    }
    else {
        const byProvider = new Map();
        for (const ep of bundle.endpoints) {
            const key = ep.provider_fqn ?? ep.origin;
            if (!byProvider.has(key))
                byProvider.set(key, ep);
        }
        corpus = [...byProvider.values()].map((ep) => ({
            ...ep,
            search_text: [ep.provider_fqn, ep.provider_title, ep.category, ep.origin]
                .filter(Boolean)
                .join(" "),
        }));
    }
    providerCorpusCache.set(bundle, corpus);
    return corpus;
}
function searchProvidersOnly(query, bundle, limit) {
    return searchIndex(query, providerCorpus(bundle), [], limit).map((h) => ({
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
    else if (mode === "x402scan-only") {
        endpoints = endpoints.filter((e) => e.provider_fqn?.startsWith("x402scan/"));
    }
    else if (mode === "mpp-only") {
        endpoints = endpoints.filter((e) => e.provider_fqn?.startsWith("mppscan/") ||
            e.provider_fqn?.startsWith("mpp-catalog/"));
    }
    switch (mode) {
        case "endpoints-only":
        case "pay-skills-only":
        case "x402scan-only":
        case "mpp-only":
            return searchIndex(query, endpoints, [], limit);
        case "providers-only":
            return searchProvidersOnly(query, bundle, limit);
        default:
            return searchIndex(query, endpoints, capabilities, limit);
    }
}
export function rankIntent(hits, intentId) {
    const idx = hits.findIndex((h) => h.capability_id === intentId);
    return idx >= 0 ? idx + 1 : null;
}
export function rankEndpoint(hits, endpointIdExpected) {
    const idx = hits.findIndex((h) => h.endpoint_id === endpointIdExpected);
    return idx >= 0 ? idx + 1 : null;
}
export function resolveIntentToEndpointIds(intent, endpoints) {
    return intent.satisfies
        .map((ref) => endpointId(ref.origin, ref.method, ref.path))
        .filter((id) => endpoints.some((e) => e.id === id));
}
export function discoverRank(hits, expectedIntent, expectedEndpointId, capabilities, endpoints) {
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
export function mrr(ranks) {
    const scored = ranks.filter((r) => r != null);
    if (!scored.length)
        return 0;
    return scored.reduce((sum, r) => sum + 1 / r, 0) / ranks.length;
}
export function hitAt(ranks, k) {
    return ranks.filter((r) => r != null && r <= k).length;
}
/** Single source of truth for the BenchmarkReport metric block. */
export function buildReport(mode, queries, results, ranks) {
    const withIntent = queries.filter((q) => q.expect_intent).length;
    const withEndpoint = queries.filter((q) => q.expect_endpoint).length;
    return {
        mode,
        queries: queries.length,
        task_queries: withIntent,
        api_queries: withEndpoint,
        task_hit_at_1: withIntent ? hitAt(ranks.task, 1) : 0,
        task_hit_at_3: withIntent ? hitAt(ranks.task, 3) : 0,
        task_hit_at_5: withIntent ? hitAt(ranks.task, 5) : 0,
        literal_hit_at_1: withEndpoint ? hitAt(ranks.literal, 1) : 0,
        literal_hit_at_3: withEndpoint ? hitAt(ranks.literal, 3) : 0,
        literal_hit_at_5: withEndpoint ? hitAt(ranks.literal, 5) : 0,
        discover_hit_at_1: withEndpoint ? hitAt(ranks.discover, 1) : 0,
        discover_hit_at_3: withEndpoint ? hitAt(ranks.discover, 3) : 0,
        task_mrr: mrr(ranks.task),
        literal_mrr: mrr(ranks.literal),
        discover_mrr: mrr(ranks.discover),
        results,
    };
}
export function evaluateMode(queries, bundle, mode) {
    const results = [];
    const taskRanks = [];
    const literalRanks = [];
    const discoverRanks = [];
    for (const q of queries) {
        const hits = runSearch(q.query, bundle, mode, 10);
        const expectedId = expectedEndpointId(q.expect_endpoint);
        const intentRank = q.expect_intent
            ? rankIntent(hits, q.expect_intent)
            : null;
        const endpointRank = expectedId ? rankEndpoint(hits, expectedId) : null;
        const discover = discoverRank(hits, q.expect_intent, expectedId, bundle.capabilities, bundle.endpoints);
        if (q.expect_intent)
            taskRanks.push(intentRank);
        if (expectedId) {
            literalRanks.push(endpointRank);
            discoverRanks.push(discover);
        }
        results.push({
            id: q.id,
            query: q.query,
            mode,
            task_hit: intentRank === 1,
            task_rank: intentRank,
            literal_hit: endpointRank === 1,
            literal_rank: endpointRank,
            discover_hit: discover === 1,
            discover_rank: discover,
            top_label: hits[0]?.label ?? null,
        });
    }
    return buildReport(mode, queries, results, {
        task: taskRanks,
        literal: literalRanks,
        discover: discoverRanks,
    });
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
        "task@1".padEnd(10),
        "disc@1".padEnd(8),
        "disc@3".padEnd(8),
        "lit@3".padEnd(8),
        "disc MRR".padEnd(9),
    ].join(" ");
    const lines = [header, "-".repeat(header.length)];
    for (const r of reports) {
        lines.push([
            r.mode.padEnd(18),
            `${r.task_hit_at_1}/${r.task_queries}`.padEnd(10),
            `${r.discover_hit_at_1}/${r.api_queries}`.padEnd(8),
            `${r.discover_hit_at_3}/${r.api_queries}`.padEnd(8),
            `${r.literal_hit_at_3}/${r.api_queries}`.padEnd(8),
            r.discover_mrr.toFixed(3).padEnd(9),
        ].join(" "));
    }
    return lines.join("\n");
}
//# sourceMappingURL=discovery-benchmark.js.map