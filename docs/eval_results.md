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

## Benchmarked against the leading discovery layers (dogfooding)

The comparisons elsewhere in this doc are *internal* — OASIS's own discovery techniques on our
corpus. This section is the **external** check: the same `oasis_find` on a battery of real colloquial
tasks, with the two largest live x402 discovery layers run on the identical battery so the numbers
aren't measured in a vacuum.

**Engines.** OASIS (`oasis_find`); a **vector-search baseline** (`search` — vector similarity + live usage
telemetry); **Coinbase x402 Bazaar** (HTTP `/discovery/search` over a ~25,000-resource catalog).

**Battery.** 40 natural-language tasks across ~20 capability domains, phrased the way a person
talks to an agent ("what's bitcoin going for right now?", "register the domain mycoolstartup.xyz
for me"). Each engine returns its **top 8** endpoints. Every returned endpoint is hand-labeled
**relevant** only if it *directly performs the task* — a reverse-geocoder for a forward-geocode
task scores 0; crypto perpetuals for a spot-price task score 0. Providers are de-duplicated by
**unique hostname** (one host listing six endpoints counts once).

**Results — every metric spelled out:**

| Metric (what it measures) | **OASIS** | Vector baseline | Bazaar |
|---|---|---|---|
| **Precision** — of the 8 results returned, the share that *directly do the task* (not merely adjacent). Higher = less noise. | **71%** | 62% | 54% |
| **Distinct providers / task** — unique hosts returned, useful or not. Measures diversity (vs returning the same host repeated). | **7.8** | 4.4 | 2.8 |
| **Useful options / task** — distinct hosts that *directly do the task*. The headline "how many useful, different APIs did the agent actually get" number. | **5.6** | 3.0 | 1.6 |
| **Complete misses** — tasks (of 40) where *none* of the 8 results was usable. Lower = more reliable. | **1** | 1 | 11 |
| **Response size / task** — tokens (≈ response bytes ÷ 4) the engine returns. | ~545 | ~5,447 | ~2,132 |
| **Cost per useful result** — response tokens ÷ useful providers: tokens the agent must read to get *one* genuinely useful API. Lower = cheaper. | **97** | 1,831 | 1,292 |

Across the battery OASIS returned the most useful options per task and the lowest cost per useful
result of the three — a tight, pre-ranked, de-duplicated list.

**What each metric looks like in the run** (examples from the v6 per-task appendix):

- **Precision** — for the receipt-OCR task ("pull the text out of this photo of a receipt"), all 8
  returned endpoints were real OCR/receipt services (`api.strale.io`, `apibase.pro`, `ai.verifik.co`,
  `visionex.x402tools.xyz`, `archtools.dev`, …) → 8/8 on that task; 71% is the 40-task average.
- **Distinct providers / task** — de-duplicated by hostname: a provider that lists several endpoints
  on one host counts once, so multi-path spam on a single host can't inflate the count.
- **Useful options / task** — for "how much is 500 US dollars in euros?", the relevant set was 7
  distinct currency-convert hosts (`2s.io`, `x402stock.vercel.app`, `apibase.pro`,
  `remit-compare.up.railway.app`, `api.strale.io`, …), each directly performing the conversion.
- **Complete misses** — scoring is strict, so a "miss" means truly nothing on-target came back: a
  Seoul-only forecast returned for "what's the weather in Tokyo this weekend?" scores 0 (wrong city),
  and a reverse-geocoder for "map coordinates for 1600 Pennsylvania Avenue" scores 0 (inverse
  operation, not forward geocoding).
- **Cost per useful result** — OASIS's ~545-token response carrying ~5.6 useful providers works out
  to ~97 tokens per useful provider.

**Trajectory** (OASIS on the same 40-task battery, across successive deploys — the gains are
OASIS-side; the two controls stayed flat):

| OASIS build | Precision | Useful options / task | Complete misses |
|---|---|---|---|
| early (pre-tuning) | 28% | 1.7 | 7 / 40 |
| + concentrate & host-diversify the routed result | 65% | 5.2 | 3 / 40 |
| + direct endpoint-embedding fallback for intent-layer misses | **71%** | **5.6** | **1 / 40** |

The last remaining miss in this run (registering a *new* domain) has since been closed by a deployed
confidence-gate change — the registrar endpoints were already indexed; the gate now surfaces them —
so the live engine sits at 0 complete misses (a follow-up run will confirm it on the full battery).

**Caveats.** A single consistent human judge scores all three engines per task, so the
*comparison* is fair even where an absolute label is subjective. The three catalogs are **~90%
disjoint** — they mostly index *different* providers, so "query two layers and merge" is still the
most complete strategy. OASIS's edge is surfacing more of the *right* endpoints per task, more
cleanly, for far fewer tokens — not omniscience.

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
*raw* endpoint specs (noisy, vendor-written) and matches query→endpoint; `oasis` embeds the 56
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
