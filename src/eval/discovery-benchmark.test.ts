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

  it("full index beats endpoints-only on workflow discovery", async () => {
    const bundle = await loadBundle();
    const queries = await loadEvalQueries();
    const full = evaluateMode(queries, bundle, "full");
    const endpointsOnly = evaluateMode(queries, bundle, "endpoints-only");

    assert.ok(
      full.intent_hit_at_1 > endpointsOnly.intent_hit_at_1,
      `intent@1: full=${full.intent_hit_at_1} endpoints-only=${endpointsOnly.intent_hit_at_1}`,
    );
    assert.ok(
      full.workflow_hit_at_3 >= endpointsOnly.workflow_hit_at_3,
      `workflow@3: full=${full.workflow_hit_at_3} endpoints-only=${endpointsOnly.workflow_hit_at_3}`,
    );
    assert.ok(
      full.workflow_mrr >= endpointsOnly.workflow_mrr,
      `workflow MRR: full=${full.workflow_mrr} endpoints-only=${endpointsOnly.workflow_mrr}`,
    );
  });

  it("full index beats provider-only catalog search on endpoint@3", async () => {
    const bundle = await loadBundle();
    const queries = await loadEvalQueries();
    const full = evaluateMode(queries, bundle, "full");
    const providersOnly = evaluateMode(queries, bundle, "providers-only");

    assert.ok(
      full.endpoint_hit_at_3 > providersOnly.endpoint_hit_at_3,
      `endpoint@3: full=${full.endpoint_hit_at_3} providers-only=${providersOnly.endpoint_hit_at_3}`,
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

    const intentTotal = full.results.filter((r) => r.intent_rank != null).length;
    const epTotal = full.results.filter((r) => r.endpoint_rank != null).length;

    assert.ok(
      full.intent_hit_at_3 >= Math.floor(intentTotal * 0.7),
      `intent@3 ${full.intent_hit_at_3}/${intentTotal}`,
    );
    assert.ok(
      full.workflow_hit_at_3 >= Math.floor(epTotal * 0.65),
      `workflow@3 ${full.workflow_hit_at_3}/${epTotal}`,
    );
    assert.ok(
      full.workflow_hit_at_3 > endpointsOnly.workflow_hit_at_3,
      `full workflow@3 ${full.workflow_hit_at_3} must beat endpoints-only ${endpointsOnly.workflow_hit_at_3}`,
    );
  });
});