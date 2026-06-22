#!/usr/bin/env node
/**
 * Offline facet enrichment over a frozen endpoint set.
 *
 * Reads an already-built dist/index.json, applies deriveEndpointFacets() to every
 * endpoint, re-derives capability facets where absent (from the facets of the
 * endpoints a capability satisfies), and rewrites dist/index.json,
 * dist/endpoints.json, and dist/capabilities.json. It does NOT re-ingest from the
 * network, so it refreshes facets without endpoint drift.
 *
 * Run:  node dist/enrich-facets.js [distDir]   (default distDir: ./dist)
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveEndpointFacets } from "./build.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");
/** Re-derive a capability's facets from the endpoints it satisfies (domain only). */
function deriveCapabilityFacets(cap, endpointFacetByKey) {
    if (cap.facets)
        return cap.facets;
    const counts = new Map();
    for (const ref of cap.satisfies) {
        const key = `${ref.origin}|${ref.method.toUpperCase()}|${ref.path}`;
        const domain = endpointFacetByKey.get(key)?.domain;
        if (domain)
            counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
    let best;
    let bestN = 0;
    for (const [domain, n] of counts) {
        if (n > bestN) {
            best = domain;
            bestN = n;
        }
    }
    if (!best)
        return undefined;
    return { domain: best };
}
export async function enrichFacets(distDir) {
    const indexPath = path.join(distDir, "index.json");
    const raw = await readFile(indexPath, "utf8");
    const bundle = JSON.parse(raw);
    const endpoints = bundle.endpoints.map(deriveEndpointFacets);
    const facetByKey = new Map();
    for (const ep of endpoints) {
        facetByKey.set(`${ep.origin}|${ep.method}|${ep.path}`, ep.facets);
    }
    let derived = 0;
    const capabilities = bundle.capabilities.map((cap) => {
        if (cap.facets)
            return cap;
        const facets = deriveCapabilityFacets(cap, facetByKey);
        if (!facets)
            return cap;
        derived += 1;
        return { ...cap, facets };
    });
    const next = { ...bundle, endpoints, capabilities };
    await writeFile(indexPath, JSON.stringify(next, null, 2));
    await writeFile(path.join(distDir, "endpoints.json"), JSON.stringify({
        index_version: next.index_version,
        spec_version: next.spec_version,
        built_at: next.built_at,
        stats: next.stats,
        endpoints: next.endpoints,
    }, null, 2));
    await writeFile(path.join(distDir, "capabilities.json"), JSON.stringify({
        index_version: next.index_version,
        spec_version: next.spec_version,
        built_at: next.built_at,
        capabilities: next.capabilities,
    }, null, 2));
    return {
        endpoints: endpoints.length,
        endpoints_with_facets: endpoints.filter((e) => e.facets).length,
        capabilities: capabilities.length,
        capabilities_facets_derived: derived,
    };
}
async function main() {
    const distDir = process.argv[2]
        ? path.resolve(process.argv[2])
        : path.join(PACKAGE_ROOT, "dist");
    const result = await enrichFacets(distDir);
    console.log(`enrich-facets (offline) → ${distDir}`);
    console.log(`  endpoints: ${result.endpoints_with_facets}/${result.endpoints} with facets`);
    console.log(`  capabilities: ${result.capabilities_facets_derived}/${result.capabilities} facets derived`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=enrich-facets.js.map