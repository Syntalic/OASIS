# OASIS Architecture

High-level design of how OASIS discovers paid HTTP APIs (x402 and MPP) for agentic commerce.

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
    CAP["capabilities.json<br/>47 curated intents"]
    EP["endpoints.json<br/>~30k paid endpoints"]
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

The reference CLI (`capindex build`) ingests public catalogs, normalizes them into a flat endpoint index, and wires curated task intents from the ontology.

```mermaid
flowchart TB
  subgraph sources["Ingestion sources"]
    PS["pay-skills<br/>local OpenAPI + PAY.md"]
    X4["x402scan<br/>sitemap → openapi.json"]
    MS["mppscan<br/>sitemap → openapi.json"]
    MC["mpp.dev catalog<br/>/api/services"]
    OA["--openapi file<br/>single-spec ingest"]
  end

  subgraph parse["Parse & normalize"]
    OP["openapi-parser.ts<br/>paths, summaries, payment extensions"]
    AL["origin-aliases.ts<br/>canonical origin URLs"]
    ID["id.ts<br/>sha256(origin|method|path)"]
    DD["dedupeEndpoints()<br/>merge rails + metadata"]
  end

  subgraph ontology["Ontology layer"]
    YAML["ontology/intents/*.yaml<br/>curated task definitions"]
    MM["intent-match.ts<br/>per-intent endpoint matchers"]
    MAT["materialize-satisfies.ts<br/>rank → satisfies[] refs"]
    EXP["ontology-expand.ts<br/>provider-derived links"]
    LINK["linkCapabilitiesToEndpoints()<br/>reverse index on endpoints"]
  end

  subgraph score["Neutral selection policy"]
    SE["score-endpoint.ts<br/>description, inputs, price, guidance"]
    SP["select-policy.ts<br/>rank candidates per intent"]
  end

  subgraph out["dist/ artifacts"]
    EJ["endpoints.json"]
    CJ["capabilities.json"]
    PJ["providers.json"]
    IJ["index.json"]
  end

  PS --> OP
  X4 --> OP
  MS --> OP
  MC --> OP
  OA --> OP
  OP --> AL --> ID --> DD

  YAML --> MM
  DD --> MM
  MM --> MAT --> SE --> SP
  SP --> EXP --> LINK

  DD --> EJ
  LINK --> CJ
  DD --> PJ
  EJ --> IJ
  CJ --> IJ
  PJ --> IJ
```

**Key design choices**

- **Origin-centric IDs** — `sha256(origin|method|path)`; no vendor-specific ID logic.
- **Ingest, don't own** — pull from pay-skills, x402scan, mppscan, mpp.dev; publish neutral `dist/`.
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
    VEC["Vector nearest-neighbors<br/>47 curated intents"]
  end

  subgraph fusion["Hybrid fusion (search-hybrid.ts)"]
    RRF["Reciprocal Rank Fusion<br/>keyword×2 + vector×1"]
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

Capability hits carry a `capability_id`; resolve expands `satisfies[]` into concrete endpoints ranked by neutral quality signals.

---

## Ontology → endpoint wiring

Curated intents are provider-agnostic task definitions. At build time, matchers find candidate endpoints; neutral scoring picks the best `satisfies` refs.

```mermaid
flowchart LR
  subgraph intent["Curated intent (YAML)"]
    ID2["id: shop.compare_price"]
    LB["label + aliases"]
    REL["related intents"]
  end

  subgraph match["intent-match.ts"]
    M["Per-intent matcher<br/>path/summary/corpus rules"]
    C["Candidate endpoints<br/>from full index"]
  end

  subgraph rank["score-endpoint.ts"]
    N["Neutral quality score<br/>no vendor bias"]
    TOP["Top N satisfies refs"]
  end

  subgraph wire["Index wiring"]
    SAT["satisfies[]<br/>origin + method + path"]
    REV["endpoint.capabilities[]<br/>reverse link"]
  end

  ID2 --> M
  LB --> M
  C --> M
  M --> N --> TOP --> SAT
  SAT --> REV
  REL -.->|"fallback if primary fails"| M
```

**Resolve path** (`capindex resolve --intent <id>`):

1. Load intent from `capabilities.json`.
2. Map each `satisfies` ref to an endpoint via `sha256(origin|method|path)`.
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
    RES["resolve accuracy<br/>47/47 intents"]
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
src/                   Indexer, CLI, search, embed, eval (TypeScript)
dist/                  Built artifacts (endpoints, capabilities, index)
eval/                  Benchmark query sets
```

See [spec/traversal.md](spec/traversal.md) for the agent protocol and [README.md](README.md) for CLI usage and benchmark results.