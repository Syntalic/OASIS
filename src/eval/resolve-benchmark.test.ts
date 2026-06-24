import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { CURATED_INTENT_IDS } from "../intent-match.js";
import {
  evaluateResolveAccuracy,
  loadCuratedSources,
  runResolveBenchmark,
} from "./resolve-benchmark.js";
import type { IndexBundle } from "../types.js";
import { oasisDistIndex, SKIP_NO_INDEX, skipIfPinned } from "../test-helpers.js";

const distIndex = oasisDistIndex();

async function distIndexExists(): Promise<boolean> {
  try {
    await access(distIndex);
    return true;
  } catch {
    return false;
  }
}

async function loadBundle(): Promise<IndexBundle> {
  const raw = await readFile(distIndex, "utf8");
  return JSON.parse(raw) as IndexBundle;
}

describe("resolve benchmark", () => {
  it("loads task-only curated sources from ontology/intents", async () => {
    const sources = await loadCuratedSources();
    assert.ok(sources.length >= 47, `expected >= 47 curated sources, got ${sources.length}`);
    for (const intent of sources) {
      assert.ok(intent.id);
      assert.ok(intent.label);
      assert.equal(
        (intent as { satisfies?: unknown }).satisfies,
        undefined,
        `${intent.id} should not define satisfies in source YAML`,
      );
    }
  });

  it("all curated intents materialize to at least one indexed endpoint", async (t) => {
    if (skipIfPinned(t)) return;
    if (!(await distIndexExists())) {
      t.skip(SKIP_NO_INDEX);
      return;
    }

    const bundle = await loadBundle();
    const report = evaluateResolveAccuracy(bundle);

    const misses = report.results.filter((r) => !r.resolved);
    assert.equal(
      misses.length,
      0,
      `expected all curated intents to have candidates, missing: ${misses.map((m) => m.intent_id).join(", ")}`,
    );
    assert.equal(report.total, CURATED_INTENT_IDS.length);
  });

  it("runResolveBenchmark matches evaluateResolveAccuracy", async (t) => {
    if (skipIfPinned(t)) return;
    if (!(await distIndexExists())) {
      t.skip(SKIP_NO_INDEX);
      return;
    }

    const bundle = await loadBundle();
    const report = await runResolveBenchmark(bundle);
    assert.equal(report.total, report.resolved + report.missing);
    assert.ok(report.total >= 47);
  });
});