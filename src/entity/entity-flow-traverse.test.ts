import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { curatedCapabilitiesForSearch } from "../search/curated-search.js";
import { loadEntityFlowRuntime, suggestFollowUps } from "./entity-flow-traverse.js";
import type { IndexBundle } from "../core/types.js";
import { oasisDistDir, oasisDistIndex, SKIP_NO_INDEX } from "../core/test-helpers.js";

const distDir = oasisDistDir();
const distIndex = oasisDistIndex();

async function loadBundle(): Promise<IndexBundle> {
  const raw = await readFile(distIndex, "utf8");
  return JSON.parse(raw) as IndexBundle;
}

describe("suggestFollowUps", () => {
  it("returns cross-domain investigative leads for held Place (v1)", async (t) => {
    if (!existsSync(distIndex)) return t.skip(SKIP_NO_INDEX);
    const bundle = await loadBundle();
    const capabilities = curatedCapabilitiesForSearch(bundle);
    const runtime = await loadEntityFlowRuntime(distDir, capabilities);

    const result = suggestFollowUps(
      {
        source_intent_id: "commerce.inflation_tracker",
        entities: [{ entity: "Place", value: "Los Angeles, CA", kind: "identity" }],
        exclude: ["commerce.inflation_tracker"],
      },
      runtime,
      { limit: 8, capabilities, endpoints: bundle.endpoints },
    );

    assert.deepEqual(result.forward, []);
    assert.ok(result.investigative.length >= 2, "expected >=2 cross-domain leads");
    for (const lead of result.investigative) {
      assert.equal(lead.mode, "investigative");
      assert.ok(runtime.entityIndex.bridge_eligible.includes(lead.bridging_entity));
      assert.ok(lead.top_endpoint?.origin && lead.top_endpoint?.path);
      assert.notEqual(lead.intent_id, "commerce.inflation_tracker");
    }
  });

  it("returns no investigative leads for Query held entity", async (t) => {
    if (!existsSync(distIndex)) return t.skip(SKIP_NO_INDEX);
    const bundle = await loadBundle();
    const capabilities = curatedCapabilitiesForSearch(bundle);
    const runtime = await loadEntityFlowRuntime(distDir, capabilities);

    const result = suggestFollowUps(
      {
        entities: [{ entity: "Query", value: "sales down", kind: "identity" }],
      },
      runtime,
      { limit: 8, capabilities, endpoints: bundle.endpoints },
    );

    assert.equal(result.investigative.length, 0);
    assert.deepEqual(result.forward, []);
  });

  it("returns no investigative leads for observation entities", async (t) => {
    if (!existsSync(distIndex)) return t.skip(SKIP_NO_INDEX);
    const bundle = await loadBundle();
    const capabilities = curatedCapabilitiesForSearch(bundle);
    const runtime = await loadEntityFlowRuntime(distDir, capabilities);

    const result = suggestFollowUps(
      {
        entities: [{ entity: "WeatherReport", value: "72F sunny", kind: "observation" }],
      },
      runtime,
      { limit: 8, capabilities, endpoints: bundle.endpoints },
    );

    assert.equal(result.investigative.length, 0);
  });
});