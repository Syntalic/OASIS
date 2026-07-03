import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Ajv = require("ajv") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as (a: InstanceType<typeof Ajv>) => void;
const SPEC = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "spec",
  "endpoint-record.schema.json",
);

function validator() {
  // validateSchema:false — the record schema declares draft-2020-12; AJV v8's default class is
  // draft-07 and would throw on the unknown meta-schema at compile. Matches the repo pattern
  // (src/ingest/payment-spec.ts:19). Our keywords (type/enum/pattern/additionalProperties/format)
  // validate identically under draft-07 semantics.
  const ajv = new Ajv({ strict: false, validateSchema: false });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(SPEC, "utf8")));
}

const base = {
  id: "a".repeat(64),
  origin: "https://x.com",
  method: "POST",
  path: "/p",
  summary: "s",
  payment: { paid: true, rails: [] },
  search_text: "s",
  built_at: "2026-01-01T00:00:00.000Z",
};

describe("payment-verified schema fields", () => {
  it("accepts payment_verified + payment_verified_at on a base record", () => {
    const v = validator();
    const record = {
      ...base,
      payment_verified: "contradicted",
      payment_verified_at: "2026-01-01T00:00:00.000Z",
    };
    assert.ok(v(record), JSON.stringify(v.errors));
  });

  it("accepts payment.live_challenge array", () => {
    const v = validator();
    const record = {
      ...base,
      payment: {
        ...base.payment,
        live_challenge: [
          {
            protocol: "x402",
            accepts: [
              {
                scheme: "exact",
                network: "base",
                payTo: "0x0000000000000000000000000000000000000000",
                amount: "1000",
              },
            ],
          },
        ],
      },
    };
    assert.ok(v(record), JSON.stringify(v.errors));
  });

  it("rejects payment_verified with a bogus value", () => {
    const v = validator();
    const record = { ...base, payment_verified: "bogus" };
    assert.equal(v(record), false);
  });

  it("still accepts a base record with none of the new fields (backward compat)", () => {
    const v = validator();
    assert.ok(v(base), JSON.stringify(v.errors));
  });
});
