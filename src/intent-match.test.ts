import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CURATED_INTENT_IDS } from "./intent-match.js";

describe("intent-match", () => {
  it("defines exactly 47 unique curated intent ids", () => {
    assert.equal(CURATED_INTENT_IDS.length, 47);
    assert.equal(new Set(CURATED_INTENT_IDS).size, 47);
  });
});
