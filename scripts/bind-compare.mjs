#!/usr/bin/env node
/**
 * Compare semantic bind rates: baseline (main ontology) vs current (branch ontology).
 * Usage: node scripts/bind-compare.mjs [distDir]
 */
import { execSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const distDir = path.resolve(process.argv[2] ?? path.join(ROOT, "dist"));

const { bindEndpointsByEmbedding } = await import(
  `file://${path.join(ROOT, "dist/embed/bind-endpoints.js")}`
);
const { loadOntologySources } = await import(`file://${path.join(ROOT, "dist/ontology/ontology.js")}`);
const { endpointEmbedText } = await import(`file://${path.join(ROOT, "dist/embed/endpoint-text.js")}`);

async function extractMainOntology(tmpRoot) {
  const out = path.join(tmpRoot, "baseline");
  await mkdir(out, { recursive: true });
  execSync(`git archive main ontology/intents | tar -x -C "${out}"`, { cwd: ROOT, stdio: "pipe" });
  return path.join(out, "ontology", "intents");
}

function cloneEndpoints(bundle) {
  return bundle.endpoints.map((ep) => ({
    ...ep,
    capabilities: [],
  }));
}

async function runBind(label, endpoints, intentsDir, cacheDir) {
  const sources = await loadOntologySources(intentsDir);
  const t0 = Date.now();
  const result = await bindEndpointsByEmbedding(endpoints, sources, {
    cacheDir,
    floorOverrides: {
      "shop.price_drop_alert": 0.75,
      "shop.find_deals": 0.75,
      "comms.send_fax": 0.75,
      "analyst.inflation_tracker": 0.75,
      "marketing.competitive_landscape": 0.75,
    },
  });
  const ms = Date.now() - t0;
  const orphans = endpoints.length - result.bound;
  const rate = ((result.bound / endpoints.length) * 100).toFixed(1);
  console.log(`\n=== ${label} ===`);
  console.log(`  intents: ${sources.length}`);
  console.log(`  bound:   ${result.bound}/${endpoints.length} (${rate}%)`);
  console.log(`  orphans: ${orphans}`);
  console.log(`  sparse promotions: ${result.promotedSparse}`);
  console.log(`  gated meta: ${result.gatedMeta}, gated sparse: ${result.gatedSparse}`);
  console.log(`  elapsed: ${(ms / 1000).toFixed(1)}s (embedded ${result.embedded}, reused ${result.reused})`);
  return { label, result, sources, endpoints };
}

function topIntentDeltas(before, after, topN = 15) {
  const rows = [];
  const allIds = new Set([...before.result.perIntent.keys(), ...after.result.perIntent.keys()]);
  for (const id of allIds) {
    const b = before.result.perIntent.get(id) ?? 0;
    const a = after.result.perIntent.get(id) ?? 0;
    if (a !== b) rows.push({ id, before: b, after: a, delta: a - b });
  }
  rows.sort((x, y) => y.delta - x.delta);
  return rows.slice(0, topN);
}

function sampleNewlyBound(beforeEps, afterEps, limit = 12) {
  const beforeBound = new Set(
    beforeEps.filter((e) => e.capabilities?.length).map((e) => `${e.origin}|${e.method}|${e.path}`),
  );
  const samples = [];
  for (const ep of afterEps) {
    if (!ep.capabilities?.length) continue;
    const key = `${ep.origin}|${ep.method}|${ep.path}`;
    if (beforeBound.has(key)) continue;
    samples.push({
      intent: ep.capabilities[0],
      origin: ep.origin,
      path: ep.path,
      summary: (ep.summary ?? ep.search_text ?? "").slice(0, 100),
    });
    if (samples.length >= limit) break;
  }
  return samples;
}

async function main() {
  const indexPath = path.join(distDir, "index.json");
  const bundle = JSON.parse(await readFile(indexPath, "utf8"));
  const cacheDir = path.join(distDir, "cache");
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "oasis-bind-"));
  const baselineDir = await extractMainOntology(tmpRoot);
  const currentDir = path.join(ROOT, "ontology", "intents");

  console.log(`Corpus: ${bundle.endpoints.length} endpoints from ${indexPath}`);
  console.log(`Baseline ontology: main (${baselineDir})`);
  console.log(`Current ontology:  branch (${currentDir})`);

  const beforeEndpoints = cloneEndpoints(bundle);
  const afterEndpoints = cloneEndpoints(bundle);

  const before = await runBind("BASELINE (main / 56 intents)", beforeEndpoints, baselineDir, cacheDir);
  const after = await runBind("AFTER (branch / 60 intents + widened anchors)", afterEndpoints, currentDir, cacheDir);

  const recovered = after.result.bound - before.result.bound;
  const orphanDrop = beforeEndpoints.length - before.result.bound - (afterEndpoints.length - after.result.bound);
  console.log("\n=== DELTA ===");
  console.log(`  +${recovered} newly bound endpoints`);
  console.log(`  bind rate: ${((before.result.bound / beforeEndpoints.length) * 100).toFixed(1)}% → ${((after.result.bound / afterEndpoints.length) * 100).toFixed(1)}% (+${(recovered / beforeEndpoints.length * 100).toFixed(2)} pp)`);

  const deltas = topIntentDeltas(before, after);
  if (deltas.length) {
    console.log("\nTop intent count changes:");
    for (const row of deltas) {
      const sign = row.delta > 0 ? "+" : "";
      console.log(`  ${row.id}: ${row.before} → ${row.after} (${sign}${row.delta})`);
    }
  }

  const samples = sampleNewlyBound(beforeEndpoints, afterEndpoints);
  if (samples.length) {
    console.log("\nSample newly-bound endpoints:");
    for (const s of samples) {
      console.log(`  [${s.intent}] ${s.origin}${s.path}`);
      if (s.summary) console.log(`    ${s.summary}`);
    }
  }

  const outPath = path.join(tmpRoot, "bind-compare.json");
  await writeFile(
    outPath,
    JSON.stringify(
      {
        corpus: beforeEndpoints.length,
        baseline: {
          bound: before.result.bound,
          orphans: beforeEndpoints.length - before.result.bound,
          rate: before.result.bound / beforeEndpoints.length,
          perIntent: Object.fromEntries(before.result.perIntent),
        },
        after: {
          bound: after.result.bound,
          orphans: afterEndpoints.length - after.result.bound,
          rate: after.result.bound / afterEndpoints.length,
          perIntent: Object.fromEntries(after.result.perIntent),
        },
        delta: { recovered, intentDeltas: topIntentDeltas(before, after, 50), samples },
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${outPath}`);

  await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});