# OASIS

Open **standard for discoverability** of paid HTTP APIs in **agentic commerce** via
**x402** and **MPP** — ontology, schemas, index artifacts, and reference CLI.

### Why we built this

As paid endpoints multiply, agents face registry noise, keyword collisions, and no reliable
way to map a natural-language task to the right micropayment API. We could not find a
high-quality, vendor-neutral discovery mechanism — so we built OASIS and open-sourced it.

**search → resolve → schema → execute** — with measured retrieval quality (see benchmarks
below). Not a hosted product, no fees.

> **Integrate it as one agent tool — and pay fewer tokens.** `oasis_find` returns the
> right paid endpoint for a task in a **single call**. Measured per tool-selection:
> **~2,460 tokens with `oasis_find` vs ~5,110 for a naïve two-hop design and ~2,870 for
> raw keyword search** over the same index — at equal-or-better accuracy. Roughly **half
> the token cost** of the obvious design, **fewer than keyword**, one round-trip.
> ([benchmarks](docs/eval_results.md))

A reference MCP server (`oasis_find` + the `search`/`resolve` primitives + LLM-assisted
contribution tools), an automated agent probe, and an A/B harness live in [`mcp/`](mcp/)
— works with any LLM provider. The validation + taxonomy they use are part of the standard
(`capindex validate-source` / `taxonomy`, run in CI).

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
(47 curated task intents in `ontology/intents/`), and follows the agent protocol
[`search → resolve → schema → execute`](spec/traversal.md).

### Measured accuracy (honest eval)

Full numbers, reproduction, and caveats: **[`docs/eval_results.md`](docs/eval_results.md)**.
Summary below.

**Curated messy queries** — 63 hand-written agent phrasings
([`eval/messy-queries.json`](eval/messy-queries.json)), each scored for discovery. They
share vocabulary with the capability aliases, so they measure *in-distribution* routing
(`pnpm run eval:compare` — includes live external APIs):

| Discovery method | discover@1 | discover@3 | discover MRR |
|---|---|---|---|
| endpoint keyword only | 12/63 (19%) | 17/63 (27%) | 0.260 |
| pay-skills slice only | 20/63 (32%) | 27/63 (43%) | 0.380 |
| x402scan slice only | 8/63 (13%) | 12/63 (19%) | 0.188 |
| mpp slice only (mppscan + catalog) | 6/63 (10%) | 11/63 (17%) | 0.165 |
| CDP x402 Bazaar (live API) | 0/63 | 1/63 | 0.012 |
| **OASIS — ontology + index** | **63/63 (100%)** | **63/63 (100%)** | **1.000** |
| **OASIS — hybrid retrieval** | **62/63 (98%)** | **63/63 (100%)** | **0.992** |

~3× the discover@1 of the best non-ontology baseline (pay-skills) and 5–10× the raw
registry slices: keyword/registry search matches *provider/endpoint strings*; the
ontology matches *the task*.

**Held-out generalization (the honest number)** — the curated ~100% is partly a
measurement illusion: keyword discovery is overfit to the alias vocabulary.
[`eval/heldout-queries.json`](eval/heldout-queries.json) is phrased *away* from the labels
(mean alias overlap 0.23) and split dev/test so it is never tuned against
(`pnpm run eval:heldout`):

| split | discover@1 | discover@3 |
|---|---|---|
| dev (44) | 66% | 86% |
| **test (43, untuned)** | **72%** | **88%** |

Keyword alone collapses to **41%** on novel phrasings — the vector arm carries
generalization. Caps-first hybrid fusion + enriched capability embed text took real
discover@1 from **43% → ~66–72%** with no index rebuild.

**Multi-label & chaining** — [`eval/multi-label-queries.json`](eval/multi-label-queries.json)
scores the typed-link features the single-label set can't (`pnpm run eval:multi`):
hard-negative **6/6**, related@links **15/15**, task recall@3 **28/28**.

### Token cost — one call, fewer tokens

End-to-end test: a live LLM (Sonnet 4.6) picks a paid endpoint for 18 real tasks using
each discovery tool; a **method-neutral judge** scores whether the chosen endpoint
actually does the task. `oasis_find` collapses search→resolve server-side, so the agent
answers in one call:

| discovery tool the agent uses | judged-correct | avg tokens/task (in+out) | avg tool-calls |
|---|---|---|---|
| **`oasis_find` (one call)** | **18/18 (100%)** | **2,462** (2,161 + 301) | 1.1 |
| two-hop `search`→`resolve` | 18/18 (100%) | 5,110 (4,740 + 370) | 2.1 |
| raw keyword over the same index | 17/18 (94%) | 2,872 (2,607 + 265) | 1.9 |

`oasis_find` is the cheapest **and** most accurate: **−52% tokens vs the two-hop** (the
agent never reads a capability list, a resolve round, or a related-options payload) and
**−14% vs raw keyword**, while edging it on accuracy — one round-trip because the server
returns a tight, pre-ranked list. Reproduce: `cd mcp && node --env-file=../.env compare.mjs`
(any provider). Harder-task / weak-model sweeps and the full write-up:
[`docs/eval_results.md`](docs/eval_results.md).

### Resolve wiring (ontology → endpoint)

Search is only half the protocol. **Resolve accuracy** checks that each curated
intent’s primary `satisfies` ref points at a real indexed endpoint:

```bash
pnpm run eval:resolve   # 47/47 curated intents resolve
```

### What we are *not* claiming

- Real-world discovery is **~72% discover@1 / ~88% discover@3** (held-out test split),
  not the curated 100% — see [`docs/eval_results.md`](docs/eval_results.md).
- An end-to-end agent probe (a live LLM picking tools via [`mcp/`](mcp/)) reaches the
  right capability **~17/18** of the time — validating the flow, but it is only 18 tasks.
- Schema fetch and paid execute are documented in
  [`spec/traversal.md`](spec/traversal.md), not automated here.

### Reproduce

```bash
pnpm run build          # full index (~30k endpoints)
pnpm run embed          # 47 curated capability vectors
pnpm run eval:compare   # messy NL: all discovery methods (+ live external APIs)
pnpm run eval:heldout   # held-out generalization (dev + untuned test split)
pnpm run eval:multi     # multi-label / hard-negative / typed-link chaining
pnpm run eval:resolve   # ontology → endpoint wiring
pnpm test
cd mcp && npm install && npm run probe   # end-to-end agent probe (any LLM provider)
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
pnpm run embed          # optional: hybrid vector index (47 curated intents)
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

# Contribute a service: dump the controlled vocab + validate a task-intent before a PR
# (validate-source is the SAME check CI runs on the PR)
pnpm exec capindex taxonomy --json
pnpm exec capindex validate-source ontology/intents/ai.web_research.yaml

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

## Adding capabilities / contributing a service

OASIS scales by **LLM-assisted, contributor-funded curation**: the service owner curates
their own endpoints into the taxonomy (their LLM, their cost) and opens a PR; OASIS keeps
a cheap, objective validation gate. Full guide:
[docs/contributing-capabilities.md](docs/contributing-capabilities.md).

A task intent is a YAML under `ontology/intents/` — **task-only**; endpoint membership is
materialized at build time, so you don't hand-write `satisfies`:

```yaml
id: ai.moderate_content                            # domain.snake_case; domain ∈ facet enum
label: Moderate content for safety and policy violations
aliases: [content moderation, toxicity detection, flag harmful content]
consumes: [{ entity: Text, role: payload }]        # entity ∈ closed vocab (spec/entity-vocab.json)
produces: [{ entity: StructuredRecord, role: payload, format: json }]
facets: { domain: ai, action: analyze, modality: [json] }
links: [{ type: sibling_of, to: ai.web_research }] # to an existing capability id
```

The flow (assisted by the MCP `oasis_taxonomy` + `oasis_validate` tools, or the CLI):
1. `capindex taxonomy --json` → the controlled vocab to bind INTO (existing capabilities,
   facet/entity enums).
2. Bind your endpoints into an **existing** capability where one fits; **propose a new**
   one only when nothing does (flag it in the PR for human review — keeps the taxonomy
   from fragmenting).
3. `capindex validate-source <file>` → the **same check CI runs**. Then open the PR.

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
ontology/intents/      Curated capability definitions (47 task intents)
eval/                  messy-queries.json + queries.json benchmarks
src/                   Indexer + CLI + hybrid retrieval (TypeScript)
dist/                  Built artifacts — generated by `pnpm build`, gitignored
                       (index/endpoints/capabilities/providers.json + lance/)
```

## License

MIT — see [LICENSE](LICENSE).