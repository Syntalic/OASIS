import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { linkCapabilitiesToEndpoints, loadOntology } from "./ontology.js";
import { parseOpenApi } from "./openapi-parser.js";
import { ingestMppCatalog } from "./ingest/mpp-catalog.js";
import { ingestScanSitemap } from "./ingest/scan-sitemap.js";
import { ingestPaySkills } from "./pay-skills.js";
import { validateBundle } from "./validate.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");
const SPEC_VERSION = "0.1.0";
const INDEX_VERSION = "0.1.0";
function dedupeEndpoints(endpoints) {
    const map = new Map();
    for (const ep of endpoints) {
        const existing = map.get(ep.id);
        if (!existing) {
            map.set(ep.id, ep);
            continue;
        }
        const railKey = (r) => r.protocol;
        const rails = [...existing.payment.rails, ...ep.payment.rails];
        const railsDeduped = [
            ...new Map(rails.map((r) => [railKey(r), r])).values(),
        ];
        map.set(ep.id, {
            ...existing,
            capabilities: [
                ...new Set([...(existing.capabilities ?? []), ...(ep.capabilities ?? [])]),
            ],
            provider_fqn: existing.provider_fqn ?? ep.provider_fqn,
            provider_title: existing.provider_title ?? ep.provider_title,
            category: existing.category ?? ep.category,
            summary: ep.summary.length > existing.summary.length ? ep.summary : existing.summary,
            description: existing.description ?? ep.description,
            payment: {
                paid: existing.payment.paid || ep.payment.paid,
                price_usd: existing.payment.price_usd ?? ep.payment.price_usd,
                rails: railsDeduped.length ? railsDeduped : existing.payment.rails,
            },
            search_text: `${existing.search_text} ${ep.search_text}`.trim(),
        });
    }
    return [...map.values()].sort((a, b) => `${a.origin}${a.path}`.localeCompare(`${b.origin}${b.path}`));
}
export async function buildIndex(options = {}) {
    const builtAt = new Date().toISOString();
    const outputDir = options.outputDir ?? path.join(PACKAGE_ROOT, "dist");
    const ontologyDir = options.ontologyDir ?? path.join(PACKAGE_ROOT, "ontology", "intents");
    const capabilities = await loadOntology(ontologyDir);
    const sources = [];
    let endpoints = [];
    const useScans = options.x402scan !== false || options.mppscan !== false;
    const paySkillsDir = options.skipPaySkills || options.openapiFile
        ? options.paySkillsDir
        : (options.paySkillsDir ?? defaultPaySkillsPath());
    if (paySkillsDir) {
        try {
            await access(paySkillsDir);
            const ingested = await ingestPaySkills(paySkillsDir, builtAt);
            endpoints.push(...ingested.endpoints);
            sources.push({
                name: "pay-skills",
                path: paySkillsDir,
                providers: ingested.providers.length,
                endpoints: ingested.endpoints.length,
            });
        }
        catch (err) {
            console.warn(`pay-skills ingest skipped (${paySkillsDir}): ${err.message}`);
        }
    }
    if (options.mppscan !== false) {
        try {
            const mpp = await ingestMppCatalog(builtAt);
            endpoints.push(...mpp);
            sources.push({
                name: "mpp-catalog",
                path: "https://mpp.dev/api/services",
                endpoints: mpp.length,
            });
        }
        catch (err) {
            console.warn(`mpp catalog ingest failed: ${err.message}`);
        }
    }
    if (options.x402scan !== false && useScans) {
        try {
            const x402 = await ingestScanSitemap({
                sitemapUrl: "https://www.x402scan.com/sitemap.xml",
                sourceName: "x402scan",
                builtAt,
                maxServers: options.maxScanServers,
            });
            endpoints.push(...x402.endpoints);
            sources.push({
                name: "x402scan",
                path: "https://www.x402scan.com/sitemap.xml",
                providers: x402.origins,
                endpoints: x402.endpoints.length,
            });
            console.log(`  x402scan: ${x402.servers} servers → ${x402.origins} origins → ${x402.endpoints.length} endpoints`);
        }
        catch (err) {
            console.warn(`x402scan ingest failed: ${err.message}`);
        }
    }
    if (options.mppscan !== false && useScans) {
        try {
            const mppScan = await ingestScanSitemap({
                sitemapUrl: "https://www.mppscan.com/sitemap.xml",
                sourceName: "mppscan",
                builtAt,
                maxServers: options.maxScanServers,
                fetchOpenApi: true,
            });
            endpoints.push(...mppScan.endpoints);
            sources.push({
                name: "mppscan",
                path: "https://www.mppscan.com/sitemap.xml",
                providers: mppScan.origins,
                endpoints: mppScan.endpoints.length,
            });
            console.log(`  mppscan: ${mppScan.servers} servers → ${mppScan.origins} origins → ${mppScan.endpoints.length} endpoints`);
        }
        catch (err) {
            console.warn(`mppscan ingest failed: ${err.message}`);
        }
    }
    if (options.openapiFile) {
        const raw = await readFile(options.openapiFile, "utf8");
        const doc = JSON.parse(raw);
        const parsed = parseOpenApi(doc, {
            origin: options.origin,
            builtAt,
        });
        endpoints.push(...parsed);
        sources.push({
            name: "openapi",
            path: options.openapiFile,
            endpoints: parsed.length,
        });
    }
    endpoints = dedupeEndpoints(endpoints);
    const endpointIndex = new Map();
    for (const ep of endpoints) {
        endpointIndex.set(`${ep.origin}|${ep.method}|${ep.path}`, ep);
    }
    linkCapabilitiesToEndpoints(capabilities, endpointIndex);
    endpoints = [...endpointIndex.values()].sort((a, b) => `${a.origin}${a.path}`.localeCompare(`${b.origin}${b.path}`));
    const origins = new Set(endpoints.map((e) => e.origin));
    const providers = new Set(endpoints.map((e) => e.provider_fqn).filter(Boolean));
    const bundle = {
        index_version: INDEX_VERSION,
        spec_version: SPEC_VERSION,
        built_at: builtAt,
        sources,
        stats: {
            providers: providers.size,
            endpoints: endpoints.length,
            capabilities: capabilities.length,
            origins: origins.size,
        },
        endpoints,
        capabilities,
    };
    const issues = await validateBundle(bundle);
    if (issues.length > 0) {
        console.warn("Validation warnings:");
        for (const issue of issues)
            console.warn(`  - ${issue}`);
    }
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "index.json"), JSON.stringify(bundle, null, 2));
    await writeFile(path.join(outputDir, "endpoints.json"), JSON.stringify({
        index_version: bundle.index_version,
        spec_version: bundle.spec_version,
        built_at: bundle.built_at,
        stats: bundle.stats,
        endpoints: bundle.endpoints,
    }, null, 2));
    await writeFile(path.join(outputDir, "capabilities.json"), JSON.stringify({
        index_version: bundle.index_version,
        spec_version: bundle.spec_version,
        built_at: bundle.built_at,
        capabilities: bundle.capabilities,
    }, null, 2));
    return bundle;
}
export function defaultPaySkillsPath() {
    return path.join(PACKAGE_ROOT, "..", "..", "crush", "api", "pay-skills");
}
//# sourceMappingURL=build.js.map