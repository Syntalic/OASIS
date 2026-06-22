import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultLanceDir } from "../embed/lance-index.js";
import { buildReport, evaluateMode, expectedEndpointId, } from "./discovery-benchmark.js";
import { searchCdpBazaar } from "./external/cdp-bazaar.js";
import { searchMppCatalogLive } from "./external/mpp-catalog-search.js";
import { evaluateHybridMode, loadMessyQueries, } from "./hybrid-mvp.js";
import { rankExternalHits } from "./url-match.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..", "..");
const DEFAULT_METHODS = [
    "endpoints-only",
    "pay-skills-only",
    "x402scan-only",
    "mpp-only",
    "mpp-catalog-live",
    "cdp-bazaar",
    "full",
    "full-hybrid",
];
/** Every method eval:compare accepts (superset of DEFAULT_METHODS). */
export const VALID_METHODS = new Set([
    "full",
    "endpoints-only",
    "providers-only",
    "pay-skills-only",
    "x402scan-only",
    "mpp-only",
    "cdp-bazaar",
    "mpp-catalog-live",
    "full-hybrid",
]);
function buildExternalReport(method, queries, results, discoverRanks) {
    // External methods have no task-intent signal; literal == discover (URL match).
    return buildReport(method, queries, results, {
        task: [],
        literal: discoverRanks,
        discover: discoverRanks,
    });
}
async function evaluateCdpBazaar(queries, delayMs = 0) {
    const results = [];
    const discoverRanks = [];
    for (const q of queries) {
        const hits = await searchCdpBazaar(q.query, 10);
        const discover = rankExternalHits(hits, q.expect_endpoint);
        if (q.expect_endpoint)
            discoverRanks.push(discover);
        results.push({
            id: q.id,
            query: q.query,
            mode: "cdp-bazaar",
            task_hit: false,
            task_rank: null,
            literal_hit: discover === 1,
            literal_rank: discover,
            discover_hit: discover === 1,
            discover_rank: discover,
            top_label: hits[0]?.description ?? hits[0]?.resource ?? null,
        });
        if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
    return buildExternalReport("cdp-bazaar", queries, results, discoverRanks);
}
async function evaluateMppCatalogLive(queries) {
    const results = [];
    const discoverRanks = [];
    for (const q of queries) {
        const hits = await searchMppCatalogLive(q.query, 10);
        const expectedId = expectedEndpointId(q.expect_endpoint);
        const discover = expectedId != null
            ? hits.findIndex((h) => h.endpoint_id === expectedId)
            : -1;
        const rank = discover >= 0 ? discover + 1 : null;
        if (expectedId)
            discoverRanks.push(rank);
        results.push({
            id: q.id,
            query: q.query,
            mode: "mpp-catalog-live",
            task_hit: false,
            task_rank: null,
            literal_hit: rank === 1,
            literal_rank: rank,
            discover_hit: rank === 1,
            discover_rank: rank,
            top_label: hits[0]?.label ?? null,
        });
    }
    return buildExternalReport("mpp-catalog-live", queries, results, discoverRanks);
}
export async function runCompareBenchmark(bundle, options = {}) {
    const queries = await loadMessyQueries();
    const methods = options.methods ?? DEFAULT_METHODS;
    const unknown = methods.filter((m) => !VALID_METHODS.has(m));
    if (unknown.length) {
        throw new Error(`Unknown method(s): ${unknown.join(", ")}. Valid: ${[
            ...VALID_METHODS,
        ].join(", ")}`);
    }
    const reports = [];
    const skipExternal = options.offline === true;
    for (const method of methods) {
        if (method === "cdp-bazaar") {
            if (skipExternal)
                continue;
            try {
                reports.push(await evaluateCdpBazaar(queries, options.bazaarDelayMs ?? 100));
            }
            catch (err) {
                console.error(`cdp-bazaar: live API failed, reporting as empty (${err instanceof Error ? err.message : String(err)})`);
                reports.push(buildExternalReport("cdp-bazaar", queries, [], []));
            }
            continue;
        }
        if (method === "mpp-catalog-live") {
            if (skipExternal)
                continue;
            try {
                reports.push(await evaluateMppCatalogLive(queries));
            }
            catch (err) {
                console.error(`mpp-catalog-live: live API failed, reporting as empty (${err instanceof Error ? err.message : String(err)})`);
                reports.push(buildExternalReport("mpp-catalog-live", queries, [], []));
            }
            continue;
        }
        if (method === "full-hybrid") {
            const distDir = options.distDir ?? path.join(PACKAGE_ROOT, "dist");
            const hybrid = await evaluateHybridMode(queries, bundle, defaultLanceDir(distDir), {}, "full-hybrid");
            reports.push(hybrid);
            continue;
        }
        const internal = evaluateMode(queries, bundle, method);
        reports.push(internal);
    }
    return reports;
}
export function formatCompareTable(reports) {
    const header = [
        "method".padEnd(22),
        "disc@1".padEnd(8),
        "disc@3".padEnd(8),
        "lit@3".padEnd(8),
        "disc MRR".padEnd(9),
    ].join(" ");
    const lines = [
        "Discovery method comparison (43 messy NL queries)",
        "",
        header,
        "-".repeat(header.length),
    ];
    const LITERAL_ONLY = new Set(["cdp-bazaar", "mpp-catalog-live"]);
    for (const r of reports) {
        const label = LITERAL_ONLY.has(r.mode) ? `${r.mode} †` : String(r.mode);
        lines.push([
            label.padEnd(22),
            `${r.discover_hit_at_1}/${r.task_queries}`.padEnd(8),
            `${r.discover_hit_at_3}/${r.task_queries}`.padEnd(8),
            `${r.literal_hit_at_3}/${r.api_queries}`.padEnd(8),
            r.discover_mrr.toFixed(3).padEnd(9),
        ].join(" "));
    }
    lines.push("", "† cdp-bazaar and mpp-catalog-live score literal URL match only (no ontology", "  resolve); their disc@k is a literal endpoint match, not search→resolve.");
    return lines.join("\n");
}
//# sourceMappingURL=compare-benchmark.js.map