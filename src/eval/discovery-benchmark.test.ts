import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateMode,
  loadEvalQueries,
  runDiscoveryBenchmark,
} from "./discovery-benchmark.js";
import type { IndexBundle } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(__dirname, "..", "..", "dist", "index.json");

async function loadBundle(): Promise<IndexBundle> {
  const raw = await readFile(distIndex, "utf8");
  return JSON.parse(raw) as IndexBundle;
}

describe("discovery benchmark", () => {
  it("loads golden queries", async () => {
    const queries = await loadEvalQueries();
    assert.ok(queries.length >= 50, `expected >= 50 queries, got ${queries.length}`);
  });

  it("full index beats endpoints-only on discover@3", async () => {
    const bundle = await loadBundle();
    const queries = await loadEvalQueries();
    const full = evaluateMode(queries, bundle, "full");
    const endpointsOnly = evaluateMode(queries, bundle, "endpoints-only");

    assert.ok(
      full.task_hit_at_1 > endpointsOnly.task_hit_at_1,
      `task@1: full=${full.task_hit_at_1} endpoints-only=${endpointsOnly.task_hit_at_1}`,
    );
    assert.ok(
      full.discover_hit_at_3 >= endpointsOnly.discover_hit_at_3,
      `discover@3: full=${full.discover_hit_at_3} endpoints-only=${endpointsOnly.discover_hit_at_3}`,
    );
    assert.ok(
      full.discover_mrr >= endpointsOnly.discover_mrr,
      `discover MRR: full=${full.discover_mrr} endpoints-only=${endpointsOnly.discover_mrr}`,
    );
  });

  it("full index beats provider-only catalog search on literal@3", async () => {
    const bundle = await loadBundle();
    const queries = await loadEvalQueries();
    const full = evaluateMode(queries, bundle, "full");
    const providersOnly = evaluateMode(queries, bundle, "providers-only");

    assert.ok(
      full.literal_hit_at_3 > providersOnly.literal_hit_at_3,
      `literal@3: full=${full.literal_hit_at_3} providers-only=${providersOnly.literal_hit_at_3}`,
    );
  });

  it("unified index covers more endpoints than pay-skills slice", async () => {
    const bundle = await loadBundle();
    const paySkillsEps = bundle.endpoints.filter(
      (e) =>
        e.provider_fqn &&
        !e.provider_fqn.startsWith("x402scan/") &&
        !e.provider_fqn.startsWith("mppscan/") &&
        !e.provider_fqn.startsWith("mpp-catalog/"),
    );
    assert.ok(bundle.endpoints.length > paySkillsEps.length * 5);
  });

  it("meets minimum discovery quality bar on golden set", async () => {
    const bundle = await loadBundle();
    const queries = await loadEvalQueries();
    const full = (await runDiscoveryBenchmark(bundle, ["full"]))[0];
    const endpointsOnly = evaluateMode(queries, bundle, "endpoints-only");

    const taskTotal = full.results.filter((r) => r.task_rank != null).length;

    assert.ok(
      full.task_hit_at_3 >= Math.floor(taskTotal * 0.7),
      `task@3 ${full.task_hit_at_3}/${taskTotal}`,
    );
    assert.ok(
      full.discover_hit_at_3 >= Math.floor(taskTotal * 0.9),
      `discover@3 ${full.discover_hit_at_3}/${taskTotal}`,
    );
    assert.ok(
      full.discover_hit_at_3 > endpointsOnly.discover_hit_at_3,
      `full discover@3 ${full.discover_hit_at_3} must beat endpoints-only ${endpointsOnly.discover_hit_at_3}`,
    );
  });
});