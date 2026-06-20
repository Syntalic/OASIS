import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { linkCapabilitiesToEndpoints, loadOntology } from "./ontology.js";
import { parseOpenApi } from "./openapi-parser.js";
import { ingestPaySkills } from "./pay-skills.js";
import type { EndpointRecord, IndexBundle } from "./types.js";
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
}

function dedupeEndpoints(endpoints: EndpointRecord[]): EndpointRecord[] {
  const map = new Map<string, EndpointRecord>();
  for (const ep of endpoints) {
    const existing = map.get(ep.id);
    if (!existing) {
      map.set(ep.id, ep);
      continue;
    }
    map.set(ep.id, {
      ...existing,
      capabilities: [
        ...new Set([...(existing.capabilities ?? []), ...(ep.capabilities ?? [])]),
      ],
      provider_fqn: existing.provider_fqn ?? ep.provider_fqn,
      provider_title: existing.provider_title ?? ep.provider_title,
      category: existing.category ?? ep.category,
    });
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
  const capabilities = await loadOntology(ontologyDir);

  const sources: IndexBundle["sources"] = [];
  let endpoints: EndpointRecord[] = [];

  const paySkillsDir =
    options.paySkillsDir ??
    (options.openapiFile ? undefined : defaultPaySkillsPath());

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
    } catch (err) {
      console.warn(
        `pay-skills ingest skipped (${paySkillsDir}): ${(err as Error).message}`,
      );
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

  const endpointIndex = new Map<string, EndpointRecord>();
  for (const ep of endpoints) {
    endpointIndex.set(`${ep.origin}|${ep.method}|${ep.path}`, ep);
  }
  linkCapabilitiesToEndpoints(capabilities, endpointIndex);
  endpoints = [...endpointIndex.values()].sort((a, b) =>
    `${a.origin}${a.path}`.localeCompare(`${b.origin}${b.path}`),
  );

  const origins = new Set(endpoints.map((e) => e.origin));
  const providers = new Set(
    endpoints.map((e) => e.provider_fqn).filter(Boolean),
  );

  const bundle: IndexBundle = {
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

  return bundle;
}

export function defaultPaySkillsPath(): string | undefined {
  return path.join(PACKAGE_ROOT, "..", "..", "crush", "api", "pay-skills");
}