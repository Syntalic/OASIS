import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultLanceDir } from "../embed/lance-index.js";
import { DEFAULT_KEYWORD_WEIGHT, DEFAULT_VECTOR_WEIGHT, searchHybridWithFallback, } from "../search-hybrid.js";
import { curatedCapabilitiesForSearch } from "../curated-search.js";
import { buildReport, discoverRank, evaluateMode, expectedEndpointId, formatReportTable, rankEndpoint, rankIntent, } from "./discovery-benchmark.js";
import { selectRank } from "../select-policy.js";
import { endpointId } from "../id.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..", "..");

export async function loadMessyQueries() {
    const raw = await readFile(path.join(PACKAGE_ROOT, "eval", "messy-queries.json"), "utf8");
    return JSON.parse(raw);
}

export async function evaluateHybridMode(queries, bundle, lanceDir, fusion = {}, reportMode = "full") {
    const mode = reportMode;
    const results = [];
    const taskRanks = [];
    const literalRanks = [];
    const discoverRanks = [];
    const selectRanks = [];

    for (const q of queries) {
        const hits = await searchHybridWithFallback(q.query, bundle, lanceDir, 10, fusion);
        const expectedId = expectedEndpointId(q.expect_endpoint);

        const intentRank = q.expect_intent
            ? rankIntent(hits, q.expect_intent)
            : null;
        const endpointRank = expectedId ? rankEndpoint(hits, expectedId) : null;
        const curated = curatedCapabilitiesForSearch(bundle);
        const discover = discoverRank(hits, q.expect_intent, expectedId, curated, bundle.endpoints);

        let select = null;
        if (expectedId && q.expect_intent) {
            const intent = curated.find((c) => c.id === q.expect_intent);
            if (intent)
                select = selectRank(intent, expectedId, bundle.endpoints);
        }

        if (q.expect_intent)
            taskRanks.push(intentRank);
        if (expectedId) {
            literalRanks.push(endpointRank);
            discoverRanks.push(discover);
            selectRanks.push(select);
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
            select_hit: select === 1,
            select_rank: select,
            top_label: hits[0]?.label ?? null,
        });
    }

    return buildReport(reportMode, queries, results, {
        task: taskRanks,
        literal: literalRanks,
        discover: discoverRanks,
        select: selectRanks,
    });
}

export function evaluateKeywordOnly(queries, bundle) {
    return evaluateMode(queries, bundle, "full");
}

export function compareReports(baseline, hybrid) {
    const improved = [];
    const regressed = [];

    for (const b of baseline.results) {
        const h = hybrid.results.find((r) => r.id === b.id);
        if (!h)
            continue;

        const bRank = b.discover_rank ?? 999;
        const hRank = h.discover_rank ?? 999;

        if (hRank < bRank)
            improved.push(h);
        else if (hRank > bRank)
            regressed.push(h);
    }

    return { baseline, hybrid, improved, regressed };
}

export function formatHybridComparison(cmp, fusion = {}) {
    const kw = fusion.keywordWeight ?? DEFAULT_KEYWORD_WEIGHT;
    const vec = fusion.vectorWeight ?? DEFAULT_VECTOR_WEIGHT;
    const lines = [
        "Hybrid MVP comparison (messy natural-language queries)",
        `Fusion: keyword×${kw} + vector×${vec} RRF`,
        "",
        formatReportTable([
            { ...cmp.baseline, mode: "full (keyword)" },
            { ...cmp.hybrid, mode: "full-hybrid (RRF)" },
        ]),
        "",
        `Improved: ${cmp.improved.length} queries`,
        `Regressed: ${cmp.regressed.length} queries`,
    ];

    if (cmp.improved.length) {
        lines.push("", "Gains (discover rank improved):");
        for (const r of cmp.improved) {
            const b = cmp.baseline.results.find((x) => x.id === r.id);
            lines.push(`  + ${r.id}: rank ${b?.discover_rank ?? "miss"} → ${r.discover_rank} | "${r.query}"`);
        }
    }

    if (cmp.regressed.length) {
        lines.push("", "Regressions:");
        for (const r of cmp.regressed) {
            const b = cmp.baseline.results.find((x) => x.id === r.id);
            lines.push(`  - ${r.id}: rank ${b?.discover_rank ?? "miss"} → ${r.discover_rank ?? "miss"} | "${r.query}"`);
        }
    }

    const misses = cmp.hybrid.results.filter((r) => r.discover_rank == null || r.discover_rank > 3);
    if (misses.length) {
        lines.push("", `Still missing discover@3 (${misses.length}):`);
        for (const m of misses) {
            lines.push(`  • ${m.id}: "${m.query}" → top: ${m.top_label}`);
        }
    }

    return lines.join("\n");
}

export async function runHybridMvp(bundle, distDir, fusion = {}) {
    const queries = await loadMessyQueries();
    const lanceDir = defaultLanceDir(distDir);

    const baseline = evaluateKeywordOnly(queries, bundle);
    const hybrid = await evaluateHybridMode(queries, bundle, lanceDir, fusion);

    return compareReports(baseline, hybrid);
}

export async function verifyMessyQueries(bundle) {
    const queries = await loadMessyQueries();
    const issues = [];

    for (const q of queries) {
        if (q.expect_intent) {
            const cap = curatedCapabilitiesForSearch(bundle).find((c) => c.id === q.expect_intent);
            if (!cap)
                issues.push(`${q.id}: missing intent ${q.expect_intent}`);
            else if (!cap.satisfies.length) {
                issues.push(`${q.id}: intent ${q.expect_intent} has no materialized candidates`);
            }
        }
        if (q.expect_endpoint) {
            const id = endpointId(q.expect_endpoint.origin, q.expect_endpoint.method, q.expect_endpoint.path);
            const ep = bundle.endpoints.find((e) => e.id === id);
            if (!ep) {
                issues.push(`${q.id}: missing endpoint ${q.expect_endpoint.method} ${q.expect_endpoint.origin}${q.expect_endpoint.path}`);
            }
        }
    }

    return issues;
}