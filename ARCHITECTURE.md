# OASIS Architecture

High-level design of how OASIS discovers paid HTTP APIs (x402 and MPP) for agentic commerce.
This describes the **current** index-build + traversal implementation; for the direction the
project is heading (endpoint-atomic retrieval, the one-hop `oasis_find`, LLM-assisted
distributed curation), see [docs/scaling.md](docs/scaling.md).

## Agent traversal protocol

Agents use progressive disclosure: search globally, resolve one endpoint, fetch schema on demand, then execute with the right payment rail.

```mermaid
flowchart LR
  subgraph agent["Agent"]
    Q["Natural-language task"]
    S["1. Search"]
    R["2. Resolve"]
    SC["3. Schema"]
    X["4. Execute"]
  end

  subgraph oasis["OASIS index (dist/)"]
    CAP["capabilities.json<br/>56 curated intents"]
    EP["endpoints.json<br/>~22k gated endpoints"]
    IDX["index.json<br/>full bundle"]
  end

  subgraph origin["API origin"]
    OAPI["openapi.json"]
    API["HTTP endpoint"]
  end

  subgraph payment["Payment rails"]
    X402["x402<br/>X-Payment header"]
    MPP["MPP<br/>X-MPP-Session"]
  end

  Q --> S
  S --> CAP
  S --> EP
  S --> IDX
  S --> R
  R -->|"origin, path, method,<br/>price_usd, rails"| SC
  SC --> OAPI
  SC --> X
  X --> API
  API --> X402
  API --> MPP
```

| Step | Input | Output | Source |
|------|-------|--------|--------|
| Search | NL query | Ranked intents + endpoints | `capabilities.json`, `endpoints.json` |
| Resolve | Intent ID or endpoint ID | Concrete origin, path, payment metadata | Index record + `satisfies[]` wiring |
| Schema | Origin + path | Request/response JSON Schema | `{origin}/openapi.json` (not duplicated in index) |
| Execute | Full URL + body | API response | x402 or MPP client |

---

## Index build pipeline

The production build is `pnpm build` = **`capindex ingest`** (federate registries → enrich each origin's `/openapi.json` → quality gate → `dist/index.json`) followed by **`enrich-facets`** (semantic endpoint→intent binding + `satisfies[]` materialization).

```mermaid
flowchart TB
  subgraph discovery["Discovery — federate registries (ingest/discover.ts)"]
    BZ["CDP x402 Bazaar<br/>/x402/discovery/resources"]
    MC["mpp.dev<br/>/api/services"]
    PSH["pay.sh<br/>/api/catalog"]
    X4["x402scan origins"]
  end

  subgraph enrich["Per-origin enrichment"]
    OJ["fetch {origin}/openapi.json"]
    OP["openapi-parser.ts<br/>paths, summaries,<br/>x-payment-info.offers · x-service-info · 402"]
    ID["origin-aliases.ts + id.ts<br/>sha256(origin|method|path)"]
  end

  subgraph gate["Quality gate (quality-gate.ts)"]
    G["pass / drop<br/>drop: stub · meta · content-free · thin (under 5 fields)"]
    CS["+ completeness score + ranking flags"]
  end

  subgraph bind["Semantic bind (enrich-facets.ts)"]
    EM["embed endpoints + curated intents<br/>gemini-embedding-001"]
    BE["bind-endpoints.ts<br/>dense floor + strong-sparse promotion"]
    MAT["materialize-satisfies.ts<br/>satisfies[] per intent"]
  end

  subgraph out["dist/ artifacts"]
    IJ["index.json<br/>(+ endpoints / capabilities)"]
  end

  BZ --> OJ
  MC --> OJ
  PSH --> OJ
  X4 --> OJ
  OJ --> OP --> ID --> G
  G --> CS
  CS --> EM --> BE --> MAT --> IJ
```

**Key design choices**

- **Origin-centric IDs** — `sha256(origin|method|path)`; no vendor-specific ID logic.
- **Ingest, don't own** — federate public registries (CDP x402 Bazaar, mpp.dev, pay.sh, x402scan), enrich each origin's `/openapi.json`, publish a neutral `dist/`.
- **One discovery standard** — parse the `draft-payment-discovery-00` shape (`x-payment-info.offers`, `x-service-info`, a required `402`); x402 and MPP are the same standard, validated against the Appendix C/D JSON Schemas in `spec/`.
- **Quality gate at ingestion** — drop stubs, meta paths, content-free boilerplate, and too-thin records before they enter the index; keep a completeness score + ranking flags. What authors should do to pass it: [docs/authoring-openapi-specs.md](docs/authoring-openapi-specs.md).
- **OpenAPI is source of truth** — index holds summaries and payment facets, not full schemas.
- **Payment rails as siblings** — x402 and MPP live under `payment.rails[]` on each endpoint.

---

## Search & retrieval

Search maps a natural-language task to ranked capability intents (and optionally raw endpoints). Hybrid mode fuses keyword and vector recall.

```mermaid
flowchart TB
  Q["NL query"]

  subgraph keyword["Keyword search (search.ts)"]
    TOK["Tokenize + stopword filter"]
    CAPS["Score curated capabilities<br/>label, aliases, intent ID"]
    EPS["Score endpoint search_text<br/>summaries, paths"]
    KW["Ranked keyword hits"]
  end

  subgraph vector["Vector search (optional, --hybrid)"]
    EMB["embed/embedder.ts<br/>text embeddings"]
    LANCE["embed/lance-index.ts<br/>LanceDB table"]
    VEC["Vector nearest-neighbors<br/>56 curated intents"]
  end

  subgraph fusion["Hybrid fusion (search-hybrid.ts)"]
    RRF["Caps-first RRF<br/>keyword×1 + vector×2"]
    OUT["Merged SearchHit[]"]
  end

  Q --> TOK
  TOK --> CAPS --> KW
  TOK --> EPS --> KW

  Q --> EMB --> LANCE --> VEC

  KW --> RRF
  VEC --> RRF
  RRF --> OUT
```

**Search hit kinds**

| `kind` | Meaning |
|--------|---------|
| `capability` | Curated task intent — preferred entry point for resolve |
| `endpoint` | Direct endpoint row — fallback when no intent matches |

Capability hits carry a `capability_id`; resolve expands `satisfies[]` into concrete endpoints ranked by **task fit** (intent-id + label/alias vocabulary + the query), with the neutral quality prior as a tiebreaker.

---

## Ontology → endpoint wiring

Curated intents are provider-agnostic task definitions. Endpoints are bound to capabilities by
the **semantic binder** (`embed/bind-endpoints.ts`): every endpoint and every curated intent is
embedded (`gemini-embedding-001`) and bound by dense similarity above a floor, with a
**strong-sparse promotion** path that rescues endpoints the dense floor misses but whose sparse
(lexical) signal is strong. This binding runs in the production build via **`enrich-facets`**,
written onto each endpoint as `endpoint.capabilities[]`; `materialize-satisfies.ts` then derives
each intent's `satisfies[]`. Binding is semantic-only.

```mermaid
flowchart LR
  subgraph intent["Curated intent (YAML)"]
    ID2["id: data.weather_forecast"]
    LB["label + aliases + facets"]
  end

  subgraph bind["linkCapabilitiesToEndpoints()"]
    M["Bind endpoints → capabilities<br/>(facet/semantic; regex = fallback)"]
    C["endpoint.capabilities[]"]
  end

  subgraph rank["select-policy.ts"]
    N["Task-fit ranking<br/>intent-id + vocab + query;<br/>neutral prior = tiebreaker"]
    TOP["satisfies[] (ranked)"]
  end

  subgraph wire["Index wiring"]
    SAT["capabilities.json<br/>satisfies[] = origin+method+path"]
    REV["endpoint.capabilities[]<br/>reverse link"]
  end

  ID2 --> M
  LB --> M
  M --> C --> N --> TOP --> SAT
  C --> REV
```

**Resolve path** (`capindex resolve --intent <id>`, and the `oasis_find` server tool):

1. Load the intent and map its `satisfies[]` to concrete endpoints via `sha256(origin|method|path)`.
2. Rank by **task fit** (`resolveEndpointsForQuery`): intent-id tokens (`weather_forecast`
   → weather/forecast) dominate, matched against each endpoint's own summary/path, plus the
   label/alias vocabulary and the user query; the neutral quality prior only breaks ties.
3. Return origin, path, `payment.rails`, `price_usd`, `openapi_url`.

---

## Evaluation harness

Benchmarks measure whether `search → resolve` finds the right paid API for natural-language queries.

```mermaid
flowchart LR
  subgraph queries["eval/"]
    MQ["messy-queries.json<br/>64 hand-written NL queries"]
    GQ["queries.json<br/>644 golden queries"]
  end

  subgraph modes["Discovery modes"]
    KW2["endpoint keyword only"]
    PS2["pay-skills slice"]
    FULL["OASIS full index"]
    HYB["OASIS + hybrid RRF"]
    EXT["external APIs<br/>x402scan, mpp.dev, CDP Bazaar"]
  end

  subgraph metrics["eval/metrics.ts"]
    D3["discover@3"]
    D1["discover@1"]
    MRR["discover MRR"]
    RES["resolve accuracy<br/>56/56 intents"]
  end

  MQ --> modes
  GQ --> modes
  modes --> D3
  modes --> D1
  modes --> MRR
  FULL --> RES
```

---

## Project layout

```
spec/                  JSON schemas + traversal protocol
ontology/intents/      Curated capability definitions (YAML)
src/                   Indexer, CLI, search, embed, eval, validate (TypeScript)
dist/                  Built artifacts (endpoints, capabilities, index)
eval/                  Benchmark query sets
mcp/                   Reference MCP server (oasis_find + contribution tools), agent probe, A/B harness
docs/                  Benchmarks, scaling thesis, contribution guide
```

The full benchmark suite (curated, held-out generalization, multi-label, and the end-to-end
agent probe / token-cost A/B) is documented in [docs/eval_results.md](docs/eval_results.md).
See [spec/traversal.md](spec/traversal.md) for the agent protocol, [README.md](README.md) for
CLI usage, and [docs/scaling.md](docs/scaling.md) for the architecture direction.