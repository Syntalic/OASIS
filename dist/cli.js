#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { buildIndex } from "./build.js";
import { endpointId } from "./id.js";
import { defaultLanceDir, buildLanceIndex } from "./embed/lance-index.js";
import { DEFAULT_KEYWORD_WEIGHT, DEFAULT_VECTOR_WEIGHT, searchHybridWithFallback, } from "./search-hybrid.js";
import { searchIndex } from "./search.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");
async function loadBundle(distDir) {
    const raw = await readFile(path.join(distDir, "index.json"), "utf8");
    return JSON.parse(raw);
}
function parsePositiveInt(value, flag) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        console.error(`Invalid ${flag}: "${value}" (expected a positive integer)`);
        process.exit(1);
    }
    return n;
}
function parseWeight(value, flag) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
        console.error(`Invalid ${flag}: "${value}" (expected a non-negative number)`);
        process.exit(1);
    }
    return n;
}
function resolveIntent(intentId, bundle) {
    const intent = bundle.capabilities.find((c) => c.id === intentId);
    if (!intent)
        return null;
    const endpoints = [];
    for (const ref of intent.satisfies) {
        const id = endpointId(ref.origin, ref.method, ref.path);
        const ep = bundle.endpoints.find((e) => e.id === id);
        if (ep)
            endpoints.push(ep);
    }
    return { intent, endpoints };
}
const program = new Command();
program
    .name("capindex")
    .description("Vendor-neutral index for x402 and MPP paid API endpoints")
    .version("0.1.0");
program
    .command("build")
    .description("Build index from pay-skills and/or OpenAPI sources")
    .option("--pay-skills <dir>", "Path to pay-skills repo (providers/ directory parent)")
    .option("--openapi <file>", "Single OpenAPI JSON file to ingest")
    .option("--origin <url>", "Origin URL when ingesting a standalone OpenAPI file")
    .option("-o, --output <dir>", "Output directory", path.join(PACKAGE_ROOT, "dist"))
    .option("--no-x402scan", "Skip x402scan sitemap ingest")
    .option("--no-mppscan", "Skip mppscan sitemap + mpp.dev catalog ingest")
    .option("--skip-pay-skills", "Skip pay-skills ingest")
    .option("--max-scan-servers <n>", "Limit x402scan/mppscan server pages fetched (debug)")
    .action(async (opts) => {
    const bundle = await buildIndex({
        paySkillsDir: opts.paySkills,
        openapiFile: opts.openapi,
        origin: opts.origin,
        outputDir: opts.output,
        x402scan: opts.x402scan,
        mppscan: opts.mppscan,
        skipPaySkills: Boolean(opts.skipPaySkills),
        maxScanServers: opts.maxScanServers
            ? Number(opts.maxScanServers)
            : undefined,
    });
    if (!bundle.stats.endpoints) {
        console.error("No endpoints indexed. Pass --pay-skills <dir> or --openapi <file>.");
        process.exitCode = 1;
        return;
    }
    console.log(`Built index v${bundle.index_version}`);
    console.log(`  providers: ${bundle.stats.providers}`);
    console.log(`  origins:   ${bundle.stats.origins}`);
    console.log(`  endpoints: ${bundle.stats.endpoints}`);
    console.log(`  intents:   ${bundle.stats.capabilities}`);
    if (bundle.stats.capability_links != null) {
        console.log(`  linked:    ${bundle.stats.capability_links} endpoints with capability tags`);
    }
    if (bundle.stats.stub_endpoints != null) {
        console.log(`  stubs:     ${bundle.stats.stub_endpoints} thin endpoint records`);
    }
    console.log(`  output:    ${opts.output}`);
});
program
    .command("search <query>")
    .description("Search capabilities and endpoints")
    .option("-l, --limit <n>", "Max results", "10")
    .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
    .option("--hybrid", "Keyword + vector RRF fusion (requires embed)")
    .option("--json", "Output JSON")
    .action(async (query, opts) => {
    const bundle = await loadBundle(opts.dist);
    const limit = parsePositiveInt(opts.limit, "--limit");
    const hits = opts.hybrid
        ? await searchHybridWithFallback(query, bundle, defaultLanceDir(opts.dist), limit)
        : searchIndex(query, bundle.endpoints, bundle.capabilities, limit);
    if (opts.json) {
        console.log(JSON.stringify(hits, null, 2));
        return;
    }
    if (hits.length === 0) {
        console.log("No matches.");
        return;
    }
    for (const hit of hits) {
        const price = hit.price_usd != null ? `$${hit.price_usd.toFixed(4)}` : "—";
        const rails = hit.payment_rails?.join(", ") ?? "";
        const id = hit.capability_id ?? hit.endpoint_id ?? "";
        console.log(`${hit.score.toFixed(2)}\t[${hit.kind}]\t${id}\t${hit.label}\t${price}\t${rails}`);
        if (hit.origin) {
            console.log(`       ${hit.method} ${hit.origin}${hit.path}`);
        }
    }
});
program
    .command("resolve")
    .description("Resolve an intent or endpoint ID")
    .option("--intent <id>", "Capability intent ID")
    .option("--endpoint <id>", "Endpoint SHA-256 ID")
    .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
    .option("--json", "Output JSON")
    .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    if (opts.intent) {
        const resolved = resolveIntent(opts.intent, bundle);
        if (!resolved) {
            console.error(`Intent not found: ${opts.intent}`);
            process.exitCode = 1;
            return;
        }
        const payload = {
            intent: resolved.intent,
            endpoints: resolved.endpoints,
        };
        console.log(opts.json ? JSON.stringify(payload, null, 2) : formatResolve(payload));
        return;
    }
    if (opts.endpoint) {
        const ep = bundle.endpoints.find((e) => e.id === opts.endpoint);
        if (!ep) {
            console.error(`Endpoint not found: ${opts.endpoint}`);
            process.exitCode = 1;
            return;
        }
        console.log(opts.json ? JSON.stringify(ep, null, 2) : formatEndpoint(ep));
        return;
    }
    console.error("Pass --intent <id> or --endpoint <id>");
    process.exitCode = 1;
});
program
    .command("validate")
    .description("Validate dist/index.json against schemas")
    .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
    .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const { validateBundle } = await import("./validate.js");
    const issues = await validateBundle(bundle);
    if (issues.length > 0) {
        for (const issue of issues)
            console.error(issue);
        process.exitCode = 1;
        return;
    }
    console.log("index.json is valid");
});
program
    .command("embed")
    .description("Build LanceDB vector index from capabilities and providers")
    .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
    .option("-o, --output <dir>", "Lance output directory")
    .option("--scope <scope>", "Embed scope: all, capabilities, or curated (ontology YAML subset)", "curated")
    .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const outDir = opts.output ?? defaultLanceDir(opts.dist);
    const scope = opts.scope;
    const result = await buildLanceIndex(bundle, outDir, scope);
    console.log(`Lance index built: ${result.records} vectors (scope=${result.scope})`);
    console.log(`  table: ${result.table}`);
    console.log(`  path:  ${result.path}`);
});
program
    .command("eval")
    .description("Run discovery benchmark against golden queries")
    .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
    .option("--json", "Output JSON report")
    .option("--misses", "Show queries that missed discover@3")
    .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const { runDiscoveryBenchmark, formatReportTable } = await import("./eval/discovery-benchmark.js");
    const reports = await runDiscoveryBenchmark(bundle);
    if (opts.json) {
        console.log(JSON.stringify(reports, null, 2));
        return;
    }
    console.log("Discovery benchmark (golden queries)\n");
    console.log(formatReportTable(reports));
    if (opts.misses) {
        const full = reports.find((r) => r.mode === "full");
        if (full) {
            const misses = full.results.filter((r) => r.discover_rank == null || r.discover_rank > 3);
            if (misses.length) {
                console.log("\nMisses (full index, discover@3):");
                for (const m of misses) {
                    console.log(`  - ${m.id}: "${m.query}" → top: ${m.top_label}`);
                }
            }
            else {
                console.log("\nNo misses — all queries hit discover@3.");
            }
        }
    }
    const { METRICS_LEGEND } = await import("./eval/metrics.js");
    console.log(`\nLegend:\n${METRICS_LEGEND}\n`);
    const full = reports.find((r) => r.mode === "full");
    const paySkills = reports.find((r) => r.mode === "pay-skills-only");
    if (full && paySkills) {
        const cov = bundle.endpoints.length;
        const ps = bundle.endpoints.filter((e) => e.provider_fqn &&
            !e.provider_fqn.startsWith("x402scan/") &&
            !e.provider_fqn.startsWith("mppscan/") &&
            !e.provider_fqn.startsWith("mpp-catalog/")).length;
        console.log(`Coverage: ${cov} unified endpoints vs ${ps} pay-skills-only`);
        console.log(`Full index discover@3: ${full.discover_hit_at_3}/${full.api_queries}`);
        console.log(`pay-skills-only discover@3: ${paySkills.discover_hit_at_3}/${paySkills.api_queries}`);
    }
});
program
    .command("eval:resolve")
    .description("Check curated ontology satisfies refs resolve to indexed endpoints")
    .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
    .option("--json", "Output JSON report")
    .option("--misses", "Show unresolved intents only")
    .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const { runResolveBenchmark, formatResolveReport } = await import("./eval/resolve-benchmark.js");
    const report = await runResolveBenchmark(bundle);
    if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
    }
    else {
        console.log(formatResolveReport(report));
    }
    if (opts.misses) {
        const misses = report.results.filter((r) => !r.resolved);
        if (misses.length) {
            console.log("\nUnresolved (primary satisfies ref):");
            for (const m of misses) {
                const ref = m.primary_ref;
                console.log(`  - ${m.intent_id}: ${ref.method} ${ref.origin}${ref.path}`);
            }
        }
        else {
            console.log("\nNo misses — all curated intents resolve.");
        }
    }
    if (report.missing > 0) {
        process.exitCode = 1;
    }
});
program
    .command("eval:compare")
    .description("Compare discovery methods on messy NL queries (internal slices + external APIs)")
    .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
    .option("--json", "Output JSON report")
    .option("--offline", "Skip live external APIs (cdp-bazaar, mpp-catalog-live)")
    .option("--methods <list>", "Comma-separated methods (default: all)")
    .option("--misses", "Show queries that missed discover@3 per method")
    .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const { runCompareBenchmark, formatCompareTable, VALID_METHODS } = await import("./eval/compare-benchmark.js");
    const methods = opts.methods
        ? opts.methods
            .split(",")
            .map((m) => m.trim())
        : undefined;
    if (methods) {
        const unknown = methods.filter((m) => !VALID_METHODS.has(m));
        if (unknown.length) {
            console.error(`Unknown --methods: ${unknown.join(", ")}. Valid: ${[
                ...VALID_METHODS,
            ].join(", ")}`);
            process.exit(1);
        }
    }
    const reports = await runCompareBenchmark(bundle, {
        distDir: opts.dist,
        offline: Boolean(opts.offline),
        methods,
    });
    if (opts.json) {
        console.log(JSON.stringify(reports, null, 2));
        return;
    }
    console.log(formatCompareTable(reports));
    if (opts.misses) {
        for (const r of reports) {
            const misses = r.results.filter((q) => q.discover_rank == null || q.discover_rank > 3);
            if (misses.length) {
                console.log(`\nMisses — ${r.mode} (${misses.length}):`);
                for (const m of misses) {
                    console.log(`  • ${m.id}: "${m.query}" → top: ${m.top_label}`);
                }
            }
        }
    }
    const { METRICS_LEGEND } = await import("./eval/metrics.js");
    console.log(`\nLegend:\n${METRICS_LEGEND}\n`);
});
program
    .command("eval:hybrid")
    .description("Compare keyword vs hybrid search on messy natural-language queries")
    .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
    .option("--json", "Output JSON report")
    .option("--verify", "Only verify messy-queries.json refs against index")
    .option("--keyword-weight <n>", "RRF weight for keyword ranks", String(DEFAULT_KEYWORD_WEIGHT))
    .option("--vector-weight <n>", "RRF weight for vector ranks", String(DEFAULT_VECTOR_WEIGHT))
    .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const { runHybridMvp, formatHybridComparison, verifyMessyQueries, } = await import("./eval/hybrid-mvp.js");
    if (opts.verify) {
        const issues = await verifyMessyQueries(bundle);
        if (issues.length) {
            for (const issue of issues)
                console.error(issue);
            process.exitCode = 1;
            return;
        }
        console.log("messy-queries.json: all refs valid");
        return;
    }
    const fusion = {
        keywordWeight: parseWeight(opts.keywordWeight, "--keyword-weight"),
        vectorWeight: parseWeight(opts.vectorWeight, "--vector-weight"),
    };
    const comparison = await runHybridMvp(bundle, opts.dist, fusion);
    if (opts.json) {
        console.log(JSON.stringify({ fusion, ...comparison }, null, 2));
        return;
    }
    console.log(formatHybridComparison(comparison, fusion));
});
program
    .command("stats")
    .description("Show index statistics")
    .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
    .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    console.log(JSON.stringify(bundle.stats, null, 2));
    console.log("sources:", bundle.sources);
});
function formatEndpoint(ep) {
    const rails = ep.payment.rails.map((r) => r.protocol).join(", ");
    const price = ep.payment.price_usd != null ? `$${ep.payment.price_usd}` : "—";
    return [
        `${ep.summary}`,
        `  ${ep.method} ${ep.origin}${ep.path}`,
        `  id: ${ep.id}`,
        `  price: ${price}  rails: ${rails}`,
        `  provider: ${ep.provider_fqn ?? "—"}`,
        `  capabilities: ${(ep.capabilities ?? []).join(", ") || "—"}`,
        `  openapi: ${ep.openapi_url ?? "—"}`,
    ].join("\n");
}
function formatResolve(payload) {
    const lines = [
        `Intent: ${payload.intent.id} — ${payload.intent.label}`,
        payload.intent.description ?? "",
        "",
        "Endpoints:",
    ];
    for (const ep of payload.endpoints) {
        lines.push(`  • ${ep.method} ${ep.origin}${ep.path} (${ep.payment.price_usd ?? "?"} USD)`);
    }
    if (payload.endpoints.length === 0) {
        lines.push("  (no indexed endpoints matched — check ontology satisfies refs)");
    }
    return lines.filter(Boolean).join("\n");
}
program.parse();
//# sourceMappingURL=cli.js.map