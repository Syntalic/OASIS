# OASIS

Open **standard for discoverability** of paid HTTP APIs in **agentic commerce** via
**x402** and **MPP** — ontology, schemas, index artifacts, and reference CLI.

### Why we built this

As paid endpoints multiply, agents face registry noise, keyword collisions, and no reliable
way to map a natural-language task to the right micropayment API. We could not find a
high-quality, vendor-neutral discovery mechanism — so we built OASIS and open-sourced it.

**search → resolve → schema → execute** — with measured retrieval quality (see benchmarks
below). Not a hosted product, no fees. MCP is out of scope for this repo.

See [GOVERNANCE.md](GOVERNANCE.md).

## What this is

| Artifact | Purpose |
|----------|---------|
| `ontology/intents/` | Curated capability graph (what agents want to do) |
| `dist/endpoints.json` | Flat search index (every paid endpoint) |
| `dist/capabilities.json` | Intent definitions with endpoint mappings |
| `dist/index.json` | Full bundle |
| `spec/` | JSON schemas + [agent traversal protocol](spec/traversal.md) |

**Index** = fast lookup. **Ontology** = semantic routing across providers.

## Discovery: status quo vs OASIS

How do agents find paid x402/MPP APIs today? Usually one of these:

| Method | What the agent does | Limit |
|--------|---------------------|-------|
| **Guess / paramemory** | Hallucinate a URL or vendor API | No payment metadata, stale, wrong path |
| **Browse a registry** | Crawl x402scan, mppscan, or mpp.dev by hand | Doesn't scale; no task → endpoint routing |
| **Provider catalog search** | Match provider name/description only | Answers “which vendor?” not “which task?” |
| **Endpoint keyword grep** | Token-match 30k OpenAPI summaries | High recall, collisions on generic summaries |
| **pay-skills slice only** | Search ~70 curated providers | ~10× smaller coverage than unified index |

**OASIS** unifies those catalogs into one index, adds a **curated task ontology**
(25 intents in `ontology/intents/`), and follows the agent protocol
[`search → resolve → schema → execute`](spec/traversal.md).

### Measured on natural-language queries (honest eval)

**43 messy queries** — hand-written agent phrasing, *not* copied from capability
labels ([`eval/messy-queries.json`](eval/messy-queries.json)). This is the
realistic signal.

| Discovery method | discover@3 | discover@1 | discover MRR |
|------------------|------------|------------|--------------|
| Endpoint keyword only | 13/43 (30%) | 9/43 | 0.265 |
| Provider catalog only | 0/43 (0%) | 0/43 | 0.000 |
| pay-skills slice only | 21/43 (49%) | 14/43 | 0.432 |
| **OASIS (ontology + index)** | **43/43 (100%)** | **38/43** | **0.934** |
| **OASIS + hybrid retrieval** | **43/43 (100%)** | **42/43** | **0.988** |

Run `pnpm run eval:compare` for a side-by-side table that also includes registry
slices and live external discovery APIs:

| Method | What it simulates |
|--------|-------------------|
| `x402scan-only` | Keyword search over x402scan-ingested endpoints only |
| `mpp-only` | Keyword search over mppscan + mpp.dev catalog endpoints |
| `mpp-catalog-live` | Live keyword search on [mpp.dev/api/services](https://mpp.dev/api/services) |
| `cdp-bazaar` | Live semantic search on [CDP x402 Bazaar](https://api.cdp.coinbase.com/platform/v2/x402/discovery/search) |

External APIs score **URL/literal match** only (no ontology resolve step).

Measured **discover@3** on the same 43 messy queries:

| Method | discover@3 | discover@1 | discover MRR |
|--------|------------|------------|--------------|
| Endpoint keyword only | 13/43 | 9/43 | 0.264 |
| pay-skills slice only | 21/43 | 14/43 | 0.432 |
| x402scan slice only | 10/43 | 6/43 | 0.184 |
| mpp slice only (mppscan + catalog) | 5/43 | 2/43 | 0.096 |
| mpp.dev catalog (live API) | 0/43 | 0/43 | 0.009 |
| CDP x402 Bazaar (live API) | 1/43 | 0/43 | 0.012 |
| **OASIS (ontology + index)** | **43/43** | **38/43** | **0.934** |
| **OASIS + hybrid retrieval** | **43/43** | **42/43** | **0.988** |

**vs best baseline (pay-skills-only):** **+22 more tasks** found in top 3 (**2.0×**
hit rate). **vs endpoint grep:** **+30** (**3.3×**).

Hybrid = curated vector recall (25 intents, LanceDB) fused with keyword search
(keyword×2, vector×1 RRF). Same top-3 coverage; better rank-1 accuracy (+4 queries).

### Regression set (644 golden queries)

Auto-generated from capability labels ([`eval/queries.json`](eval/queries.json)) —
useful for CI, optimistic for real-world NL.

| Method | discover@3 |
|--------|------------|
| Endpoint keyword only | 466/644 (72%) |
| pay-skills slice only | 173/644 (27%) |
| **OASIS (full index)** | **638/644 (99%)** |

### Resolve wiring (ontology → endpoint)

Search is only half the protocol. **Resolve accuracy** checks that each curated
intent’s primary `satisfies` ref points at a real indexed endpoint:

```bash
pnpm run eval:resolve   # 25/25 curated intents resolve
```

### What we are *not* claiming yet

- No live LLM agent or MCP server in the loop (retrieval benchmark only)
- Golden 644/644 is not real-world accuracy — prefer messy eval
- Schema fetch and paid execute are documented, not automated here

### Reproduce

```bash
pnpm run build          # full index (~30k endpoints)
pnpm run embed          # 25 curated vectors
pnpm run eval:hybrid    # messy NL: baseline vs hybrid
pnpm run eval:compare   # messy NL: all discovery methods (+ external APIs)
pnpm run eval           # golden 644: all index modes
pnpm run eval:resolve   # ontology wiring
pnpm test
```

### Benchmark metrics

| Metric | Meaning |
|--------|---------|
| **discover@k** | Correct paid API via `search → resolve` in top *k* (primary score) |
| **discover@1** | Correct API at rank 1 |
| **task@k** | Correct task intent in top *k* |
| **literal@k** | Correct endpoint row directly in results (no resolve step) |
| **discover MRR** | Mean reciprocal rank for discover@k — 1.0 means always rank 1 |

**Headline number:** **discover@3** — can an agent find the right paid API within
three search results?

## Quick start

**Using a release:** download `dist/index.json` (and siblings) from
[GitHub Releases](https://github.com/Syntalic/OASIS/releases) — no build required for
search/resolve against the prebuilt index.

**Building from source:**

```bash
git clone https://github.com/Syntalic/OASIS.git
cd OASIS
pnpm install
pnpm run build          # full ingest (~30k endpoints; needs network)
pnpm run embed          # optional: hybrid vector index (25 curated intents)
```

Build ingests from multiple public catalogs:

| Source | What it pulls |
|--------|----------------|
| [pay-skills](https://github.com/solana-foundation/pay-skills) | Committed OpenAPI specs (local checkout) |
| [x402scan](https://www.x402scan.com) | Server sitemap → resource URLs → per-origin `openapi.json` |
| [mppscan](https://www.mppscan.com) + [mpp.dev](https://mpp.dev/api/services) | MPP service catalog + mppscan server pages |

```bash
pnpm exec capindex build --pay-skills /path/to/pay-skills
pnpm exec capindex build --skip-pay-skills          # scans + mpp catalog only
pnpm exec capindex build --no-x402scan --no-mppscan # pay-skills only
```

## CLI

```bash
# Search by natural language
pnpm exec capindex search "cheapest airpods pro"
pnpm exec capindex search "send email" --json
pnpm exec capindex search "grab a PNG of nike.com" --hybrid   # keyword + vector RRF

# Resolve an intent to concrete endpoints
pnpm exec capindex resolve --intent shop.compare_price

# Resolve by endpoint ID
pnpm exec capindex resolve --endpoint <sha256-id>

# Validate dist/index.json
pnpm exec capindex validate

# Show stats
pnpm exec capindex stats
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

- **Open standard** — spec + artifacts + reference CLI; self-host, fork, embed freely ([GOVERNANCE.md](GOVERNANCE.md))
- **Discover, don't gate** — surface tasks and capable endpoints; selection is agent policy, not editorial pick
- **Origin-centric IDs** — `sha256(origin|method|path)`, no vendor special cases
- **Payment rails as facets** — x402 and MPP are siblings under `payment.rails[]`
- **OpenAPI is source of truth** — index holds summaries, not full schemas
- **Ingest, don't own** — pull from pay-skills, Bazaar, x402scan; publish neutral dist

## Project layout

```
spec/                  JSON schemas + traversal protocol
ontology/intents/      Curated capability definitions (25 intents)
eval/                  messy-queries.json + queries.json benchmarks
src/                   Indexer + CLI + hybrid retrieval (TypeScript)
dist/                  Built artifacts (committed after build)
dist/lance/            Vector index (generated, gitignored)
```

## License

MIT — see [LICENSE](LICENSE).