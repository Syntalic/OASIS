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
  const recs = parseOpenApi(doc, { origin: "https://x.test", builtAt: BUILT_AT });
  const rec = recs.find((r) => r.path === path);
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
