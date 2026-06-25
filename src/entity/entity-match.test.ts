import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSubtypeClosure, entityMatches, matchKind } from "./entity-match.js";

const SUBTYPES = {
  PostalAddress: { parent: "Place" },
  Location: { parent: "Place" },
  Brand: { parent: "Company" },
};

describe("entityMatches", () => {
  const closure = buildSubtypeClosure(SUBTYPES);

  it("exact match", () => {
    assert.equal(entityMatches("Place", "Place", closure), true);
    assert.equal(matchKind("Place", "Place", closure), "exact");
  });

  it("one-hop parent match", () => {
    assert.equal(entityMatches("PostalAddress", "Place", closure), true);
    assert.equal(matchKind("PostalAddress", "Place", closure), "parent");
  });

  it("rejects unrelated identities", () => {
    assert.equal(entityMatches("Company", "Topic", closure), false);
    assert.equal(entityMatches("WeatherReport", "Place", closure), false);
  });

  it("rejects transitive climb", () => {
    assert.equal(entityMatches("Brand", "Place", closure), false);
  });
});