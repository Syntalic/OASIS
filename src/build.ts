import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { linkCapabilitiesToEndpoints, loadOntology } from "./ontology.js";
import {
  expandOntologyFromKeywords,
  expandOntologyFromProviders,
  inferCapabilityLinks,
} from "./ontology-expand.js";
import { isStubEndpoint } from "./openapi-fetch.js";
import { parseOpenApi } from "./openapi-parser.js";
import { ingestMppCatalog } from "./ingest/mpp-catalog.js";
import { ingestScanSitemap } from "./ingest/scan-sitemap.js";
import { ingestPaySkills } from "./pay-skills.js";
import { buildProviderRecords, enrichEndpointsWithProviders } from "./providers.js";
import type { EndpointRecord, IndexBundle, PaySkillsProvider } from "./types.js";
import { validateBundle } from "./validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");
const SPEC_VERSION = "0.1.0";
const INDEX_VERSION = "0.1.0";

export interface BuildOptions {
  paySkillsDir?: string;
  openapiFile?: string;
  origin?: string;
  outputDir?: string;
  ontologyDir?: string;
  /** Ingest x402scan.com server sitemap + per-origin OpenAPI (default: true). */
  x402scan?: boolean;
  /** Ingest mppscan.com server sitemap + mpp.dev catalog (default: true). */
  mppscan?: boolean;
  maxScanServers?: number;
  skipPaySkills?: boolean;
}

function mergeEndpointPair(
  existing: EndpointRecord,
  ep: EndpointRecord,
): EndpointRecord {
  const prefer =
    isStubEndpoint(existing) && !isStubEndpoint(ep)
      ? ep
      : !isStubEndpoint(existing) && isStubEndpoint(ep)
        ? existing
        : ep;
  const other = prefer === ep ? existing : ep;
  const railKey = (r: { protocol: string }) => r.protocol;
  const rails = [...existing.payment.rails, ...ep.payment.rails];
  const railsDeduped = [...new Map(rails.map((r) => [railKey(r), r])).values()];
  return {
    ...other,
    ...prefer,
    capabilities: [
      ...new Set([...(existing.capabilities ?? []), ...(ep.capabilities ?? [])]),
    ],
    provider_fqn: existing.provider_fqn ?? ep.provider_fqn,
    provider_title: prefer.provider_title ?? other.provider_title,
    category: prefer.category ?? other.category,
    summary:
      prefer.summary.length >= other.summary.length ? prefer.summary : other.summary,
    description: prefer.description ?? other.description,
    inputs: prefer.inputs?.length ? prefer.inputs : other.inputs,
    operation_id: prefer.operation_id ?? other.operation_id,
    tags: prefer.tags?.length ? prefer.tags : other.tags,
    guidance_available: prefer.guidance_available || other.guidance_available,
    openapi_url: prefer.openapi_url ?? other.openapi_url,
    payment: {
      paid: existing.payment.paid || ep.payment.paid,
      price_usd: prefer.payment.price_usd ?? other.payment.price_usd,
      rails: railsDeduped.length ? railsDeduped : existing.payment.rails,
    },
    search_text: `${existing.search_text} ${ep.search_text}`.trim(),
  };
}

function dedupeEndpoints(endpoints: EndpointRecord[]): EndpointRecord[] {
  const map = new Map<string, EndpointRecord>();
  for (const ep of endpoints) {
    const existing = map.get(ep.id);
    map.set(ep.id, existing ? mergeEndpointPair(existing, ep) : ep);
  }
  return [...map.values()].sort((a, b) =>
    `${a.origin}${a.path}`.localeCompare(`${b.origin}${b.path}`),
  );
}

export async function buildIndex(options: BuildOptions = {}): Promise<IndexBundle> {
  const builtAt = new Date().toISOString();
  const outputDir = options.outputDir ?? path.join(PACKAGE_ROOT, "dist");
  const ontologyDir =
    options.ontologyDir ?? path.join(PACKAGE_ROOT, "ontology", "intents");
  const curatedCapabilities = await loadOntology(ontologyDir);

  const sources: IndexBundle["sources"] = [];
  let endpoints: EndpointRecord[] = [];
  let paySkillsProviders: PaySkillsProvider[] = [];

  const useScans = options.x402scan !== false || options.mppscan !== false;

  const paySkillsDir =
    options.skipPaySkills || options.openapiFile
      ? options.paySkillsDir
      : (options.paySkillsDir ?? defaultPaySkillsPath());

  if (paySkillsDir) {
    try {
      await access(paySkillsDir);
      const ingested = await ingestPaySkills(paySkillsDir, builtAt);
      paySkillsProviders = ingested.providers;
      endpoints.push(...ingested.endpoints);
      sources.push({
        name: "pay-skills",
        path: paySkillsDir,
        providers: ingested.providers.length,
        endpoints: ingested.endpoints.length,
      });
    } catch (err) {
      console.warn(
        `pay-skills ingest skipped (${paySkillsDir}): ${(err as Error).message}`,
      );
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
    } catch (err) {
      console.warn(`mpp catalog ingest failed: ${(err as Error).message}`);
    }
  }

  if (options.x402scan !== false && useScans) {
    try {
      const x402 = await ingestScanSitemap({
        sitemapUrl: "https://www.x402scan.com/sitemap.xml",
        sourceName: "x402scan",
        builtAt,
        maxServers: options.maxScanServers,
        fetchOpenApi: true,
      });
      endpoints.push(...x402.endpoints);
      sources.push({
        name: "x402scan",
        path: "https://www.x402scan.com/sitemap.xml",
        providers: x402.origins,
        endpoints: x402.endpoints.length,
      });
      console.log(
        `  x402scan: ${x402.servers} servers → ${x402.origins} origins → ${x402.endpoints.length} endpoints`,
      );
    } catch (err) {
      console.warn(`x402scan ingest failed: ${(err as Error).message}`);
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
      console.log(
        `  mppscan: ${mppScan.servers} servers → ${mppScan.origins} origins → ${mppScan.endpoints.length} endpoints`,
      );
    } catch (err) {
      console.warn(`mppscan ingest failed: ${(err as Error).message}`);
    }
  }

  if (options.openapiFile) {
    const raw = await readFile(options.openapiFile, "utf8");
    const doc = JSON.parse(raw) as Record<string, unknown>;
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

  const providers = buildProviderRecords(endpoints, paySkillsProviders);
  enrichEndpointsWithProviders(endpoints, providers);

  let capabilities = expandOntologyFromProviders(
    curatedCapabilities,
    paySkillsProviders,
    endpoints,
  );
  capabilities = expandOntologyFromKeywords(capabilities, endpoints);

  const endpointIndex = new Map<string, EndpointRecord>();
  for (const ep of endpoints) {
    endpointIndex.set(`${ep.origin}|${ep.method}|${ep.path}`, ep);
  }
  linkCapabilitiesToEndpoints(capabilities, endpointIndex);
  const capabilityLinks = inferCapabilityLinks(capabilities, endpointIndex);
  endpoints = [...endpointIndex.values()].sort((a, b) =>
    `${a.origin}${a.path}`.localeCompare(`${b.origin}${b.path}`),
  );

  const origins = new Set(endpoints.map((e) => e.origin));
  const stubEndpoints = endpoints.filter(isStubEndpoint).length;
  const linkedEndpoints = endpoints.filter((e) => e.capabilities?.length).length;

  const bundle: IndexBundle = {
    index_version: INDEX_VERSION,
    spec_version: SPEC_VERSION,
    built_at: builtAt,
    sources,
    stats: {
      providers: providers.length,
      endpoints: endpoints.length,
      capabilities: capabilities.length,
      origins: origins.size,
      capability_links: linkedEndpoints,
      stub_endpoints: stubEndpoints,
    },
    endpoints,
    capabilities,
    providers,
  };

  const issues = await validateBundle(bundle);
  if (issues.length > 0) {
    console.warn("Validation warnings:");
    for (const issue of issues) console.warn(`  - ${issue}`);
  }

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, "index.json"),
    JSON.stringify(bundle, null, 2),
  );
  await writeFile(
    path.join(outputDir, "endpoints.json"),
    JSON.stringify(
      {
        index_version: bundle.index_version,
        spec_version: bundle.spec_version,
        built_at: bundle.built_at,
        stats: bundle.stats,
        endpoints: bundle.endpoints,
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(outputDir, "capabilities.json"),
    JSON.stringify(
      {
        index_version: bundle.index_version,
        spec_version: bundle.spec_version,
        built_at: bundle.built_at,
        capabilities: bundle.capabilities,
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(outputDir, "providers.json"),
    JSON.stringify(
      {
        index_version: bundle.index_version,
        spec_version: bundle.spec_version,
        built_at: bundle.built_at,
        stats: { providers: providers.length },
        providers: bundle.providers,
      },
      null,
      2,
    ),
  );

  return bundle;
}

export function defaultPaySkillsPath(): string | undefined {
  return path.join(PACKAGE_ROOT, "..", "..", "crush", "api", "pay-skills");
}