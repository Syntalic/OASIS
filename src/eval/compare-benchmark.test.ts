import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { evaluateMode } from "./discovery-benchmark.js";
import { runCompareBenchmark } from "./compare-benchmark.js";
import type { IndexBundle } from "../types.js";
import { oasisDistIndex, SKIP_NO_INDEX, skipIfPinned } from "../test-helpers.js";

const distIndex = oasisDistIndex();

async function loadBundle(): Promise<IndexBundle> {
  const raw = await readFile(distIndex, "utf8");
  return JSON.parse(raw) as IndexBundle;
}

// dist/index.json is a build artifact (gitignored). Skip when absent rather
// than fail (e.g. CI that only compiles); run after `pnpm run build` locally.
describe("compare benchmark", () => {
  it("full index beats every baseline on messy discover@3", async (t) => {
    if (skipIfPinned(t)) return;
    if (!existsSync(distIndex)) return t.skip(SKIP_NO_INDEX);
    const bundle = await loadBundle();
    const { loadMessyQueries } = await import("./hybrid-mvp.js");
    const queries = await loadMessyQueries();
    const full = evaluateMode(queries, bundle, "full");
    const baselines = [
      ["endpoints-only", evaluateMode(queries, bundle, "endpoints-only")],
    ] as const;

    for (const [name, other] of baselines) {
      assert.ok(
        full.discover_hit_at_3 >= other.discover_hit_at_3,
        `discover@3: full=${full.discover_hit_at_3} ${name}=${other.discover_hit_at_3}`,
      );
      assert.ok(
        full.task_hit_at_3 >= other.task_hit_at_3,
        `task@3: full=${full.task_hit_at_3} ${name}=${other.task_hit_at_3}`,
      );
    }

    // Tolerance of 1: this messy/colloquial set is corpus-sensitive; the precision cleanup
    // (mirror-dedup + spill-orphan) can tip a single borderline query past rank 3 without losing
    // the capability (e.g. "robocall…" → comms.voice_call, which still has 17 bound endpoints).
    const taskQueries = queries.filter((q) => q.expect_intent).length;
    assert.ok(
      full.discover_hit_at_3 >= taskQueries - 1,
      `discover@3 ≥${taskQueries - 1}/${taskQueries} messy intent queries (got ${full.discover_hit_at_3})`,
    );
  });

  it("runs offline compare without external APIs", async (t) => {
    if (skipIfPinned(t)) return;
    if (!existsSync(distIndex)) return t.skip(SKIP_NO_INDEX);
    const bundle = await loadBundle();
    const reports = await runCompareBenchmark(bundle, {
      offline: true,
      methods: ["full", "endpoints-only", "providers-only"],
    });
    assert.equal(reports.length, 3);
    assert.ok(reports.some((r) => r.mode === "full"));
    assert.ok(reports.some((r) => r.mode === "endpoints-only"));
    assert.ok(reports.some((r) => r.mode === "providers-only"));
  });
});
