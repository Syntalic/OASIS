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

describe("openapi-parser declared merchant wallets", () => {
  it("extracts faremeter + mpp.recipient (Syntalic-style) and skips USDC token contracts", () => {
    const merchant = "0xe2e662cF219025AFC0C9Bf850b6a2B0a0b5517fe";
    const solMerchant = "2hYY7wHhXsoWnskQRzYFUNH7YboXNMEqbGnAFHpRuB2W";
    const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const doc = {
      openapi: "3.0.0",
      info: { title: "Syntalic-like" },
      "x-faremeter-assets": {
        "base-usdc": { chain: "base", token: usdc, recipient: merchant },
        "solana-usdc": { chain: "solana", recipient: solMerchant },
      },
      paths: {
        "/v1/shopper/best-price": {
          get: {
            summary: "Best price",
            "x-payment-info": {
              price: { mode: "fixed", currency: "USD", amount: "0.01" },
              protocols: [{ x402: {} }, { mpp: { method: "tempo", recipient: merchant } }],
            },
          },
        },
      },
    };
    const { records } = parseOpenApi(doc as any, {
      origin: "https://api.syntalic.com",
      builtAt: BUILT_AT,
    });
    assert.equal(records.length, 1);
    const d = records[0]!.payment.declared_pay_tos ?? [];
    const addrs = new Set(d.map((x) => x.payTo.toLowerCase()));
    assert.ok(addrs.has(merchant.toLowerCase()), `missing evm merchant: ${[...addrs]}`);
    assert.ok(addrs.has(solMerchant.toLowerCase()), `missing sol merchant: ${[...addrs]}`);
    assert.ok(!addrs.has(usdc.toLowerCase()), "USDC token must not be a merchant");
  });

  it("extracts telemost-style x-402.networks[].payTo", () => {
    const pay = "0xf99B281010C5e6CBcF486d7ef108B315Be7cE0e9";
    const doc = {
      openapi: "3.0.0",
      paths: {
        "/v1/data/search": {
          get: {
            summary: "Search",
            "x-payment-info": { price: { amount: "0.01", currency: "USD" } },
            "x-402": {
              networks: [{ network: "base", payTo: pay }],
            },
          },
        },
      },
    };
    const { records } = parseOpenApi(doc as any, { origin: "https://api.telemost.io", builtAt: BUILT_AT });
    const d = records[0]!.payment.declared_pay_tos ?? [];
    assert.ok(d.some((x) => x.payTo.toLowerCase() === pay.toLowerCase()));
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
