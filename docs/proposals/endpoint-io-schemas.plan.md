# Endpoint I/O schemas — Implementation Plan

> **Execution:** implement task-by-task, TDD (write the failing test, watch it fail, minimal code,
> watch it pass, commit). Steps use `- [ ]` checkboxes. Design spec:
> [endpoint-io-schemas.md](endpoint-io-schemas.md).

**Goal:** capture each endpoint's input + output JSON Schema at ingest (from OpenAPI and the x402
Bazaar snapshot), store it content-addressed, and serve it at a new discovery `schema` step.

**Architecture:** three pure modules (normalize → content-addressed store → per-endpoint extraction)
feed the two ingest parsers, which set 64-hex refs on each `EndpointRecord` and accumulate a
`ref → schema` map written to `dist/schemas.json`. Delivery adds an `oasis_schema` MCP tool +
`capindex schema` CLI; `resolve`/`discover` carry only refs.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `node:test` + `node:assert/strict`,
`node:crypto` `sha256`. No new runtime deps.

## Global Constraints

- Normalized format is **JSON Schema 2020-12**; every stored schema has `"$schema":
  "https://json-schema.org/draft/2020-12/schema"`.
- New `EndpointRecord` fields are **snake_case**, **optional**, backward-compatible:
  `input_schema_ref`, `output_schema_ref`, `schema_source` (`"openapi" | "bazaar"`),
  `schema_captured_at`, `schema_truncated`.
- Ref = `sha256` over **canonical JSON** (recursively key-sorted). Hash **is** the version.
- Schema bytes live only in `dist/schemas.json` (content-addressed, deduped); records carry refs.
- Schema text stays **out of** `endpointEmbedText` (do not touch `src/embed/endpoint-text.ts`) — no
  re-embed.
- `SPEC_VERSION`/`INDEX_VERSION` bump `0.2.0` → `0.3.0` (`src/ingest/discover.ts:16-17`).
- Tests: `node:test`, `node:assert/strict`, co-located `*.test.ts`, deterministic `builtAt`
  constant, **no network**.
- Validation gate per task-group: `pnpm run build:ts && pnpm test && node dist/cli.js validate`.
- Schemas are **advisory** — field docs say "may be wrong or stale; the runtime 402 is
  authoritative; validate the live response at the boundary."

---

### Task 1: Record + spec fields

**Files:**
- Modify: `src/core/types.ts` (add `JsonSchema`; extend `EndpointRecord` after `:181`; extend
  `SearchHit` after `:267`)
- Modify: `spec/endpoint-record.schema.json` (properties block, `:17-52`)
- Test: `src/core/endpoint-record-schema.test.ts` (new)

**Interfaces produced:**
- `type JsonSchema = Record<string, unknown>`
- `EndpointRecord.input_schema_ref?: string`, `.output_schema_ref?: string`,
  `.schema_source?: "openapi" | "bazaar"`, `.schema_captured_at?: string`,
  `.schema_truncated?: boolean`
- `SearchHit.input_schema_ref?: string`, `.output_schema_ref?: string`,
  `.schema_source?: "openapi" | "bazaar"`

- [ ] **Step 1 — failing test.** Create `src/core/endpoint-record-schema.test.ts`:

```ts
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
```

- [ ] **Step 2 — run, expect FAIL.** `pnpm run build:ts && node --test dist/core/endpoint-record-schema.test.js` → the "unknown schema_source" case passes today (field allowed nowhere) but the "accepts schema refs" case **fails** (`additionalProperties:false` rejects the new keys).

- [ ] **Step 3 — add the spec properties.** In `spec/endpoint-record.schema.json`, inside
  `properties` (after `"schema_missing"` at `:48`), add:

```json
    "input_schema_ref": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "output_schema_ref": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "schema_source": { "type": "string", "enum": ["openapi", "bazaar"] },
    "schema_captured_at": { "type": "string", "format": "date-time" },
    "schema_truncated": { "type": "boolean" },
```

- [ ] **Step 4 — add the TS types.** In `src/core/types.ts`, after the `HttpMethod` block (`:8`) add:

```ts
/** A JSON Schema (2020-12) object. Advisory: captured from a provider source, may be stale. */
export type JsonSchema = Record<string, unknown>;
```

Then in `EndpointRecord`, after `built_at: string;`… no — add before `built_at` (keep `built_at`
last is not required; insert after `openapi_url?` at `:172`):

```ts
  /** sha256 ref into dist/schemas.json for the normalized input schema (JSON Schema 2020-12). */
  input_schema_ref?: string;
  /** sha256 ref into dist/schemas.json for the normalized output (2xx) schema. */
  output_schema_ref?: string;
  /** Which crawled source the schema came from. */
  schema_source?: "openapi" | "bazaar";
  /** When the schema was captured (advisory freshness). */
  schema_captured_at?: string;
  /** True when the source schema exceeded the size/depth cap and was dropped. */
  schema_truncated?: boolean;
```

And in `SearchHit`, after `provider_fqn?: string;` (`:267`):

```ts
  input_schema_ref?: string;
  output_schema_ref?: string;
  schema_source?: "openapi" | "bazaar";
```

- [ ] **Step 5 — run, expect PASS.** `pnpm run build:ts && node --test dist/core/endpoint-record-schema.test.js` → all pass. Then `node dist/cli.js validate` → still passes.

- [ ] **Step 6 — commit.** `git add src/core/types.ts spec/endpoint-record.schema.json src/core/endpoint-record-schema.test.ts && git commit -S -m "feat(schema): add optional I/O schema refs to the endpoint record"`

---

### Task 2: Content-addressed schema store

**Files:**
- Create: `src/ingest/schema-store.ts`
- Test: `src/ingest/schema-store.test.ts`

**Interfaces produced:**
- `canonicalJson(value: unknown): string` — deterministic, recursively key-sorted
- `schemaRef(schema: JsonSchema): string` — 64-hex sha256 of `canonicalJson`
- `class SchemaCollector { add(schema: JsonSchema): string; merge(other: SchemaCollector): void; toObject(): Record<string, JsonSchema>; size: number }`

- [ ] **Step 1 — failing test.** Create `src/ingest/schema-store.test.ts`:

```ts
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
```

- [ ] **Step 2 — run, expect FAIL** (module missing): `pnpm run build:ts` fails to resolve `./schema-store.js`.

- [ ] **Step 3 — implement `src/ingest/schema-store.ts`:**

```ts
import { createHash } from "node:crypto";
import type { JsonSchema } from "../core/types.js";

/** Deterministic JSON: object keys sorted recursively (RFC 8785 JCS semantics, sufficient for
 *  schema objects). Arrays keep order (significant in JSON Schema). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Content address = sha256 over canonical JSON. The hash IS the schema version. */
export function schemaRef(schema: JsonSchema): string {
  return createHash("sha256").update(canonicalJson(schema)).digest("hex");
}

/** Accumulates ref → schema, deduping identical schemas by hash. */
export class SchemaCollector {
  private map = new Map<string, JsonSchema>();
  add(schema: JsonSchema): string {
    const ref = schemaRef(schema);
    if (!this.map.has(ref)) this.map.set(ref, schema);
    return ref;
  }
  merge(other: SchemaCollector): void {
    for (const [k, v] of other.map) if (!this.map.has(k)) this.map.set(k, v);
  }
  toObject(): Record<string, JsonSchema> {
    return Object.fromEntries(this.map);
  }
  get size(): number {
    return this.map.size;
  }
}
```

- [ ] **Step 4 — run, expect PASS:** `pnpm run build:ts && node --test dist/ingest/schema-store.test.js`.

- [ ] **Step 5 — commit.** `git add src/ingest/schema-store.ts src/ingest/schema-store.test.ts && git commit -S -m "feat(schema): content-addressed schema store (sha256 = version)"`

---

### Task 3: Normalize source schema → JSON Schema 2020-12

**Files:**
- Create: `src/ingest/schema-normalize.ts`
- Test: `src/ingest/schema-normalize.test.ts`

**Interfaces produced:**
- `const DIALECT_2020_12 = "https://json-schema.org/draft/2020-12/schema"`
- `normalizeSchema(schema: JsonSchema, opts?: { oas30?: boolean; resolve?: (ref: string) => JsonSchema | undefined }): { schema: JsonSchema; truncated: boolean }`
  — down-converts OAS 3.0 keywords, bundles local `$ref` into `$defs`, caps node count; sets `$schema`.

**Interfaces consumed:** `JsonSchema` (Task 1).

- [ ] **Step 1 — failing test.** Create `src/ingest/schema-normalize.test.ts`:

```ts
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
  it("flags truncation when over the node cap", () => {
    const deep: any = {};
    let cur = deep;
    for (let i = 0; i < 5000; i++) { cur.properties = { x: {} }; cur = cur.properties.x; }
    const { truncated } = normalizeSchema(deep);
    assert.equal(truncated, true);
  });
});
```

- [ ] **Step 2 — run, expect FAIL** (module missing).

- [ ] **Step 3 — implement `src/ingest/schema-normalize.ts`:**

```ts
import type { JsonSchema } from "../core/types.js";

export const DIALECT_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const MAX_NODES = 2000; // must stay below the JS recursion-stack limit (~2836 frames on node 26):
// walk() recurses once per node, so recursion depth ≤ MAX_NODES+1; 4000 would overflow before the
// cap fires on a deeply-nested schema. 2000 is far above any real API schema's node count.
const OAS_ONLY_KEYS = ["nullable", "example", "xml", "discriminator", "externalDocs"];

interface Ctx {
  resolve?: (ref: string) => JsonSchema | undefined;
  oas30: boolean;
  defs: Record<string, JsonSchema>;
  seen: Set<string>;
  nodes: number;
  truncated: boolean;
}

function refName(ref: string): string {
  return ref.split("/").pop() || ref;
}

function walk(node: unknown, ctx: Ctx): unknown {
  if (Array.isArray(node)) return node.map((n) => walk(n, ctx));
  if (!node || typeof node !== "object") return node;
  if (++ctx.nodes > MAX_NODES) { ctx.truncated = true; return {}; }
  const src = node as Record<string, unknown>;

  if (typeof src.$ref === "string") {
    const ref = src.$ref;
    const name = refName(ref);
    if (ctx.resolve && ref.startsWith("#/")) {
      if (!ctx.seen.has(name)) {
        ctx.seen.add(name);
        const target = ctx.resolve(ref);
        ctx.defs[name] = target ? (walk(target, ctx) as JsonSchema) : {};
      }
      return { $ref: `#/$defs/${name}` };
    }
    return { $ref: ref }; // foreign/remote — leave as-is
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (ctx.oas30 && OAS_ONLY_KEYS.includes(k)) continue;
    out[k] = walk(v, ctx);
  }
  if (ctx.oas30) {
    if (src.nullable === true) {
      const t = out.type;
      if (typeof t === "string") out.type = [t, "null"];
      else if (Array.isArray(t) && !t.includes("null")) out.type = [...t, "null"];
    }
    if ("example" in src && !("examples" in out)) out.examples = [src.example];
  }
  return out;
}

/** Normalize any source schema to a self-contained JSON Schema 2020-12 document. */
export function normalizeSchema(
  schema: JsonSchema,
  opts: { oas30?: boolean; resolve?: (ref: string) => JsonSchema | undefined } = {},
): { schema: JsonSchema; truncated: boolean } {
  const ctx: Ctx = { resolve: opts.resolve, oas30: opts.oas30 ?? false, defs: {}, seen: new Set(), nodes: 0, truncated: false };
  const body = walk(schema, ctx) as Record<string, unknown>;
  const result: JsonSchema = { $schema: DIALECT_2020_12, ...body };
  if (Object.keys(ctx.defs).length) result.$defs = { ...(result.$defs as object ?? {}), ...ctx.defs };
  return { schema: result, truncated: ctx.truncated };
}
```

- [ ] **Step 4 — run, expect PASS:** `pnpm run build:ts && node --test dist/ingest/schema-normalize.test.js`.

- [ ] **Step 5 — commit.** `git add src/ingest/schema-normalize.ts src/ingest/schema-normalize.test.ts && git commit -S -m "feat(schema): normalize OpenAPI/Bazaar schemas to JSON Schema 2020-12"`

---

### Task 4: Per-endpoint schema extraction (OpenAPI + Bazaar)

**Files:**
- Create: `src/ingest/endpoint-schemas.ts`
- Test: `src/ingest/endpoint-schemas.test.ts`

**Interfaces produced:**
- `interface EndpointSchemas { input?: JsonSchema; output?: JsonSchema; truncated: boolean }`
- `openApiEndpointSchemas(op: Record<string, unknown>, resolve: (ref: string) => JsonSchema | undefined, oas30: boolean): EndpointSchemas`
- `bazaarEndpointSchemas(resource: { accepts?: Array<{ outputSchema?: any; mimeType?: string }>; extensions?: any }): EndpointSchemas`

**Interfaces consumed:** `normalizeSchema` (Task 3), `JsonSchema` (Task 1).

Notes for the implementer:
- **Input shape** is the location-keyed object from the spec §2: an object with `properties` among
  `path`/`query`/`headers`/`body`, omitting absent locations; top-level `required` lists locations
  whose object is required.
- **OpenAPI input:** group `op.parameters` by `in` (`path`/`query`/`header`→`headers`); each
  param → a property under its location using the param's normalized `schema`, `required` per
  `param.required`. `op.requestBody.content['application/json'].schema` (else first content) →
  `body`; `body` is required when `requestBody.required === true`.
- **OpenAPI output:** `op.responses['200']` (else first key matching `/^2\d\d$/`) →
  `content['application/json'].schema` (else first content). Omit if none.
- **Bazaar input/output priority (spec §2/§3):** `accepts[i].outputSchema.input` /
  `.output` (already JSON-Schema-shaped) → else `extensions.bazaar.schema` → else omit (the
  example-only `info.output` is not a schema; `info.input` inference is out of scope for v1 —
  capture only real schemas, per YAGNI).

- [ ] **Step 1 — failing test.** Create `src/ingest/endpoint-schemas.test.ts`:

```ts
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
```

- [ ] **Step 2 — run, expect FAIL** (module missing).

- [ ] **Step 3 — implement `src/ingest/endpoint-schemas.ts`** (per the notes above; use
  `normalizeSchema(schema, { oas30, resolve })` on every captured schema and OR the `truncated`
  flags). The location-keyed builder:

```ts
import type { JsonSchema } from "../core/types.js";
import { normalizeSchema } from "./schema-normalize.js";

export interface EndpointSchemas { input?: JsonSchema; output?: JsonSchema; truncated: boolean }

const LOC = (i: string): "path" | "query" | "headers" | null =>
  i === "path" ? "path" : i === "query" ? "query" : i === "header" ? "headers" : null;

export function openApiEndpointSchemas(
  op: Record<string, unknown>,
  resolve: (ref: string) => JsonSchema | undefined,
  oas30: boolean,
): EndpointSchemas {
  let truncated = false;
  const norm = (s: JsonSchema): JsonSchema => {
    const r = normalizeSchema(s, { oas30, resolve });
    truncated = truncated || r.truncated;
    return r.schema;
  };
  const props: Record<string, JsonSchema> = {};
  const required: string[] = [];

  // parameters → path/query/headers objects
  const buckets: Record<string, { properties: Record<string, unknown>; required: string[] }> = {};
  for (const raw of (op.parameters as Array<Record<string, unknown>> | undefined) ?? []) {
    const p = typeof raw.$ref === "string" ? resolve(raw.$ref) ?? raw : raw;
    const loc = LOC(String(p.in));
    if (!loc || typeof p.name !== "string") continue;
    (buckets[loc] ??= { properties: {}, required: [] });
    buckets[loc].properties[p.name] = p.schema ? norm(p.schema as JsonSchema) : {};
    if (p.required === true) buckets[loc].required.push(p.name);
  }
  for (const [loc, b] of Object.entries(buckets)) {
    props[loc] = { type: "object", properties: b.properties, ...(b.required.length ? { required: b.required } : {}) };
  }

  // requestBody → body
  let body = op.requestBody as Record<string, unknown> | undefined;
  if (body && typeof body.$ref === "string") body = resolve(body.$ref);
  const content = body?.content as Record<string, { schema?: JsonSchema }> | undefined;
  const bodySchema = content?.["application/json"]?.schema ?? Object.values(content ?? {})[0]?.schema;
  if (bodySchema) { props.body = norm(bodySchema); if (body?.required === true) required.push("body"); }

  const input = Object.keys(props).length
    ? ({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: props, ...(required.length ? { required } : {}) } as JsonSchema)
    : undefined;

  // responses → output
  const responses = (op.responses as Record<string, any> | undefined) ?? {};
  const key = responses["200"] ? "200" : Object.keys(responses).find((k) => /^2\d\d$/.test(k));
  const rc = key ? (responses[key].content as Record<string, { schema?: JsonSchema }> | undefined) : undefined;
  const outSchema = rc?.["application/json"]?.schema ?? Object.values(rc ?? {})[0]?.schema;
  const output = outSchema ? norm(outSchema) : undefined;

  return { input, output, truncated };
}

export function bazaarEndpointSchemas(resource: { accepts?: Array<Record<string, any>>; extensions?: any }): EndpointSchemas {
  let truncated = false;
  const norm = (s: JsonSchema): JsonSchema => {
    const r = normalizeSchema(s); truncated = truncated || r.truncated; return r.schema;
  };
  const os = resource.accepts?.find((a) => a.outputSchema)?.outputSchema;
  const bschema = resource.extensions?.bazaar?.schema as JsonSchema | undefined;
  const inRaw = os?.input;
  const outRaw = os?.output ?? bschema;
  return { input: inRaw ? norm(inRaw) : undefined, output: outRaw ? norm(outRaw) : undefined, truncated };
}
```

- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit.** `git commit -S -m "feat(schema): extract location-keyed I/O schemas from OpenAPI + Bazaar"`

---

### Task 5: Wire the OpenAPI parser

**Files:**
- Modify: `src/ingest/openapi-parser.ts` (imports `:1-14`; record push `:338-357`; return `:361`)
- Modify: `src/ingest/openapi-parser.test.ts` (existing calls now read `.records`)
- Modify: `src/ingest/discover.ts:169` (call-site reads `.records` + collects `.schemas`)

**Interface change:** `parseOpenApi(doc, options): { records: EndpointRecord[]; schemas: SchemaCollector }` (was `EndpointRecord[]`).

- [ ] **Step 1 — failing test.** Extend `src/ingest/openapi-parser.test.ts` with:

```ts
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
```

Update the file's other `parseOpenApi(...)` calls to destructure `{ records }` (e.g.
`const { records } = parseOpenApi(...)`; assert on `records`).

- [ ] **Step 2 — run, expect FAIL** (`.records`/refs undefined; old return was an array).

- [ ] **Step 3 — implement.** In `src/ingest/openapi-parser.ts`:
  - Add imports: `import { SchemaCollector } from "./schema-store.js";` and
    `import { openApiEndpointSchemas } from "./endpoint-schemas.js";`
  - Inside `parseOpenApi`, before the loop: `const schemas = new SchemaCollector();`
  - Inside the per-op body (before `records.push`), add:

```ts
      const oas30 = (doc.openapi ?? "3.0").startsWith("3.0");
      const io = openApiEndpointSchemas(op, (ref) => resolveRef(doc, ref), oas30);
      const input_schema_ref = io.input ? schemas.add(io.input) : undefined;
      const output_schema_ref = io.output ? schemas.add(io.output) : undefined;
```

  - In the `records.push({ ... })` object, after `openapi_url: openapiUrl,` add:

```ts
        input_schema_ref,
        output_schema_ref,
        schema_source: input_schema_ref || output_schema_ref ? "openapi" : undefined,
        schema_captured_at: input_schema_ref || output_schema_ref ? options.builtAt : undefined,
        schema_truncated: io.truncated || undefined,
```

  - Change the return `return records;` → `return { records, schemas };`
  - Fix `src/ingest/discover.ts:169`:
    `const recs = parseOpenApi(JSON.parse(buf), { origin, builtAt: built });` →
    `const { records: recs, schemas: sc } = parseOpenApi(JSON.parse(buf), { origin, builtAt: built });`
    and (temporary until Task 7) keep behavior: `if (recs.length) { enrichedByOrigin.set(origin, recs); ok++; }` — leave `sc` unused this task or eslint-ignore; Task 7 threads it.

- [ ] **Step 4 — run, expect PASS:** `pnpm run build:ts && pnpm test` (parser test group green; whole suite still green).
- [ ] **Step 5 — commit.** `git commit -S -m "feat(schema): capture I/O schemas in the OpenAPI parser"`

---

### Task 6: Wire the Bazaar ingest

**Files:**
- Modify: `src/ingest/bazaar.ts` (extend `BazaarResource`/`BazaarAccept` types `:26-40`;
  `bazaarToEndpoint` `:64-97`)
- Modify: `src/ingest/discover.ts:109` (call-site)
- Test: `src/ingest/bazaar.test.ts` (new)

**Interface change:** `bazaarToEndpoint(r, builtAt, schemas?: SchemaCollector): EndpointRecord | null` — optional collector; when passed, sets refs + `schema_source: "bazaar"`.

- [ ] **Step 1 — failing test.** Create `src/ingest/bazaar.test.ts`:

```ts
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
      accepts: [{ amount: "1000", asset: "USDC", outputSchema: { input: { type: "object", properties: { a: {} } }, output: { type: "object", properties: { b: {} } } } }],
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
```

- [ ] **Step 2 — run, expect FAIL.**

- [ ] **Step 3 — implement.** In `src/ingest/bazaar.ts`:
  - Extend `BazaarAccept` with `outputSchema?: Record<string, unknown>; mimeType?: string;`.
  - Extend `BazaarResource.extensions` type to
    `{ bazaar?: { info?: { input?: { method?: string } }; schema?: Record<string, unknown> } }`.
  - Add imports: `import { SchemaCollector } from "./schema-store.js";` +
    `import { bazaarEndpointSchemas } from "./endpoint-schemas.js";`
  - Change signature to `export function bazaarToEndpoint(r: BazaarResource, builtAt: string, schemas?: SchemaCollector): EndpointRecord | null`.
  - Before the `return {`, add:

```ts
  const io = schemas ? bazaarEndpointSchemas(r) : { input: undefined, output: undefined, truncated: false };
  const input_schema_ref = io.input && schemas ? schemas.add(io.input) : undefined;
  const output_schema_ref = io.output && schemas ? schemas.add(io.output) : undefined;
```

  - In the returned object, after `built_at: builtAt,` add:

```ts
    input_schema_ref,
    output_schema_ref,
    schema_source: input_schema_ref || output_schema_ref ? "bazaar" : undefined,
    schema_captured_at: input_schema_ref || output_schema_ref ? builtAt : undefined,
    schema_truncated: io.truncated || undefined,
```

  - Update `src/ingest/discover.ts:109`:
    `for (const r of bz) addInline(bazaarToEndpoint(r, built), "bazaar");` →
    `for (const r of bz) addInline(bazaarToEndpoint(r, built, schemaCollector), "bazaar");`
    (declare `schemaCollector` in Task 7; for this task, add
    `const schemaCollector = new SchemaCollector();` near the top of `runIngest` and import it.)

- [ ] **Step 4 — run, expect PASS:** `pnpm run build:ts && pnpm test`.
- [ ] **Step 5 — commit.** `git commit -S -m "feat(schema): capture I/O schemas from the Bazaar snapshot"`

---

### Task 7: Ingest wiring + `dist/schemas.json` + version bump

**Files:**
- Modify: `src/ingest/discover.ts` (`SPEC_VERSION`/`INDEX_VERSION` `:16-17`; thread
  `schemaCollector` through `enrichOne` merge `:169-170`; write `schemas.json` in `gateAndWrite`
  `:52-72` or `runIngest` tail)
- Test: `src/ingest/schema-write.test.ts` (new)

**Interface produced:** `writeSchemas(collector: SchemaCollector, outputDir: string): Promise<void>` — writes `dist/schemas.json`.

- [ ] **Step 1 — failing test.** Create `src/ingest/schema-write.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SchemaCollector } from "./schema-store.js";
import { writeSchemas } from "./discover.js";

describe("writeSchemas", () => {
  it("writes the ref→schema map to schemas.json", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "oasis-"));
    const c = new SchemaCollector();
    const ref = c.add({ type: "string" });
    await writeSchemas(c, dir);
    const out = JSON.parse(await readFile(path.join(dir, "schemas.json"), "utf8"));
    assert.deepEqual(out[ref], { type: "string" });
  });
});
```

- [ ] **Step 2 — run, expect FAIL** (`writeSchemas` not exported).

- [ ] **Step 3 — implement.** In `src/ingest/discover.ts`:
  - Bump `const SPEC_VERSION = "0.3.0"; const INDEX_VERSION = "0.3.0";`
  - Add `import { SchemaCollector } from "./schema-store.js";` and export:

```ts
export async function writeSchemas(collector: SchemaCollector, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "schemas.json"), JSON.stringify(collector.toObject(), null, 2));
}
```

  - In `runIngest`, create one collector: `const schemaCollector = new SchemaCollector();` (reuse the
    Task-6 declaration). In `enrichOne`, merge the parser's map:
    `const { records: recs, schemas: sc } = parseOpenApi(JSON.parse(buf), { origin, builtAt: built }); if (recs.length) { enrichedByOrigin.set(origin, recs); schemaCollector.merge(sc); ok++; }`
  - At the end of `runIngest`, before/after `gateAndWrite`, call
    `await writeSchemas(schemaCollector, opts.outputDir);` (the snapshot no-crawl branch may skip it —
    only the crawl produces schemas).

- [ ] **Step 4 — run, expect PASS:** `pnpm run build:ts && pnpm test`.
- [ ] **Step 5 — commit.** `git commit -S -m "feat(schema): write dist/schemas.json + bump spec_version to 0.3.0"`

---

### Task 8: Delivery — `oasis_schema` step + refs + CLI + docs

**Files:**
- Modify: `mcp/tools.mjs` (load `schemas.json`; add refs to the discover/resolve endpoint objects
  built by `add()`/`addEp()`/`armEp()` `:315-365` + `oasisResolve` `:226-235`; new `oasis_schema`
  tool + `include_schema` param on `oasis_discover`; register in `handleTool` `:566-569` and the
  tool-definition list)
- Modify: `src/cli.ts` (`SearchHit` emit `search.ts:233-246`; `formatEndpoint` `:551-563`; new
  `capindex schema <id>` command in the arg dispatch)
- Modify: `src/search/search.ts:233-246` (carry the three ref fields onto `SearchHit`)
- Modify: `spec/traversal.md` (step 3 table row + prose)
- Test: `mcp/schema-resolve.test.mjs` (new) or `src/ingest/schema-delivery.test.ts`

**Interface produced:** a pure helper `resolveEndpointSchemas(record, store) → { input_schema?, output_schema?, input_schema_ref?, output_schema_ref?, schema_source? }` used by both the MCP `oasis_schema` handler and `include_schema`. Put it in `src/ingest/schema-store.ts` (Task 2 module) so it is unit-testable in TS, and re-use from `mcp/tools.mjs`.

- [ ] **Step 1 — failing test.** Add to `src/ingest/schema-store.test.ts` (or a new
  `schema-delivery.test.ts`):

```ts
import { resolveEndpointSchemas } from "./schema-store.js";
it("resolves refs against the store", () => {
  const store = { deadbeef: { type: "object" } } as any;
  const rec = { input_schema_ref: "deadbeef", schema_source: "openapi" } as any;
  const r = resolveEndpointSchemas(rec, store);
  assert.deepEqual(r.input_schema, { type: "object" });
  assert.equal(r.input_schema_ref, "deadbeef");
  assert.equal(r.output_schema, undefined);
});
```

- [ ] **Step 2 — run, expect FAIL.**

- [ ] **Step 3a — implement the helper** in `src/ingest/schema-store.ts`:

```ts
import type { EndpointRecord } from "../core/types.js";
export function resolveEndpointSchemas(rec: Partial<EndpointRecord>, store: Record<string, JsonSchema>) {
  return {
    input_schema: rec.input_schema_ref ? store[rec.input_schema_ref] : undefined,
    output_schema: rec.output_schema_ref ? store[rec.output_schema_ref] : undefined,
    input_schema_ref: rec.input_schema_ref,
    output_schema_ref: rec.output_schema_ref,
    schema_source: rec.schema_source,
  };
}
```

- [ ] **Step 3b — MCP wiring** (`mcp/tools.mjs`): load `dist/schemas.json` once beside the index
  (fail-soft to `{}`); add `input_schema_ref`/`output_schema_ref`/`schema_source` to each endpoint
  object in `add()`/`addEp()`/`armEp()` and `oasisResolve`; add an `oasis_schema` tool that takes
  `{ endpoint_id }`, finds the record, and returns `resolveEndpointSchemas(rec, store)`; add an
  optional `include_schema` boolean to `oasis_discover` that inlines the resolved schemas for the
  returned subset. Register `oasis_schema` in `handleTool` and the exported tool-definition array
  (mirror an existing tool's shape).

- [ ] **Step 3c — CLI** (`src/cli.ts` + `src/search/search.ts`): carry the three ref fields onto
  `SearchHit` (`search.ts:233-246`); print them in `formatEndpoint` (`cli.ts:551-563`); add a
  `capindex schema <id>` branch that loads `dist/schemas.json`, finds the endpoint in the index, and
  prints `resolveEndpointSchemas(...)` as JSON.

- [ ] **Step 3d — docs** (`spec/traversal.md`): update the step-3 row to
  `Origin + path | Request/response JSON Schema | **OASIS `oasis_schema` / `capindex schema`** (fallback: origin `openapi.json`)` and adjust the step-3 prose to note OASIS now serves the normalized schema.

- [ ] **Step 4 — run, expect PASS:** `pnpm run build:ts && pnpm test && node dist/cli.js validate`.
  Manually: `node dist/cli.js schema <known-id>` prints schemas; `oasis_discover` default response
  has refs but no full schema; `include_schema=true` inlines.

- [ ] **Step 5 — commit.** `git commit -S -m "feat(schema): oasis_schema step + refs on resolve/discover + CLI + traversal docs"`

---

## Self-review

- **Spec coverage:** data model (T1), content-addressed store + versioning (T2), normalize 2020-12
  (T3), location-keyed input + 2xx output + Bazaar priority (T4), OpenAPI capture (T5), Bazaar
  capture (T6), `dist/schemas.json` + version bump (T7), schema-step delivery + refs + advisory docs
  (T8). Payment-plane separation is documented (T8 traversal + field docs). Non-goals (live re-probe,
  network normalization, `info` example-inference) intentionally excluded.
- **Backward-compat:** all record fields optional (T1 test asserts a schema-less record validates);
  `parseOpenApi` return-shape change is contained to one caller (T5) + its tests.
- **Type consistency:** `SchemaCollector`, `schemaRef`, `normalizeSchema`, `openApiEndpointSchemas`,
  `bazaarEndpointSchemas`, `resolveEndpointSchemas`, `writeSchemas` names are used identically across
  tasks; `schema_source` union is `"openapi" | "bazaar"` everywhere.
- **Embed cache untouched** (no edit to `endpoint-text.ts`) → no re-embed, per constraint.
