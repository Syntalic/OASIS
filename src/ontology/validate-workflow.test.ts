import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateWorkflow, validateAllWorkflows } from "./validate-workflow.js";

// A well-formed fanout whose two steps both consume CryptoAsset (real intents).
const base = {
  id: "workflow.test_x",
  goal: "A valid compound goal for testing",
  shape: "fanout" as const,
  steps: [
    { intent: "blockchain.token_security", do: "scan the contract" },
    { intent: "blockchain.spot_price", do: "get the price" },
  ],
  produces: "a decision",
};

describe("validateWorkflow", () => {
  it("accepts a well-formed workflow whose intents all exist", async () => {
    const r = await validateWorkflow(base);
    assert.equal(r.valid, true, r.errors.join(";"));
    assert.equal(r.id, "workflow.test_x");
  });

  it("ERRORS on a step intent that does not exist (workflows compose, never invent)", async () => {
    const r = await validateWorkflow({
      ...base,
      steps: [{ intent: "blockchain.token_security", do: "x" }, { intent: "nope.not_real", do: "y" }],
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("not an existing curated intent")), r.errors.join(";"));
  });

  it("ERRORS on schema violations (bad id, short goal, <2 steps, missing produces)", async () => {
    const r = await validateWorkflow({ id: "bad id", goal: "short", shape: "chain", steps: [{ intent: "blockchain.spot_price", do: "x" }] });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.startsWith("schema:")), r.errors.join(";"));
  });

  it("WARNs (not errors) on a chain entity-flow seam gap — a planner bridges it", async () => {
    const r = await validateWorkflow({
      ...base,
      shape: "chain",
      steps: [
        { intent: "data.job_search", do: "find hiring companies" },   // produces Answer
        { intent: "identity.company_enrich", do: "enrich" },          // consumes Company/Domain → gap
      ],
    });
    assert.equal(r.valid, true, "a port gap is a WARN, not an error");
    assert.ok(r.warnings.some((w) => w.includes("chain seam")), r.warnings.join(";"));
  });

  it("does not warn a fanout whose steps share a common consumed entity", async () => {
    const r = await validateWorkflow(base); // both steps consume CryptoAsset
    assert.equal(r.warnings.length, 0, r.warnings.join(";"));
  });
});

describe("validateAllWorkflows", () => {
  it("every shipped seed workflow is valid", async () => {
    const all = await validateAllWorkflows();
    assert.ok(all.length >= 2, `expected >=2 seed workflows, got ${all.length}`);
    for (const { file, result } of all) assert.equal(result.valid, true, `${file}: ${result.errors.join(";")}`);
  });
});
