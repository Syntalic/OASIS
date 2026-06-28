#!/usr/bin/env node
/**
 * Regenerate src/data/ontology.json from a built OASIS index.
 *
 * The explorer ships a slim, denormalized graph derived from the full OASIS
 * index (dist/index.json), which is ~50 MB and gitignored. This script distills
 * it to the ~150 KB the UI actually needs: domains, capabilities (with facets,
 * entities, endpoint counts, top providers and a few sample endpoints) and the
 * entity producer/consumer adjacency.
 *
 * Usage:
 *   node scripts/build-dataset.mjs [path/to/index.json]
 *   OASIS_INDEX=/abs/path/to/index.json node scripts/build-dataset.mjs
 *
 * Default search order for the index:
 *   $OASIS_INDEX, ../dist/index.json, ../../OASIS/dist/index.json, ./dist/index.json
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const candidates = [
  process.argv[2],
  process.env.OASIS_INDEX,
  resolve(root, "..", "dist", "index.json"),
  resolve(root, "..", "..", "OASIS", "dist", "index.json"),
  resolve(root, "dist", "index.json"),
].filter(Boolean);

const indexPath = candidates.find((p) => existsSync(p));
if (!indexPath) {
  console.error("Could not find an OASIS index.json. Tried:\n" + candidates.map((c) => "  " + c).join("\n"));
  console.error("\nBuild it in the OASIS repo with `pnpm run build`, or pass a path explicitly.");
  process.exit(1);
}

console.log("Reading index:", indexPath);
const d = JSON.parse(readFileSync(indexPath, "utf8"));

const hostOf = (origin) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

const capabilities = d.capabilities.map((c) => {
  const sat = c.satisfies ?? [];
  const hostCount = {};
  for (const s of sat) {
    const h = hostOf(s.origin);
    hostCount[h] = (hostCount[h] ?? 0) + 1;
  }
  const topProviders = Object.entries(hostCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([host, n]) => ({ host, n }));

  return {
    id: c.id,
    label: c.label,
    description: c.description ?? "",
    aliases: c.aliases ?? [],
    domain: c.facets?.domain ?? "other",
    action: c.facets?.action ?? null,
    modality: c.facets?.modality ?? [],
    freshness: c.facets?.freshness ?? null,
    consumes: (c.consumes ?? []).map((p) => ({ entity: p.entity, role: p.role ?? null, format: p.format ?? null })),
    produces: (c.produces ?? []).map((p) => ({ entity: p.entity, role: p.role ?? null, format: p.format ?? null })),
    endpointCount: sat.length,
    topProviders,
    sampleEndpoints: sat.slice(0, 6).map((s) => ({
      origin: s.origin,
      method: s.method,
      path: s.path,
      source: s.source ?? null,
      confidence: s.confidence ?? null,
    })),
  };
});

// entities (producer/consumer adjacency)
const entMap = {};
for (const c of capabilities) {
  for (const p of c.produces) (entMap[p.entity] ??= { name: p.entity, producedBy: [], consumedBy: [] }).producedBy.push(c.id);
  for (const p of c.consumes) (entMap[p.entity] ??= { name: p.entity, producedBy: [], consumedBy: [] }).consumedBy.push(c.id);
}
const entities = Object.values(entMap).sort((a, b) => a.name.localeCompare(b.name));

// domains
const domMap = {};
for (const c of capabilities) {
  (domMap[c.domain] ??= { id: c.domain, capabilities: [], endpointCount: 0 });
  domMap[c.domain].capabilities.push(c.id);
  domMap[c.domain].endpointCount += c.endpointCount;
}
const domains = Object.values(domMap).sort((a, b) => b.capabilities.length - a.capabilities.length);

const out = {
  built_at: d.built_at,
  stats: {
    domains: domains.length,
    capabilities: capabilities.length,
    entities: entities.length,
    boundEndpoints: capabilities.reduce((s, c) => s + c.endpointCount, 0),
  },
  domains,
  entities,
  capabilities,
};

const outPath = resolve(root, "src", "data", "ontology.json");
writeFileSync(outPath, JSON.stringify(out));
console.log("Wrote", outPath, (JSON.stringify(out).length / 1024).toFixed(1) + " KB");
console.log("Stats:", JSON.stringify(out.stats));
