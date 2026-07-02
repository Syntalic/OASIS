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
import { applyBindings, loadBindings } from "./bind/binding.js";
import { applyFacetOverrides, loadFacetOverrides } from "./bind/facet-overrides.js";
import { deriveEndpointFacets } from "./bind/facets.js";
import { dedupeMirrors } from "./bind/dedup-endpoints.js";
import { bindEndpointsByEmbedding } from "./embed/bind-endpoints.js";
import { gradeEndpoint } from "./bind/quality-gate.js";
import { buildEntityFlow } from "./entity/entity-flow.js";
import { buildEntityIndexFromVocab, loadEntityVocabAndSubtypes } from "./entity/entity-index.js";
import { materializeCuratedIntents } from "./bind/materialize-satisfies.js";
import { loadOntologySources } from "./ontology/ontology.js";
import type {
  CapabilityIntent,
  EndpointRecord,
  Facets,
  IndexBundle,
} from "./core/types.js";

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

  const ingested = bundle.endpoints.map(deriveEndpointFacets);
  // Re-gate + de-mirror before binding: re-applies the current quality gate (e.g. ephemeral preview
  // deploys) and collapses mirror hosts that ingest admitted as distinct records. Lets gate/dedup
  // rules iterate without a re-crawl; idempotent on an already-clean corpus.
  const gated = ingested.filter((e) => gradeEndpoint(e).verdict === "pass");
  const demirror = dedupeMirrors(gated);
  const endpoints = demirror.kept;
  console.error(
    `  re-gate + de-mirror: ${ingested.length} ingested → ${gated.length} gated → ${endpoints.length} (−${demirror.dropped} mirrors)`,
  );

  // Recompute endpoint→capability binding SEMANTICALLY (replaces the regex
  // INTENT_MATCHERS): embed every endpoint + every curated intent and bind by
  // cosine similarity above a floor. This is what removes the satisfies[] junk
  // (e.g. prediction-market endpoints bound to finance.stock_quote). Uses the
  // active embedder — run without GOOGLE_API_KEY to bind with local MiniLM
  // (fast, offline); runtime query→intent routing uses gemini independently.
  const ontologyDir = path.join(PACKAGE_ROOT, "ontology", "intents");
  const sources = await loadOntologySources(ontologyDir);
  // Binder floors are tunable via env (for offline calibration, e.g. the Optuna harness in
  // eval/optuna). Unset → the calibrated defaults in bind-endpoints.ts.
  const envNum = (k: string): number | undefined => {
    const v = process.env[k];
    return v != null && v !== "" ? Number(v) : undefined;
  };
  const bindResult = await bindEndpointsByEmbedding(endpoints, sources, {
    cacheDir: path.join(distDir, "cache"),
    floor: envNum("OASIS_BIND_FLOOR"),
    sparseFloor: envNum("OASIS_BIND_SPARSE_FLOOR"),
    strongSparseFloor: envNum("OASIS_BIND_STRONG_SPARSE"),
    denseMargin: envNum("OASIS_BIND_DENSE_MARGIN"),
    // Lower the DENSE floor for sparse intents the global 0.78 floor starves; the
    // sparse-vocabulary floor still guards against binding noise to them.
    floorOverrides: {
      "shop.price_drop_alert": 0.75,
      "shop.find_deals": 0.75,
      "comms.send_fax": 0.75,
      "shop.inflation_tracker": 0.75,
      "shop.competitive_landscape": 0.75,
    },
  });
  console.error(
    `  hybrid binding: ${bindResult.bound}/${endpoints.length} endpoints → ${bindResult.perIntent.size} curated intents (embedded ${bindResult.embedded}, reused ${bindResult.reused}); ${bindResult.promotedSparse} promoted by strong-sparse; gated ${bindResult.gatedMeta} meta-files + ${bindResult.gatedSparse} below sparse-vocab floor + ${bindResult.gatedMargin} orphaned by margin`,
  );

  // Authored endpoint→capability bindings override the semantic binder.
  const appliedBindings = applyBindings(endpoints, await loadBindings());
  if (appliedBindings) console.error(`  applied ${appliedBindings} authored endpoint binding(s)`);

  // Authored facet overrides (action/domain/entity) — vetted labels that beat the regex deriver and
  // are the only facets the binding gates act on. Mirrors applyBindings, one axis over (facets, not caps).
  const appliedFacets = applyFacetOverrides(endpoints, await loadFacetOverrides());
  if (appliedFacets) console.error(`  applied ${appliedFacets} authored facet override(s)`);

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

  // Per-host intent breadth — # of distinct curated intents a host is bound to. A high value
  // flags a generic multi-tool catch-all (2s.io ~54, agentutility ~53); the serve ranker uses it
  // to down-weight such hosts when they have no task-fit to the routed intent (see select-policy
  // breadthPenalty). Computed here so it ships in the index rather than being patched post-build.
  const hostOf = (origin: string) => origin.replace(/^https?:\/\//, "").split("/")[0];
  const hostIntents = new Map<string, Set<string>>();
  for (const cap of capabilities) {
    for (const ref of cap.satisfies ?? []) {
      const h = hostOf(ref.origin);
      (hostIntents.get(h) ?? hostIntents.set(h, new Set()).get(h)!).add(cap.id);
    }
  }
  for (const ep of endpoints) ep.host_breadth = hostIntents.get(hostOf(ep.origin))?.size ?? 0;

  // Recompute stats on the FINAL post-enrich set — ingest wrote them on the raw gated set
  // (pre-dedup/bind), leaving endpoints/origins high and capabilities pinned at 0.
  const next: IndexBundle = {
    ...bundle,
    endpoints,
    capabilities,
    stats: {
      ...bundle.stats,
      endpoints: endpoints.length,
      capabilities: capabilities.length,
      origins: new Set(endpoints.map((e) => e.origin)).size,
    },
  };

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

  // Entity-flow artifacts for oasis_next — the SAME builders the legacy `capindex build` uses
  // (build.ts). The production ingest+enrich pipeline must emit these or oasis_next has no
  // entity-flow.json and degrades to NOT_READY. Built from the materialized curated capabilities.
  const { vocab, subtypes } = await loadEntityVocabAndSubtypes();
  const entityIndex = buildEntityIndexFromVocab(vocab, subtypes, capabilities);
  const entityFlow = buildEntityFlow(capabilities, entityIndex);
  await writeFile(path.join(distDir, "entity-index.json"), JSON.stringify(entityIndex, null, 2));
  await writeFile(path.join(distDir, "entity-flow.json"), JSON.stringify(entityFlow, null, 2));
  console.error(`  entity-flow: ${(entityIndex.bridge_eligible ?? []).length} bridges → entity-index.json + entity-flow.json`);

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
