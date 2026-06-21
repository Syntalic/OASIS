import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateResolveAccuracy,
  loadCuratedIntents,
  runResolveBenchmark,
} from "./resolve-benchmark.js";
import type { IndexBundle } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(__dirname, "..", "..", "dist", "index.json");

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
  it("loads curated intents from ontology/intents", async () => {
    const intents = await loadCuratedIntents();
    assert.ok(intents.length >= 25, `expected >= 25 curated intents, got ${intents.length}`);
    for (const intent of intents) {
      assert.ok(intent.id);
      assert.ok(intent.label);
      assert.ok(intent.satisfies.length > 0);
    }
  });

  it("all curated intents resolve primary satisfies ref to an indexed endpoint", async (t) => {
    if (!(await distIndexExists())) {
      t.skip("dist/index.json missing — run pnpm run build first");
      return;
    }

    const bundle = await loadBundle();
    const intents = await loadCuratedIntents();
    const report = evaluateResolveAccuracy(bundle, intents);

    const misses = report.results.filter((r) => !r.resolved);
    assert.equal(
      misses.length,
      0,
      `expected all primary refs to resolve, missing: ${misses.map((m) => m.intent_id).join(", ")}`,
    );
  });

  it("runResolveBenchmark matches evaluateResolveAccuracy", async (t) => {
    if (!(await distIndexExists())) {
      t.skip("dist/index.json missing — run pnpm run build first");
      return;
    }

    const bundle = await loadBundle();
    const report = await runResolveBenchmark(bundle);
    assert.equal(report.total, report.resolved + report.missing);
    assert.ok(report.total >= 25);
  });
});