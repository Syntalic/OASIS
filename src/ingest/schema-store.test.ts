import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, schemaRef, SchemaCollector } from "./schema-store.js";

describe("schema-store", () => {
  it("canonicalJson is key-order independent", () => {
    assert.equal(canonicalJson({ b: 1, a: [{ y: 2, x: 1 }] }), canonicalJson({ a: [{ x: 1, y: 2 }], b: 1 }));
  });
  it("schemaRef is a stable 64-hex hash, order-independent", () => {
    const a = schemaRef({ type: "object", required: ["x"], properties: { x: { type: "string" } } });
    const b = schemaRef({ properties: { x: { type: "string" } }, required: ["x"], type: "object" });
    assert.match(a, /^[a-f0-9]{64}$/);
    assert.equal(a, b);
  });
  it("collector dedupes identical schemas", () => {
    const c = new SchemaCollector();
    const r1 = c.add({ type: "string" });
    const r2 = c.add({ type: "string" });
    assert.equal(r1, r2);
    assert.equal(c.size, 1);
    assert.deepEqual(c.toObject()[r1], { type: "string" });
  });
});
