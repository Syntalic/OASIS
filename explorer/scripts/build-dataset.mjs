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
import { gunzipSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const candidates = [
  process.argv[2],
  process.env.OASIS_INDEX,
  resolve(root, "..", "dist", "index.json"),
  resolve(root, "..", "..", "OASIS", "dist", "index.json"),
  resolve(root, "dist", "index.json"),
].filter(Boolean);

// Source the index: a local built dist/index.json when present (local dev), otherwise the PINNED
// release asset recorded in dist-snapshot.lock.json. This is what makes the deployed dashboard
// auto-refresh on a new index release — publish.sh commits the lock, Vercel rebuilds, and this
// fetches the just-pinned index. Override with OASIS_INDEX (local path) or OASIS_INDEX_URL (gz/json URL).
async function loadIndex() {
  const local = candidates.find((p) => existsSync(p));
  if (local) {
    console.log("Reading index (local):", local);
    return JSON.parse(readFileSync(local, "utf8"));
  }
  let url = process.env.OASIS_INDEX_URL;
  if (!url) {
    const lockPath = resolve(root, "..", "dist-snapshot.lock.json");
    if (!existsSync(lockPath)) {
      console.error("No local index found and no dist-snapshot.lock.json at " + lockPath);
      console.error("Build the index (`pnpm run build`) or set OASIS_INDEX / OASIS_INDEX_URL.");
      process.exit(1);
    }
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const repo = process.env.OASIS_REPO || "Syntalic/OASIS";
    url = `https://github.com/${repo}/releases/download/${lock.release_tag}/${lock.asset || "index.json.gz"}`;
  }
  console.log("No local index; fetching pinned release:", url);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    console.error(`Failed to fetch pinned index (${res.status} ${res.statusText}): ${url}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const json = url.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  return JSON.parse(json);
}

const d = await loadIndex();

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
