# OASIS Evaluation Results

The shipped method, **`oasis_find`** — one MCP call that returns a ranked, priced endpoint
list — is the **cheapest discovery method tested** (~2,354 tokens/task, fewest round-trips) at
**equal-or-better accuracy**, and it generalizes to held-out queries at **95% discover@1 / 99%
discover@3**.

Measured against the frozen **~30,561-endpoint index (1,101 services)**, on the hand-written
**messy** (`eval/messy-queries.json`) and **held-out** (`eval/heldout-queries.json`) NL query
sets — realistic agent phrasings, deliberately *not* copied from capability labels, so they are
the honest retrieval signal.

Routing embeds with **`gemini-embedding-001`** and is **vector-only** (the keyword + RRF-hybrid
arm was net-negative on novel phrasing and was removed), with **embedding-driven endpoint→intent
binding** (no regex matchers). This lifted routing from the old hybrid's **disc@1 87.3% → 97.3%**
overall (held-out **78.2% → 95.4%**) on the 150 messy + held-out queries.

## Discovery-method comparison

Each method is a real discovery *technique*, scored identically on the 63 messy queries (top-k
holds the golden endpoint OR an endpoint the index binds to the expected task intent — i.e.
"found a task-appropriate API," not "guessed the one label"):

| Method | disc@1 | disc@3 | MRR | tool calls | discovery tokens |
|---|---|---|---|---|---|
| **`oasis` — curated intents + vector search** | **100%** | **100%** | **1.000** | **1** | 297 |
| `spec-embedding` — semantic over raw endpoint specs | 87.3% | 98.4% | 0.924 | 2 | 259 |
| `catalog` — scanner registry, keyword | 33.3% | 52.4% | 0.444 | 2 | 303 |

`spec-embedding` (embed every endpoint spec, semantic-rank) is the technique third-party semantic
registries / discovery MCP servers use — run on our corpus so coverage is equal. Curated-intent
routing beats it by ~13 pts **and** resolves in **one hop** (`oasis_find` returns price + rails
inline; semantic-search / catalogs return bare candidates that need a 2nd call to fetch the
schema). `discovery tokens` ≈ chars/4 of the first-response payload — the true end-to-end cost is
the agent probe below. A live external registry API is opt-in (`eval:methods --live`); it returns
its own catalog's URLs, so a literal-URL match against our golden set is a cross-corpus floor, not
a fair number — its *technique* is the `spec-embedding` row.

## End-to-end agent A/B — real tokens + tool-calls

Driving a real agent (Sonnet 4.6) through each discovery tool on 18 common tasks, scored by a
method-neutral LLM judge ("does the chosen endpoint do the task?"):

| Method | judged correct | tokens/task (in+out) | tool-calls |
|---|---|---|---|
| **`oasis` (1-hop find)** | 16/18 (89%) | **2,354** (2052+302) | **1.1** |
| `spec-embedding` (semantic) | 17/18 (94%) | 2,715 (2444+271) | 1.9 |
| `catalog` (single-registry keyword) | 18/18 (100%) | 3,358 (3036+322) | 2.2 |

**OASIS is the cheapest — ~30% fewer tokens and half the round-trips.** Accuracy is near-parity
here (89–100%): these are common, high-coverage tasks and the judge credits *any* working
endpoint, so broad keyword search over 30k endpoints finds one for all 18. OASIS's accuracy edge
shows on the harder retrieval set above (100% vs 87% vs 33%) and on held-out generalization.

**`oasis` and `spec-embedding` do not share an embedding base.** `spec-embedding` embeds the 30k
*raw* endpoint specs (noisy, vendor-written) and matches query→endpoint; `oasis` embeds the 47
*curated* intents (clean, query-shaped) and matches query→intent→resolve. The ontology *is* the
embedded layer, not a layer over identical vectors — so the gap is the value of a clean target,
and spec-embedding is capped by raw-spec quality.

## Reproduce

```bash
pnpm run build:ts && node dist/enrich-facets.js          # build + embedding-driven binding (uses cache)
GOOGLE_API_KEY=... node dist/cli.js embed --scope curated  # gemini intent vectors → dist/lance
node dist/cli.js eval:methods                            # offline method comparison (table 1)
node dist/cli.js eval:resolve                            # binding / resolve accuracy
cd mcp && COMPARE_BACKENDS="1-hop,spec,x402scan" \
  node --env-file=../.env compare.mjs                    # end-to-end agent A/B (table 2)
```
