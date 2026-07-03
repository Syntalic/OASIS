import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseOpenApi } from "./openapi-parser.js";

const BUILT_AT = "2026-01-01T00:00:00.000Z";

// A spec exercising the input-extraction paths the old parser missed: a $ref
// request-body schema, a $ref requestBody under multipart/form-data, and an
// allOf merge. All resolve against components — no network, no index.
const doc = {
  openapi: "3.0.0",
  info: { title: "Test API" },
  components: {
    schemas: {
      LookupReq: {
        type: "object",
        properties: { domain: {}, organization_name: {} },
      },
      Base: { type: "object", properties: { id: {} } },
    },
    requestBodies: {
      UploadBody: {
        content: {
          "multipart/form-data": {
            schema: { type: "object", properties: { file: {}, filename: {} } },
          },
        },
      },
    },
  },
  paths: {
    "/lookup": {
      post: {
        summary: "Lookup company by domain",
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LookupReq" },
            },
          },
        },
      },
    },
    "/upload": {
      post: {
        summary: "Upload a file",
        requestBody: { $ref: "#/components/requestBodies/UploadBody" },
      },
    },
    "/merge": {
      post: {
        summary: "Merged schema",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                allOf: [
                  { $ref: "#/components/schemas/Base" },
                  { type: "object", properties: { extra: {} } },
                ],
              },
            },
          },
        },
      },
    },
  },
};

function inputsFor(path: string): string[] {
  const { records } = parseOpenApi(doc, { origin: "https://x.test", builtAt: BUILT_AT });
  const rec = records.find((r) => r.path === path);
  assert.ok(rec, `no record for ${path}`);
  return rec.inputs ?? [];
}

describe("openapi-parser extractInputs", () => {
  it("resolves a $ref request-body schema", () => {
    const inputs = inputsFor("/lookup");
    assert.ok(inputs.includes("domain"), `inputs=${inputs}`);
    assert.ok(inputs.includes("organization_name"), `inputs=${inputs}`);
  });

  it("resolves a $ref requestBody under multipart/form-data", () => {
    const inputs = inputsFor("/upload");
    assert.ok(inputs.includes("file"), `inputs=${inputs}`);
    assert.ok(inputs.includes("filename"), `inputs=${inputs}`);
  });

  it("merges allOf member schemas", () => {
    const inputs = inputsFor("/merge");
    assert.ok(inputs.includes("id"), `inputs=${inputs}`);
    assert.ok(inputs.includes("extra"), `inputs=${inputs}`);
  });
});

describe("openapi-parser schema capture", () => {
  it("captures location-keyed input + output schema refs", () => {
    const doc = {
      openapi: "3.0.0",
      servers: [{ url: "https://api.x.com" }],
      paths: { "/search": { post: {
        summary: "Search",
        "x-payment-info": { intent: "charge", method: "x402", amount: "1000" },
        parameters: [{ name: "q", in: "query", schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Req" } } } },
        responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { hits: { type: "array" } } } } } }, "402": {} },
      } } },
      components: { schemas: { Req: { type: "object", properties: { url: { type: "string" } } } } },
    };
    const { records, schemas } = parseOpenApi(doc as any, { origin: "https://api.x.com", builtAt: BUILT_AT });
    const rec = records[0];
    assert.match(rec.input_schema_ref!, /^[a-f0-9]{64}$/);
    assert.match(rec.output_schema_ref!, /^[a-f0-9]{64}$/);
    assert.equal(rec.schema_source, "openapi");
    const input = schemas.toObject()[rec.input_schema_ref!];
    assert.deepEqual(Object.keys((input as any).properties).sort(), ["body", "query"]);
  });
});
