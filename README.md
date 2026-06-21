# paid-api-graph

Vendor-neutral **ontology and index** for paid HTTP APIs that accept **x402** and **MPP**
micropayments. Any agent runtime, MCP server, or CLI can consume the published artifacts —
no provider lock-in.

## What this is

| Artifact | Purpose |
|----------|---------|
| `ontology/intents/` | Curated capability graph (what agents want to do) |
| `dist/endpoints.json` | Flat search index (every paid endpoint) |
| `dist/capabilities.json` | Intent definitions with endpoint mappings |
| `dist/index.json` | Full bundle |
| `spec/` | JSON schemas + [agent traversal protocol](spec/traversal.md) |

**Index** = fast lookup. **Ontology** = semantic routing across providers.

## Quick start

```bash
cd paid-api-graph
npm install
npm run build
```

Build ingests from multiple public catalogs:

| Source | What it pulls |
|--------|----------------|
| [pay-skills](https://github.com/solana-foundation/pay-skills) | Committed OpenAPI specs (local checkout) |
| [x402scan](https://www.x402scan.com) | Server sitemap → resource URLs → per-origin `openapi.json` |
| [mppscan](https://www.mppscan.com) + [mpp.dev](https://mpp.dev/api/services) | MPP service catalog + mppscan server pages |

```bash
npx capindex build --pay-skills /path/to/pay-skills
npx capindex build --skip-pay-skills          # scans + mpp catalog only
npx capindex build --no-x402scan --no-mppscan # pay-skills only
```

## CLI

```bash
# Search by natural language
npx capindex search "cheapest airpods pro"
npx capindex search "send email" --json

# Resolve an intent to concrete endpoints
npx capindex resolve --intent shop.compare_price

# Resolve by endpoint ID
npx capindex resolve --endpoint <sha256-id>

# Validate dist/index.json
npx capindex validate

# Show stats
npx capindex stats
```

## Agent workflow

Documented in [spec/traversal.md](spec/traversal.md):

```
search → resolve → schema (from origin OpenAPI) → execute (x402 or MPP)
```

1. **Search** the global index for intents/endpoints
2. **Resolve** to `origin`, `path`, `payment.rails`, `price_usd`
3. **Schema** from `{origin}/openapi.json` (not duplicated in the index)
4. **Execute** via x402 (`X-Payment`) or MPP (`X-MPP-Session`)

## Adding capabilities

Add a YAML file under `ontology/intents/`:

```yaml
id: shop.compare_price
label: Compare retail price across stores
aliases: [cheapest price, best deal]
satisfies:
  - origin: https://api.example.com
    method: GET
    path: /v1/shopper/best-price
    confidence: primary
```

Rebuild the index. Intent IDs use `domain.snake_case` — provider-agnostic.

## Ingestion sources

| Source | Flag | Notes |
|--------|------|-------|
| pay-skills | `--pay-skills <dir>` | Reads `providers/**/PAY.md` + `openapi.json` |
| x402scan | on by default | Sitemap → server pages → `openapi.json` per origin |
| mppscan | on by default | [mpp.dev/api/services](https://mpp.dev/api/services) catalog + mppscan server pages |
| OpenAPI | `--openapi <file> --origin <url>` | Single-spec ingest |

Origin migrations (e.g. `api.crushrewards.dev` → `api.syntalic.com`) are applied
automatically via `src/origin-aliases.ts`.

Payment metadata is extracted from OpenAPI extensions:

- `x-payment-info`, `x-faremeter-pricing`, `x-faremeter-assets`
- Inline `pricing` blocks (pay-skills legacy format)

## Design principles

- **Origin-centric IDs** — `sha256(origin|method|path)`, no vendor special cases
- **Payment rails as facets** — x402 and MPP are siblings under `payment.rails[]`
- **OpenAPI is source of truth** — index holds summaries, not full schemas
- **Ingest, don't own** — pull from pay-skills, Bazaar, x402scan; publish neutral dist

## Project layout

```
spec/                  JSON schemas + traversal protocol
ontology/intents/      Curated capability definitions
src/                   Indexer + CLI (TypeScript)
dist/                  Built artifacts (committed after build)
```

## License

MIT — see [LICENSE](LICENSE).