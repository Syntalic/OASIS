import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Ajv = require("ajv") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as (a: InstanceType<typeof Ajv>) => void;
const SPEC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "spec", "endpoint-record.schema.json");

function validator() {
  // validateSchema:false — the record schema declares draft-2020-12; AJV v8's default class is
  // draft-07 and would throw on the unknown meta-schema at compile. Matches the repo pattern
  // (src/ingest/payment-spec.ts:19, src/ontology/validate.ts:24). Our keywords (type/enum/pattern/
  // additionalProperties/format) validate identically under draft-07 semantics.
  const ajv = new Ajv({ strict: false, validateSchema: false });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(SPEC, "utf8")));
}
const base = {
  id: "a".repeat(64), origin: "https://x.com", method: "POST", path: "/p",
  summary: "s", payment: { paid: true, rails: [] }, search_text: "s",
  built_at: "2026-01-01T00:00:00.000Z",
};

describe("endpoint-record schema", () => {
  it("accepts schema refs", () => {
    const v = validator();
    assert.ok(v({ ...base, input_schema_ref: "b".repeat(64), output_schema_ref: "c".repeat(64), schema_source: "openapi", schema_captured_at: "2026-01-01T00:00:00.000Z", schema_truncated: false }), JSON.stringify(v.errors));
  });
  it("still accepts a schema-less record (backward compat)", () => {
    assert.ok(validator()(base));
  });
  it("rejects an unknown schema_source", () => {
    assert.equal(validator()({ ...base, schema_source: "made-up" }), false);
  });
});
