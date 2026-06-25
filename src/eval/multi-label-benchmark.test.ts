import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadMultiLabelQueries,
  runMultiLabelBenchmark,
} from "./multi-label-benchmark.js";
import type { IndexBundle } from "../core/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(__dirname, "..", "..", "dist", "index.json");
const SKIP_MSG = "dist/index.json missing — run pnpm run build first";

describe("multi-label benchmark", () => {
  it("dataset is well-formed", async () => {
    const queries = await loadMultiLabelQueries();
    assert.ok(queries.length >= 20, `expected >= 20 queries, got ${queries.length}`);
    for (const q of queries) {
      assert.ok(q.id && q.query, `query missing id/query: ${JSON.stringify(q)}`);
      assert.ok(q.expect_intents?.length, `${q.id} has no expect_intents`);
      if (q.kind === "hard_negative") {
        assert.ok(q.negative_intents?.length, `${q.id} hard_negative needs negative_intents`);
      }
    }
  });

  it("runs and returns coherent aggregates", async (t) => {
    if (!existsSync(distIndex)) return t.skip(SKIP_MSG);
    const bundle = JSON.parse(await readFile(distIndex, "utf8")) as IndexBundle;
    const queries = await loadMultiLabelQueries();
    const report = runMultiLabelBenchmark(bundle, queries);

    assert.equal(report.total, queries.length);
    assert.ok(report.task_recall_at_3 >= report.task_recall_at_1);
    assert.equal(
      report.hard_negative_total,
      queries.filter((q) => q.kind === "hard_negative").length,
    );
    assert.ok(report.related_found <= report.related_expected);
    assert.ok(report.facet_coverage <= report.total);
  });
});
