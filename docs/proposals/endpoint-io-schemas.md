# Endpoint I/O schemas: serve input + output JSON Schema at the schema step

**Status:** proposal / design
**Date:** 2026-07-03
**Provenance:** `main` @ `7401eea`; endpoint record `spec/endpoint-record.schema.json`; OpenAPI
parser `src/ingest/openapi-parser.ts`; Bazaar ingest `src/ingest/bazaar.ts`; traversal protocol
`spec/traversal.md`; corpus ~18.8k endpoints. First of two data-quality specs (this = schema
capture; sibling = live payment verification, separate doc).

## TL;DR

An agent discovering a paid endpoint should be able to get its **input schema** (what to send) and
**output schema** (what shape returns) — normalized, dereferenced, versioned — from OASIS itself,
instead of fetching each origin's raw `openapi.json` and normalizing 3.0-vs-3.1 dialects by hand.
This lets a consumer (the Syntalic Dashboard, or any third-party agent) build valid requests, skip
endpoints it can't fulfil, plan how to render the result, preview "what you'll get" before paying,
and validate the response.

The schemas already exist in the sources OASIS crawls — the provider's OpenAPI `requestBody` /
`responses`, and (for x402 Bazaar resources) the cached `402` challenge (`accepts[].outputSchema` +
`extensions.bazaar.schema`). OASIS keeps only property **names** from the first and only the HTTP
method from the second. So the work is *capture + normalize + expose*, not a new registration
surface.

This fits OASIS's existing `search → resolve → schema → execute` protocol (`spec/traversal.md`): we
implement **the schema step**. Schemas are normalized to **JSON Schema 2020-12**, stored
**content-addressed** (hash = version = dedup), and served on demand for the chosen endpoint —
**not** inlined into `search`/`discover` (that would violate progressive disclosure). All new fields
are **optional, advisory, backward-compatible**.

## Current state (why this is capture, not collection)

No provider registration API exists — the index is built by crawling x402/MPP directories and
hopping each origin's `/openapi.json` (`src/ingest/discover.ts:80` `runIngest`). Two crawled sources
already contain schema material and discard it:

- **OpenAPI** — `extractInputs` (`src/ingest/openapi-parser.ts:222-247`) walks `op.parameters` **and**
  `requestBody.content[*].schema`, resolving local `$ref` and merging `allOf/oneOf/items`, then keeps
  only property **names** (`schemaPropertyNames` → `string[]`). Responses (`:317-321`) collapse to
  `{ has200, has402 }` booleans; `responses[*].content` schema is never read.
- **Bazaar `402` snapshot** — `src/ingest/bazaar.ts:36` types `extensions.bazaar.info.input` but
  reads only `.input.method` (`methodOf`, `:41`), discarding real schema the live registry carries.
  Verified against the live CDP registry (`api.cdp.coinbase.com/platform/v2/x402/discovery/resources`,
  2026-07-03), a Bazaar resource carries schema in three places, best-first:
  1. **`accepts[].outputSchema`** — a JSON Schema container `{ input, output }` with real
     `properties`/`required`/`type` (+ sibling `accepts[].mimeType` for content type). This is
     Bazaar's cached snapshot of the runtime `402`, so it is available **statically at ingest**.
  2. **`extensions.bazaar.schema`** — a full JSON Schema Draft 2020-12 (present on every resource).
  3. **`extensions.bazaar.info`** = `{ input: {method, body, queryParams, pathParams}, output:
     {example} }` — useful for the location split (`body`/`query`/`path`) and examples, but `output`
     is an example, **not** a schema.
  This covers x402 endpoints whose origin serves no `openapi.json` — a large slice. (MPP catalog
  entries from `mpp.dev`, by contrast, carry no static schema and rely on the origin's OpenAPI hop.)

The endpoint record (`src/core/types.ts:150-182`, mirror `spec/endpoint-record.schema.json`,
`additionalProperties:false`) has no request/response schema field. Records spread verbatim through
`gateAndWrite` (`discover.ts:52`) and `enrich-facets.ts`, so new fields reach the index
automatically. Endpoint `id = sha256(origin|method|path)` (`src/core/id.ts:11`) is schema-independent
→ no id churn.

## Goal & non-goals

**Goal:** for OpenAPI- and Bazaar-sourced endpoints, capture a normalized input + output JSON Schema
at ingest, store it content-addressed, and serve it at the schema step (MCP + CLI), with lightweight
refs on `resolve`/`discover`.

**Non-goals (this spec):**
- Live payment verification (the "claims x402, returns empty `accepts`" problem) — sibling spec.
- **Live re-probing** for schema — hitting the endpoint's own runtime `402` for a fresh
  `accepts[].outputSchema` belongs to the liveness probe (sibling spec). This spec captures the
  **static** crawl, which already includes Bazaar's *cached* `accepts[].outputSchema`.
- **Network-notation normalization** (`eip155:8453` vs `base` for one chain, seen in real `accepts`)
  is a payment-data-quality fix, not schema — noted for the sibling spec.
- Hand-authored schemas for endpoints with neither source — those omit the fields.
- Chasing remote (`$ref` to another URL) references — local component refs only.
- Guaranteeing the live response matches the schema — schemas are **advisory** (see §8).

## The payment plane is separate (read this before the schemas)

`input_schema` describes the **business** request. It does **not** describe how to pay. A complete
paid call composes two planes:

1. **Business inputs** — path / query / headers / body, from `input_schema` (this spec).
2. **Payment credential** — added at the execute step, from the `payment` rails (+ the live `402`):
   - **x402:** request unpaid → `402` with `accepts[]` → sign an entry → retry with an **`X-Payment`**
     header (`spec/traversal.md:75-79`, `mcp/skills/oasis.md:62`).
   - **MPP:** open a Tempo session → send **`X-MPP-Session: <token>`** per call (`traversal.md:81-84`,
     `oasis.md:63`).

`X-Payment` / `X-MPP-Session` are protocol headers injected by the payment client; they are **not**
in `input_schema` and must not be. The spec's field docs state this so a consumer never builds a
request that is business-valid but unpaid (or vice-versa).

## Standards mapping

Everything here is a named, off-the-shelf standard — nothing bespoke a third-party consumer must
learn:

| Concern | Standard used |
|---|---|
| Source of the contract | OpenAPI Operation Object; x402 Bazaar `accepts[].outputSchema` + `extensions.bazaar.schema` |
| Normalized format | **JSON Schema 2020-12** (OpenAPI 3.1's own dialect; 3.0 down-converted) |
| Local `$ref` handling | 2020-12 **compound document** — bundle into `$defs` (no inline explosion) |
| Delivery shape | progressive disclosure — a distinct **schema step** (`traversal.md`), not eager inlining |
| Field-name concept | MCP tool `inputSchema` / `outputSchema` (agentic-native; here in OASIS snake_case) |
| Versioning | **content hash** — `sha256` over canonical JSON (RFC 8785 JCS semantics); ETag / Confluent-fingerprint pattern |
| Storage | content-addressed schema store (JSON Schema `$id` / registry model) — dedup + hash-as-version |
| Trust model | advisory + **validate-at-use** (consumer-driven contract testing / Pact posture) — "the runtime 402 is authoritative" (`bazaar.ts:5`, `x-payment-info.schema.json:5`) |

## Design

### 1. Data model

`EndpointRecord` (`src/core/types.ts`) + `spec/endpoint-record.schema.json` gain these **optional**
fields (snake_case, matching `provider_fqn` / `schema_missing` / `openapi_url`):

| Field | Type | Meaning |
|---|---|---|
| `input_schema_ref?` | `string` (64-hex sha256) | key into the schema store |
| `output_schema_ref?` | `string` (64-hex sha256) | key into the schema store |
| `schema_source?` | `"openapi" \| "bazaar"` | which crawled source the schema came from |
| `schema_captured_at?` | ISO date-time | when this endpoint's schema was captured |
| `schema_truncated?` | `boolean` | set when a pathological schema exceeded the size/depth cap and was dropped |

New sidecar artifact **`dist/schemas.json`**: `{ [sha256]: <JSON Schema 2020-12 object> }`. The
record carries only the 64-char refs, so `dist/index.json` stays lean and identical component schemas
(shared across many endpoints) collapse to one stored copy. Bump `SPEC_VERSION` 0.2.0 → 0.3.0
(`discover.ts:16-17`, carried by `enrich-facets.ts`).

**Source precedence** (an origin may have both): `openapi` (full operation) supersedes `bazaar`
(partial extension). Live sources (sibling spec) supersede either. `schema_source` records which one
won.

### 2. Input schema representation (location-aware, lossless)

An HTTP endpoint's inputs live in four places. We keep them separated so a consumer can reconstruct
the exact request without guessing, while remaining a single standard JSON Schema object:

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "path":    { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] },
    "query":   { "type": "object", "properties": { "limit": { "type": "integer" } } },
    "headers": { "type": "object", "properties": { "X-Api-Key": { "type": "string" } } },
    "body":    { "type": "object", "properties": { "url": { "type": "string", "format": "uri" } }, "required": ["url"] }
  },
  "required": ["body"],
  "$defs": { /* bundled local component schemas */ }
}
```

- `path` / `query` / `headers` are built from `op.parameters` grouped by `in`; each parameter's
  `schema` is normalized, `required` reflects `parameter.required`. The payment headers (`X-Payment`
  / `X-MPP-Session`) are protocol-injected and deliberately excluded (§payment plane).
- `body` is the normalized `requestBody.content['application/json'].schema` (else the first
  JSON-ish media type).
- A location key is **omitted** when the endpoint has no inputs there (pure-body POST → only `body`;
  GET → only `path`/`query`). Top-level `required` lists the mandatory locations.
- **Bazaar source (priority):** `accepts[].outputSchema.input` (already JSON-Schema-shaped) → else
  `extensions.bazaar.schema` → else the `extensions.bazaar.info.input` `{body, queryParams,
  pathParams}` structure, inferring a schema from example values. Map onto the same location-keyed
  `body`/`query`/`path` shape (Bazaar already splits inputs this way).

### 3. Output schema

From OpenAPI, prefer the **2xx success** body: `responses["200"]` (else first `2xx`) →
`content['application/json'].schema` (else first JSON-ish media type), normalized and bundled. From
Bazaar (priority): `accepts[].outputSchema.output` (real JSON Schema) → else
`extensions.bazaar.schema` → else infer from `extensions.bazaar.info.output.example` (an example, so
weakest). `accepts[].mimeType` sets the content type. Non-JSON / binary / empty → omit
`output_schema_ref` (the coarse `facets.modality` still signals `image`/`audio`/etc.).

The `402` response body is **not** an output schema — it is the payment challenge
(`accepts`/PaymentRequirements), captured on the payment plane (the `payment` field + the sibling
liveness spec), never as `output_schema`.

### 4. Normalization (source → JSON Schema 2020-12)

A pure module `src/ingest/schema-normalize.ts`:

- Detect dialect from `doc.openapi`: **3.1** schemas are already 2020-12 → pass through, ensure
  `$schema`. **3.0** → transform: `nullable: true` → add `"null"` to `type`; `example` →
  `examples: [<value>]`; drop OpenAPI-only schema keywords (`xml`, `discriminator`, `externalDocs`).
  Bazaar's `accepts[].outputSchema` / `extensions.bazaar.schema` are already JSON Schema (Draft
  2020-12) — ensure `$schema`; `info` example values are type-inferred into a schema.
- **Bundle** local `$ref`: collect referenced `#/components/schemas/*` (and nested) into a `$defs`
  block, rewrite refs to `#/$defs/<name>`, producing a self-contained compound document. Reuse the
  existing `resolveRef` traversal (`openapi-parser.ts:173`). Cycles are safe (refs, not inlined).
- **Caps:** a max node count / depth (mirroring `schemaPropertyNames`' depth guard). A schema over
  the cap is dropped and the record gets `schema_truncated: true` rather than bloating the store.

### 5. Storage + versioning (content-addressed)

`src/ingest/schema-store.ts`:

- `schemaRef(schema) → string`: `sha256` over **canonical JSON** (recursively key-sorted;
  RFC 8785 JCS semantics — a sorted-key stringify suffices for schema objects; adopt a JCS lib only
  if a numeric-canonicalization case surfaces). Same schema, any key order → same ref.
- A collector maps `ref → schema`; identical schemas dedupe. The ref **is** the version: any provider
  change flips the hash, so a downstream renderer keyed on the old ref knows the contract moved.

`parseOpenApi` and `bazaarToEndpoint` set the record refs; extraction returns
`{ record(s), schemas: Map<string, JsonSchema> }`. `runIngest` merges the per-source maps and writes
`dist/schemas.json` alongside `index.json`. Schema text is **kept out of `endpointEmbedText`**
(`src/embed/endpoint-text.ts`) so the vector cache is not invalidated — no re-embed.

### 6. Delivery — the schema step (progressive disclosure)

Aligns with `search → resolve → schema → execute` (`spec/traversal.md`):

- **`resolve` / `discover`** carry only the lightweight signal: `input_schema_ref`,
  `output_schema_ref`, `schema_source` (so a consumer knows a schema is available + its version, at
  ~64 bytes each). No full schema by default — that would ship schemas for endpoints the agent has
  not chosen.
- **New schema step:** `oasis_schema(endpoint_id)` MCP tool (`mcp/tools.mjs`) + `capindex schema <id>`
  CLI (`src/cli.ts`) resolve the refs against `dist/schemas.json` and return the full normalized
  `input_schema` + `output_schema` + refs + `schema_source` for the **chosen** endpoint(s).
- **Opt-in eager path:** `oasis_discover(..., include_schema=true)` inlines the resolved schemas for
  the ranked subset — for consumers (e.g. the Dashboard) that want one round-trip. Default is off.
- `mcp/server.mjs` + `mcp/http-server.mjs` load `dist/schemas.json` beside the index and serialize
  whatever `handleTool` returns.
- **Update `spec/traversal.md` step 3** to document that OASIS now serves the normalized schema
  (fetching raw `openapi.json` becomes the fallback, not the primary path).

### 7. Advisory contract

Field docs and `docs/` state plainly: schemas are the provider's self-declaration, captured at
`schema_captured_at`, and **may be wrong or stale** — "the runtime 402 is authoritative"
(`bazaar.ts:5`). Consumers should **validate the actual response against `output_schema`** (e.g. Ajv)
at the boundary rather than assuming conformance.

### 8. Backward compatibility

All fields optional; endpoints without a schema omit them; existing consumers ignore unknown fields;
`resolve`/`discover` shapes only gain optional refs. `spec/endpoint-record.schema.json` adds the
properties (required because `additionalProperties:false`); `capindex validate` passes. A schema-less
endpoint validates unchanged.

## Testing (TDD, `node:test`, inline docs)

Co-located `*.test.ts`, `node:test` + `node:assert/strict`, deterministic `builtAt`, no network —
matching `src/ingest/openapi-parser.test.ts`.

1. **`schema-normalize.test.ts`** — 3.0 `nullable:true` → type union with `"null"`; `example` →
   `examples`; OpenAPI-only keywords stripped; 3.1 passthrough sets `$schema`; local `$ref` bundled
   into `$defs` with rewritten pointers; recursive `$ref` terminates; over-cap schema → dropped +
   truncated flag.
2. **`schema-store.test.ts`** — `schemaRef` stable across key permutations; two identical schemas →
   one map entry (dedup).
3. **`openapi-parser.test.ts`** (extend) — a doc with a `requestBody` `$ref` + query `parameters` +
   a `200` JSON response asserts: refs set; the returned `schemas` map holds a location-keyed input
   (`body` + `query`) and the output schema; a body-less GET yields `query`/`path` only; a non-JSON
   response omits the output ref; `schema_source: "openapi"`.
4. **`bazaar.test.ts`** (real shapes from the live registry) — a resource with
   `accepts[].outputSchema.{input,output}` yields location-keyed refs + `schema_source: "bazaar"`; a
   resource lacking it falls back to `extensions.bazaar.schema`; one with only
   `extensions.bazaar.info` (example output, no schema) infers input from `{body, queryParams,
   pathParams}` and omits the output ref; a resource with only `.input.method` yields no schema
   (method still parsed).
5. **Schema step** — a `node:test` for `oasis_schema`: given a record with refs + a store, it returns
   the inlined `input_schema` / `output_schema`; and `oasis_discover` default **omits** full schemas
   but includes refs; `include_schema=true` inlines them.
6. **Backward-compat / validate** — a schema-less endpoint passes `gradeEndpoint` and
   `capindex validate`; a fixture endpoint with refs validates against the updated record schema.

## Build / rollout impact

- New artifact `dist/schemas.json`; snapshot publish (`scripts/snapshot/publish.sh`) includes it;
  `dist-snapshot.lock.json` covers the published bundle as before.
- `dist/index.json` size effectively unchanged (refs are 64-char strings); schema bytes live once in
  the sidecar and dedupe across endpoints.
- No re-embed (schema text excluded from the embed key).
- `SPEC_VERSION` 0.2.0 → 0.3.0 signals the record-shape change; `spec/traversal.md` step 3 updated.
- Validation gate unchanged: `pnpm run build && pnpm test && pnpm exec capindex validate`.

## Open questions

None blocking. Deferred by intent: live schema sources (runtime `402` `accepts[].outputSchema` /
`mimeType`, live Bazaar extension) → sibling liveness spec; hand-authored schemas for endpoints with
no crawled source; full RFC 8785 number-canonicalization (sorted-key stringify suffices today).
