#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { buildIndex } from "./build.js";
import { endpointId } from "./id.js";
import { searchIndex } from "./search.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");
async function loadBundle(distDir) {
    const raw = await readFile(path.join(distDir, "index.json"), "utf8");
    return JSON.parse(raw);
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
    console.log(`  output:    ${opts.output}`);
});
program
    .command("search <query>")
    .description("Search capabilities and endpoints")
    .option("-l, --limit <n>", "Max results", "10")
    .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
    .option("--json", "Output JSON")
    .action(async (query, opts) => {
    const bundle = await loadBundle(opts.dist);
    const hits = searchIndex(query, bundle.endpoints, bundle.capabilities, Number(opts.limit));
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