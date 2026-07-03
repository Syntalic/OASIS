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
  it("resolves a response-object-level $ref to capture output", () => {
    const op = { responses: { "200": { $ref: "#/components/responses/Ok" } } };
    const resolve = (ref: string): any =>
      ref === "#/components/responses/Ok"
        ? { content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } }
        : undefined;
    const { output } = openApiEndpointSchemas(op as any, resolve, false);
    assert.ok((output as any).properties.ok);
  });
});

describe("bazaarEndpointSchemas", () => {
  it("translates the x402 transport envelope input into a location-keyed schema (not the raw envelope)", () => {
    const r = { accepts: [{ outputSchema: {
      input: {
        type: "http", method: "POST", discoverable: true,
        queryParams: { symbol: { type: "string", description: "ticker", required: true } },
        body: { note: { type: "string" } },
      },
      output: { type: "object", properties: { price: { type: "number" } } },
    } }] };
    const { input, output } = bazaarEndpointSchemas(r as any);
    assert.equal((input as any).type, "object");
    assert.equal((input as any).properties.query.properties.symbol.type, "string");
    assert.deepEqual((input as any).properties.query.required, ["symbol"]);
    assert.equal((input as any).properties.body.properties.note.type, "string");
    assert.ok(!JSON.stringify(input).includes('"http"'), "raw transport envelope must not leak into the schema");
    assert.equal((output as any).properties.price.type, "number");
  });
  it("omits input for a param-less request (never stores the bare envelope)", () => {
    const r = { accepts: [{ outputSchema: { input: { type: "http", method: "GET", discoverable: true }, output: { type: "object" } } }] };
    assert.equal(bazaarEndpointSchemas(r as any).input, undefined);
  });
  it("falls back to extensions.bazaar.schema, omits when only info", () => {
    const r = { extensions: { bazaar: { schema: { type: "object", properties: { z: {} } }, info: { output: { example: {} } } } } };
    const { output } = bazaarEndpointSchemas(r as any);
    assert.ok((output as any).properties.z);
  });
});
