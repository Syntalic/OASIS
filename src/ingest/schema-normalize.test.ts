import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeSchema, DIALECT_2020_12 } from "./schema-normalize.js";

describe("schema-normalize", () => {
  it("down-converts OAS 3.0 nullable + example, sets $schema", () => {
    const { schema } = normalizeSchema(
      { type: "string", nullable: true, example: "hi" } as any,
      { oas30: true },
    );
    assert.equal(schema.$schema, DIALECT_2020_12);
    assert.deepEqual(schema.type, ["string", "null"]);
    assert.deepEqual((schema as any).examples, ["hi"]);
    assert.equal("example" in schema, false);
    assert.equal("nullable" in schema, false);
  });
  it("bundles a local $ref into $defs and rewrites the pointer", () => {
    const resolve = (r: string) => (r === "#/components/schemas/Pet" ? { type: "object", properties: { name: { type: "string" } } } : undefined);
    const { schema } = normalizeSchema({ $ref: "#/components/schemas/Pet" } as any, { resolve });
    assert.ok((schema.$defs as any).Pet);
    assert.equal((schema as any).$ref, "#/$defs/Pet");
  });
  it("terminates on a recursive $ref", () => {
    const resolve = (r: string) => (r === "#/components/schemas/Node" ? { type: "object", properties: { next: { $ref: "#/components/schemas/Node" } } } : undefined);
    const { schema } = normalizeSchema({ $ref: "#/components/schemas/Node" } as any, { resolve });
    assert.ok((schema.$defs as any).Node);
  });
  it("stamps 2020-12 dialect even when source carries its own $schema", () => {
    const { schema } = normalizeSchema(
      { $schema: "http://json-schema.org/draft-07/schema#", type: "object" } as any,
    );
    assert.equal(schema.$schema, DIALECT_2020_12);
  });
  it("flags truncation when over the node cap", () => {
    const deep: any = {};
    let cur = deep;
    for (let i = 0; i < 5000; i++) { cur.properties = { x: {} }; cur = cur.properties.x; }
    const { truncated } = normalizeSchema(deep);
    assert.equal(truncated, true);
  });
});
