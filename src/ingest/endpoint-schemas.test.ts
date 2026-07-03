import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openApiEndpointSchemas, bazaarEndpointSchemas } from "./endpoint-schemas.js";

const noResolve = () => undefined;

describe("openApiEndpointSchemas", () => {
  it("location-keys params + body, keeps output", () => {
    const op = {
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "limit", in: "query", schema: { type: "integer" } },
      ],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { url: { type: "string" } } } } } },
      responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } } },
    };
    const { input, output } = openApiEndpointSchemas(op as any, noResolve, false);
    assert.deepEqual(Object.keys((input as any).properties).sort(), ["body", "path", "query"]);
    assert.deepEqual((input as any).required, ["body"]);
    assert.ok((output as any).properties.ok);
  });
  it("GET with only query yields no body", () => {
    const op = { parameters: [{ name: "q", in: "query", schema: { type: "string" } }], responses: { "200": {} } };
    const { input, output } = openApiEndpointSchemas(op as any, noResolve, false);
    assert.deepEqual(Object.keys((input as any).properties), ["query"]);
    assert.equal(output, undefined);
  });
});

describe("bazaarEndpointSchemas", () => {
  it("prefers accepts[].outputSchema", () => {
    const r = { accepts: [{ outputSchema: { input: { type: "object", properties: { a: {} } }, output: { type: "object", properties: { b: {} } } } }] };
    const { input, output } = bazaarEndpointSchemas(r as any);
    assert.ok((input as any).properties.a);
    assert.ok((output as any).properties.b);
  });
  it("falls back to extensions.bazaar.schema, omits when only info", () => {
    const r = { extensions: { bazaar: { schema: { type: "object", properties: { z: {} } }, info: { output: { example: {} } } } } };
    const { output } = bazaarEndpointSchemas(r as any);
    assert.ok((output as any).properties.z);
  });
});
