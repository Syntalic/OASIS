import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CURATED_INTENT_IDS } from "./intent-match.js";

describe("intent-match", () => {
  it("defines a unique set of curated intent ids", () => {
    assert.equal(CURATED_INTENT_IDS.length, 73);
    // Uniqueness is the real invariant — the Set size must equal the array length.
    assert.equal(new Set(CURATED_INTENT_IDS).size, CURATED_INTENT_IDS.length);
  });
});
