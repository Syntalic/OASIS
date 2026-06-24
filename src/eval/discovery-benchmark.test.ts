import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { defaultLanceDir } from "../embed/lance-index.js";
import { evaluateMode, loadEvalQueries } from "./discovery-benchmark.js";
import { evaluateHybridMode, loadMessyQueries } from "./hybrid-mvp.js";
import type { IndexBundle } from "../types.js";
import { oasisDistDir, oasisDistIndex, SKIP_NO_INDEX, skipIfPinned } from "../test-helpers.js";

const distIndex = oasisDistIndex();
const distDir = oasisDistDir();

async function loadBundle(): Promise<IndexBundle> {
  const raw = await readFile(distIndex, "utf8");
  return JSON.parse(raw) as IndexBundle;
}

// dist/index.json is a build artifact (gitignored, not committed). These
// benchmarks run locally after `pnpm run build`; they skip when it is absent
// (e.g. CI that only compiles) rather than fail.
describe("discovery benchmark", () => {
  it("loads golden queries", async () => {
    const queries = await loadEvalQueries();
    assert.ok(queries.length >= 50, `expected >= 50 queries, got ${queries.length}`);
  });

  it("oasis_find (hybrid) beats endpoints-only on messy discover@3", async (t) => {
    if (skipIfPinned(t)) return;
    if (!existsSync(distIndex)) return t.skip(SKIP_NO_INDEX);
    const bundle = await loadBundle();
    const queries = await loadMessyQueries();
    const lanceDir = defaultLanceDir(distDir);
    const full = await evaluateHybridMode(queries, bundle, lanceDir, {}, "full");
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

  it("keyword index beats provider-only catalog search on messy literal@3", async (t) => {
    if (skipIfPinned(t)) return;
    if (!existsSync(distIndex)) return t.skip(SKIP_NO_INDEX);
    const bundle = await loadBundle();
    const queries = await loadMessyQueries();
    const full = evaluateMode(queries, bundle, "full");
    const providersOnly = evaluateMode(queries, bundle, "providers-only");

    assert.ok(
      full.literal_hit_at_3 >= providersOnly.literal_hit_at_3,
      `literal@3: full=${full.literal_hit_at_3} providers-only=${providersOnly.literal_hit_at_3}`,
    );
  });

  it("unified index covers more endpoints than pay-skills slice", async (t) => {
    if (skipIfPinned(t)) return;
    if (!existsSync(distIndex)) return t.skip(SKIP_NO_INDEX);
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

  it("meets minimum discovery quality bar on messy set (E3 harness)", async (t) => {
    if (skipIfPinned(t)) return;
    if (!existsSync(distIndex)) return t.skip(SKIP_NO_INDEX);
    const bundle = await loadBundle();
    const queries = await loadMessyQueries();
    const lanceDir = defaultLanceDir(distDir);
    const full = await evaluateHybridMode(queries, bundle, lanceDir, {}, "full");
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