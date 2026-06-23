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
import { applyBindings, loadBindings } from "./binding.js";
import { deriveEndpointFacets } from "./build.js";
import { bindEndpointsByEmbedding } from "./embed/bind-endpoints.js";
import { materializeCuratedIntents } from "./materialize-satisfies.js";
import { loadOntologySources } from "./ontology.js";
import type {
  CapabilityIntent,
  EndpointRecord,
  Facets,
  IndexBundle,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");

/** Re-derive a capability's facets from the endpoints it satisfies (domain only). */
function deriveCapabilityFacets(
  cap: CapabilityIntent,
  endpointFacetByKey: Map<string, EndpointRecord["facets"]>,
): Facets | undefined {
  if (cap.facets) return cap.facets;
  const counts = new Map<string, number>();
  for (const ref of cap.satisfies) {
    const key = `${ref.origin}|${ref.method.toUpperCase()}|${ref.path}`;
    const domain = endpointFacetByKey.get(key)?.domain;
    if (domain) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [domain, n] of counts) {
    if (n > bestN) {
      best = domain;
      bestN = n;
    }
  }
  if (!best) return undefined;
  return { domain: best as Facets["domain"] };
}

export interface EnrichResult {
  endpoints: number;
  endpoints_with_facets: number;
  capabilities: number;
  capabilities_facets_derived: number;
}

export async function enrichFacets(distDir: string): Promise<EnrichResult> {
  const indexPath = path.join(distDir, "index.json");
  const raw = await readFile(indexPath, "utf8");
  const bundle = JSON.parse(raw) as IndexBundle;

  const endpoints = bundle.endpoints.map(deriveEndpointFacets);

  // Recompute endpoint→capability binding SEMANTICALLY (replaces the regex
  // INTENT_MATCHERS): embed every endpoint + every curated intent and bind by
  // cosine similarity above a floor. This is what removes the satisfies[] junk
  // (e.g. prediction-market endpoints bound to finance.stock_quote). Uses the
  // active embedder — run without GOOGLE_API_KEY to bind with local MiniLM
  // (fast, offline); runtime query→intent routing uses gemini independently.
  const ontologyDir = path.join(PACKAGE_ROOT, "ontology", "intents");
  const sources = await loadOntologySources(ontologyDir);
  const bindResult = await bindEndpointsByEmbedding(endpoints, sources);
  console.error(
    `  semantic binding: ${bindResult.bound}/${endpoints.length} endpoints → ${bindResult.perIntent.size} curated intents`,
  );

  // Authored endpoint→capability bindings override the semantic binder.
  const appliedBindings = applyBindings(endpoints, await loadBindings());
  if (appliedBindings) console.error(`  applied ${appliedBindings} authored endpoint binding(s)`);

  const facetByKey = new Map<string, EndpointRecord["facets"]>();
  for (const ep of endpoints) {
    facetByKey.set(`${ep.origin}|${ep.method}|${ep.path}`, ep.facets);
  }

  // Re-materialize curated capabilities from the YAML sources over the frozen,
  // freshly-bound endpoint set (the build's materialize step, run offline).
  const curated = materializeCuratedIntents(sources, endpoints);
  const curatedIds = new Set(curated.map((c) => c.id));

  // Preserve non-curated (provider-derived) capabilities; backfill their facets.
  let derived = 0;
  const preserved = bundle.capabilities
    .filter((cap) => !curatedIds.has(cap.id))
    .map((cap) => {
      if (cap.facets) return cap;
      const facets = deriveCapabilityFacets(cap, facetByKey);
      if (!facets) return cap;
      derived += 1;
      return { ...cap, facets };
    });

  const capabilities: CapabilityIntent[] = [...curated, ...preserved];

  const next: IndexBundle = { ...bundle, endpoints, capabilities };

  await writeFile(indexPath, JSON.stringify(next, null, 2));
  await writeFile(
    path.join(distDir, "endpoints.json"),
    JSON.stringify(
      {
        index_version: next.index_version,
        spec_version: next.spec_version,
        built_at: next.built_at,
        stats: next.stats,
        endpoints: next.endpoints,
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(distDir, "capabilities.json"),
    JSON.stringify(
      {
        index_version: next.index_version,
        spec_version: next.spec_version,
        built_at: next.built_at,
        capabilities: next.capabilities,
      },
      null,
      2,
    ),
  );

  return {
    endpoints: endpoints.length,
    endpoints_with_facets: endpoints.filter((e) => e.facets).length,
    capabilities: capabilities.length,
    capabilities_facets_derived: derived,
  };
}

async function main(): Promise<void> {
  const distDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(PACKAGE_ROOT, "dist");
  const result = await enrichFacets(distDir);
  console.log(`enrich-facets (offline) → ${distDir}`);
  console.log(
    `  endpoints: ${result.endpoints_with_facets}/${result.endpoints} with facets`,
  );
  console.log(
    `  capabilities: ${result.capabilities_facets_derived}/${result.capabilities} facets derived`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
