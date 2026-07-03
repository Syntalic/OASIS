import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bazaarToEndpoint } from "./bazaar.js";
import { SchemaCollector } from "./schema-store.js";

const BUILT = "2026-01-01T00:00:00.000Z";
describe("bazaarToEndpoint schema capture", () => {
  it("captures accepts[].outputSchema → refs + source", () => {
    const c = new SchemaCollector();
    const rec = bazaarToEndpoint({
      resource: "https://api.x.com/p", type: "http",
      accepts: [{ amount: "1000", asset: "USDC", outputSchema: { input: { type: "http", method: "GET", queryParams: { a: { type: "string" } } }, output: { type: "object", properties: { b: {} } } } }],
    } as any, BUILT, c)!;
    assert.equal(rec.schema_source, "bazaar");
    assert.match(rec.input_schema_ref!, /^[a-f0-9]{64}$/);
    assert.ok(c.toObject()[rec.output_schema_ref!]);
  });
  it("no schema material → no refs (method still parsed)", () => {
    const rec = bazaarToEndpoint({ resource: "https://api.x.com/p", type: "http", accepts: [{ amount: "1", asset: "USDC" }], extensions: { bazaar: { info: { input: { method: "GET" } } } } } as any, BUILT, new SchemaCollector())!;
    assert.equal(rec.input_schema_ref, undefined);
    assert.equal(rec.method, "GET");
  });
});
