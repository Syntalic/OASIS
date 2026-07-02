# Agent Traversal Protocol

Version 0.1.0 — vendor-neutral discovery for paid HTTP APIs (x402 and MPP).

## Overview

Agents discover and call paid APIs in four steps. Each step uses a smaller,
more precise artifact than the last.

```
search → resolve → schema → execute
```

| Step | Input | Output | Source |
|------|-------|--------|--------|
| 1. Search | Natural-language task | Ranked capability intents + endpoints | `capabilities.json` / `endpoints.json` |
| 2. Resolve | Intent or endpoint ID | Origin URL, path, payment rails, price | Index record |
| 3. Schema | Origin + path | Request/response JSON Schema | Origin `openapi.json` or Bazaar 402 extension |
| 4. Execute | Full URL + body | API response | x402 client (`X-Payment`) or MPP client (`X-MPP-Session`) |

## Step 1 — Search

Query the global index for capabilities and endpoints matching a task.

```bash
capindex search "cheapest airpods pro" --json
capindex search "send email" --limit 5
```

Returns ranked matches with `capability_id`, `endpoint_id`, `score`, `price_usd`,
and `payment.rails`.

Prefer capability matches over raw endpoint matches when both are available.

## Step 2 — Resolve

Get full metadata for a single endpoint or all endpoints satisfying an intent.

```bash
capindex resolve --intent commerce.compare_price
capindex resolve --endpoint <sha256-id>
```

Resolution returns:

- `origin` — base URL (no vendor-specific logic)
- `method`, `path` — HTTP target
- `payment` — `{ price_usd, rails: [{ protocol: "x402"|"mpp", networks }] }`
- `openapi_url` — where to fetch schemas (usually `{origin}/openapi.json`)
- `guidance_available` — whether origin publishes agent guidance
- `related[]` — the intent's typed-link neighborhood (each: `relation`,
  `intent_id`, `label`, `top_endpoint`). For an agent that is unsure or wants
  options, this is the pivot set: `alternative` (a substitute for the same
  task), `more specific` / `more general` (narrow or broaden the task),
  `related` (same family), `next step` (pipes to a follow-on task), or
  `prior step` (a task that produces this one's input — backward planning from a
  goal: "to get embeddings, first transcribe/ocr/translate").

## Step 3 — Schema

**Do not** embed full OpenAPI in the index. Fetch schemas from the origin:

```bash
curl -fsSL "${ORIGIN}/openapi.json"
```

For POST/PUT/PATCH endpoints, read `requestBody` and parameter schemas before
the first paid call.

x402 Bazaar-enabled APIs may also expose input/output in the `402` response
under `extensions.bazaar.info`.

## Step 4 — Execute

### x402 (wallet-signed)

1. Request without payment → receive `402 Payment Required`
2. Sign authorization for advertised `accepts[]` entry
3. Retry with `X-Payment` header

### MPP (hosted session)

1. Open MPP session with Tempo (or compatible provider)
2. Request with `X-MPP-Session: <token>`
3. Provider debits session balance per call

The index lists which rails each endpoint accepts. Agents without wallets
should filter for `mpp`; wallet-native agents prefer `x402`.

## Progressive disclosure rules

1. Search globally first — do not guess provider names.
2. Resolve one endpoint before calling — confirm price and rails.
3. Fetch schema only for the chosen endpoint — not the whole catalog.
4. If unsure, or an intent has no affordable/matching endpoint, pivot via the
   resolved `related[]` options — prefer `alternative` for a substitute,
   `more general`/`more specific` to re-scope, `next step` to chain.
5. If the origin returns no match, switch origin — do not retry random paths.

## Index artifacts

| File | Contents |
|------|----------|
| `dist/index.json` | Full bundle (endpoints + capabilities + stats) |
| `dist/endpoints.json` | Flat endpoint index |
| `dist/capabilities.json` | Curated intent ontology |

All artifacts include `index_version`, `spec_version`, and `built_at`.