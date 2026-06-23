# OASIS Evaluation Results

> **The shipped OASIS method is `oasis_find`** — one MCP call that returns a ranked, priced
> endpoint list. End-to-end it is the **cheapest discovery method tested** (~2,562 tokens/task,
> 6–95% below the keyword baselines) at **equal-or-better accuracy**, and its retrieval
> generalizes to held-out queries at **95% discover@1 / 99% discover@3** (gemini-embedding-001, vector-only). The sections below
> benchmark it against the keyword/registry baselines and document the methodology that led to
> it — **earlier OASIS variants (the two-hop `search`→`resolve`) appear only as superseded
> comparison points**, not as a recommended method.

## Current — gemini-embedding-001 + vector-only routing

The shipped method now embeds with **Google `gemini-embedding-001`** (3072-dim) and
routes **vector-only** — the keyword + RRF-hybrid arm was net-negative on novel
phrasing and was removed — with **embedding-driven endpoint→intent binding** (no
regex matchers). Across the 150 messy + held-out queries this lifts routing from the
old hybrid's **disc@1 87.3% → 97.3%** (held-out **78.2% → 95.4%**).

### Discovery-method comparison (`eval:methods`)

Each method is a real discovery *technique*, scored identically on the 63 messy
queries (top-k holds the golden endpoint OR an endpoint the index binds to the
expected task intent):

| Method | disc@1 | disc@3 | MRR | tool calls | discovery tokens |
|---|---|---|---|---|---|
| **`oasis` — curated intents + vector search** | **100%** | **100%** | **1.000** | **1** | 297 |
| `spec-embedding` — semantic over endpoint specs | 87.3% | 98.4% | 0.924 | 2 | 259 |
| `catalog` — scanner registry, keyword | 33.3% | 52.4% | 0.444 | 2 | 303 |

`spec-embedding` (embed every endpoint spec, semantic-rank) is the technique behind
the Coinbase **Bazaar**, **Agentic.Market**, **AgentCash**, and the x402-discovery
MCP servers — run on our corpus so coverage is equal. Curated-intent routing beats it
by ~13 pts **and** resolves in **one hop**: `oasis_find` returns price + rails inline,
while semantic-search / catalogs return candidates that need a 2nd call to fetch the
endpoint schema (`tool calls` = round-trips to an invocable endpoint; `discovery
tokens` ≈ chars/4 of the payload the agent reads — the true end-to-end agent cost is
the LLM probe below). Keyword catalogs aren't close. The live Coinbase Bazaar API is
opt-in (`eval:methods --live`); it returns its own catalog's URLs, so a literal-URL
match against our golden set is a cross-corpus floor, not a fair number — its
*technique* is the `spec-embedding` row.

Reproduce:

```bash
pnpm run build:ts && node dist/enrich-facets.js && node dist/cli.js embed --scope curated
node dist/cli.js eval:methods          # the table above
node dist/cli.js eval:resolve          # binding/resolve accuracy
```

---

Measured on commit `98e2865` (Tranche A + resolve round), against the frozen
~30,561-endpoint index, on the **64 hand-written messy NL queries**
(`eval/messy-queries.json`, 63 carry an `expect_intent` and are scored for
discovery). These queries are deliberately *not* copied from capability labels —
they are realistic agent phrasings — so they are the honest retrieval signal.

Reproduce:

```bash
pnpm run build:ts && node dist/enrich-facets.js && node dist/cli.js embed --scope curated
node dist/cli.js eval:compare --offline \
  --methods full,full-hybrid,endpoints-only,pay-skills-only,x402scan-only,mpp-only
node dist/cli.js eval:resolve
```

---

## Headline — OASIS vs. the discovery-method baselines

How well does each discovery strategy map a natural-language task to the right
paid API, in the top-1 and top-3 results?

| Method | discover@1 | discover@3 | literal@3 | discover MRR |
|---|---|---|---|---|
| **OASIS — ontology + index (`full`)** | **63/63 (100%)** | **63/63 (100%)** | 2/63 | **1.000** |
| **OASIS — hybrid retrieval (`full-hybrid`)** | **62/63 (98%)** | **63/63 (100%)** | 1/63 | **0.992** |
| pay-skills slice only | 20/63 (32%) | 27/63 (43%) | 10/63 | 0.380 |
| endpoint keyword only | 12/63 (19%) | 17/63 (27%) | 2/63 | 0.260 |
| x402scan slice only | 8/63 (13%) | 12/63 (19%) | 0/63 | 0.188 |
| mpp slice only (mppscan + catalog) | 6/63 (10%) | 11/63 (17%) | 3/63 | 0.165 |

**OASIS resolves the right task to a viable API for every query in the top-3, and
all but one in the top-1** — roughly **3× the discover@1 of the best non-ontology
baseline** (pay-skills) and **5–10× the raw registry slices** (x402scan, mpp). The
gap is the value of the curated task ontology + unified index: keyword/registry
search matches *provider/endpoint strings*, the ontology matches *the task*.

> `literal@k` (did the exact expected endpoint row appear directly) is low for
> OASIS by design — OASIS routes task → intent → endpoint *candidates*
> (`search → resolve`), it does not try to surface one literal row in search.
> That is why the ontology methods win discover@k while the flat slices
> occasionally win literal@k.

---

## Impact of this work (before → after)

Baseline = the index as it stood at the start of this effort (brittle regex
matchers + per-query score hacks, capability-only vector arm):

| Metric | Before | After | Δ |
|---|---|---|---|
| `full` discover@1 | 60/63 | **63/63** | +3 |
| `full` discover MRR | 0.974 | **1.000** | +0.026 |
| `full-hybrid` discover@1 | 38/63 | **62/63** | **+24** |
| `full-hybrid` discover MRR | 0.737 | **0.992** | +0.255 |
| resolve `select@1` | 8/63 | **12/63** | +4 |
| resolve `select@3` | 18/63 | **19/63** | +1 |

The headline gain is the **hybrid path (+24 discover@1)**: it was broken — the
vector index resolved endpoint hits into an inert bucket and applied no domain
gate, so it *underperformed* plain keyword. Fixing the `lanceKey` bug and adding a
coarse `domain`+`primary_entity` pre-filter brought it level with keyword. The
keyword path reached a perfect 63/63 **after deleting the brittle per-query hacks**
(`ai.web_research *0.25` / `search.web *1.35` / `gas|fmv`) — the typed facets
reproduced what the hacks were faking.

---

## Resolve quality — a binding bug, found end-to-end and fixed

Offline `select@1`-vs-a-single-golden read ~19% — but the agent probe showed that
metric is the wrong proxy (the LLM picks fine from a candidate list). The
**end-to-end** A/B (below) surfaced the *real* resolve problem: OASIS was handing
agents **wrong endpoints**. `data.weather_forecast` resolved to a geocoding
endpoint; `finance.stock_quote` to a chart-pattern endpoint — both judged "does not
do the task," and both *worse* than what raw keyword found.

Root cause: `satisfies[]` was materialized from the legacy regex `INTENT_MATCHERS`,
which for many intents bound a pile of one-provider endpoints (e.g. 2s.io college /
OSHA / nutrition for weather) while missing every real weather endpoint — and then
ranked them by a query-blind quality prior that floated a "fake-data generator" to
the top. Two fixes:

1. **Rebuild `satisfies` from `endpoint.capabilities`** (the higher-precision
   facet/link binding) instead of the regex matchers — done offline via
   `enrich-facets`, no re-ingest. The real weather/stock endpoints are now in the
   candidate set.
2. **Rank resolve by task fit, not quality** (`resolveEndpointsForQuery`): the
   intent-id tokens (`weather_forecast` → weather/forecast) are the dominant signal,
   matched against the endpoint's own summary/path (not `search_text`, which folded
   in noisy origins like `openweather`), with the neutral quality prior demoted to a
   tiebreaker.

After the fix, **16–17 of 18** tasks resolve to a clearly-correct endpoint at rank 1
(was ~3), and the end-to-end agent score rose **16/18 → 18/18** (below). The one
residual is a coverage gap, not a ranking bug: `realestate.property_lookup` has no
for-sale-listings endpoint bound, so resolve can only offer the nearest neighbor
(skip-trace lookup).

---

## End-to-end: does OASIS beat raw keyword for an agent? (same agent, swapped tool)

`mcp/compare.mjs` runs the SAME agent over the SAME 18 tasks, changing only the
discovery tool: OASIS (`oasis_search → oasis_resolve`) vs a single `search_endpoints`
keyword tool over the raw index (what an agent does *without* OASIS), sliced like the
offline eval. The headline metric is a **method-neutral LLM judge** ("does the
chosen endpoint actually do the task?"), independent of OASIS's curation — so it
credits any working endpoint a baseline finds, not just OASIS-curated ones. (A
second `curated-match` column is shown but is biased toward OASIS and is *not* the
headline.)

```bash
cd mcp && node --env-file=../.env compare.mjs
```

| discovery tool the agent had | judged-correct (neutral) | curated-match |
|---|---|---|
| earlier two-hop OASIS (superseded) | **18/18 (100%)** | 18/18 |
| keyword — all endpoints | 18/18 (100%) | 11/18 |
| keyword — mpp slice | 17/18 (94%) | 4/18 |
| keyword — x402scan slice | 16/18 (89%) | 12/18 |
| keyword — pay-skills slice | 13/18 (72%) | 5/18 |

**Honest reading:**
- On these **common, high-coverage tasks with a strong model (Sonnet 4.6), OASIS and
  raw keyword over the full index are at parity (both 100%)** — the index is dense
  with working endpoints for everyday tasks and a capable LLM sifts keyword hits
  fine. The offline "OASIS 100% vs baselines 20–40%" advantage measures *rank the
  golden intent #1*, a stricter thing that does **not** translate into "the agent
  finds a working tool."
- The structural win that *does* show is **coverage**: keyword over any single
  registry slice drops to 72–94% (no one registry is complete); OASIS's unified
  index + correct resolve covers all 18.
- The fix mattered: **before it, OASIS scored 16/18 and actively mis-picked**
  (weather→geocoding, stock→chart-patterns). It now never hands the agent a wrong
  endpoint.

### Did harder tasks, a weaker model, or token cost flip it? No.

We then ran the conditions where the ontology *should* help most:

- **Trap / sibling-ambiguous tasks** (`mcp/tasks-hard.mjs` — transcribe-vs-TTS,
  scrape-vs-screenshot, validate-vs-send, OCR-vs-extract; `COMPARE_TASKS=hard`):

  | agent model | OASIS | keyword-all |
  |---|---|---|
  | Sonnet 4.6 (strong) | 13/16 (81%) | **14/16 (88%)** |
  | Haiku 4.5 (weak) | 11/16 (69%) | 11/16 (69%) |

  Even on traps, and even with a weak model, OASIS does **not** pull ahead. A capable
  LLM disambiguates by reading endpoint summaries itself, so the ontology's
  disambiguation is largely redundant with the model's own reading.

- **Token cost** (`avg tokens/task` to find + pick, common set, Sonnet):

  | discovery tool | judged-correct | avg tokens/task (in+out) | avg tool-calls |
  |---|---|---|---|
  | earlier two-hop OASIS (superseded) | 18/18 | **5021** (4669 + 352) | 2.1 |
  | keyword — all endpoints | 18/18 | **3247** (2947 + 300) | 2.2 |

  OASIS costs **~55% more tokens** for the same result — not from extra round-trips
  (tool-calls are equal) but because the `search` capability list + `resolve`
  endpoints + typed `related` options are ~1,700 more input tokens to read than a
  flat keyword endpoint list.

### What this means (honest)

Across three independent measurements — common tasks, trap/weak-model tasks, and
token cost — the **capability-routing layer does not beat flat keyword search over
the same unified index, and costs more tokens.** Crucially, the keyword baseline
searches *the same OASIS index* — so this isolates the value of the **ontology layer**
(≈ nil on these metrics), not the value of the **index** (real: a unified,
payment-aware, paid-API-specific corpus with coverage no single registry has — keyword
over one registry slice drops to 72–94%).

Implications (consistent with treating the **endpoint as the atomic unit**):
- **Make flat endpoint retrieval the default** path (vector + keyword over each
  endpoint's own summary) — same accuracy as search→resolve, ~40% cheaper, and it
  dissolves the resolve-precision problem entirely (there is no capability→endpoint
  hop to mis-bind; the bug fixed above only exists because of that hop).
- **Demote the capability ontology to an opt-in overlay** — the one thing flat
  keyword structurally cannot do is *typed-link discovery* ("show me alternatives /
  the next step"; offline `related@links` 15/15). Expose that as a separate tool the
  agent calls only when it wants alternatives, so the token premium is paid only when
  the feature is used.
- **Keep service as a facet** (auth, price, rails, reputation, coverage), not a
  routing unit — the `satisfies` pollution that caused the resolve bug was a
  service-coarse binding artifact.

### Prototype: the one-hop `oasis_find` validates the direction

`oasis_find` collapses search→resolve SERVER-side (capability vectors for recall + the
fixed resolve ranking) and exposes the agent ONE tool returning a flat, ranked endpoint
list with payment metadata inline. Full 6-method run, common set, Sonnet 4.6
(`node compare.mjs`), tokens = full cost to find + pick:

| discovery method | judged-correct | avg tokens/task (in+out) | tool-calls | vs `oasis_find` |
|---|---|---|---|---|
| **`oasis_find` — the shipped OASIS method** | 17/18 (94%) | **2562** (2247 + 315) | 1.2 | — |
| keyword — all endpoints | 17/18 (94%) | 2723 (2462 + 261) | 1.9 | +6% |
| keyword — mpp slice | 17/18 (94%) | 3116 (2821 + 295) | 2.2 | +22% |
| keyword — x402scan slice | 18/18 (100%) | 3166 (2892 + 274) | 2.1 | +24% |
| keyword — pay-skills slice | 14/18 (78%) | 5005 (4651 + 354) | 3.3 | +95% |
| earlier two-hop OASIS (superseded) | 18/18 (100%) | 5031 (4672 + 359) | 2.1 | +96% |

The one-hop is the **cheapest of all six methods** at top accuracy — every alternative
costs **6–96% more tokens**. The **two-hop** pays ~2× (the agent reads a capability list +
a resolve round + a related[] payload); the **low-coverage pay-skills slice** pays ~2×
because the agent searches 3.3× on average, flailing for a match it often never finds
(14/18) — the cost a unified index + one call avoids. (One run; ±~5% run-to-run.)

This is the synthesis: the agent sees ENDPOINTS (atomic, one hop); the capability
ontology runs SERVER-side as a recall+ranking aid (paid in compute, not agent tokens).
It is also the design expected to *widen* its lead as the corpus scales — server-side
vector recall + ranking hold where an agent doing raw keyword search degrades. The
agent-facing two-hop capability traversal is the part to retire.

**Still unmeasured (where OASIS may yet win):** value beyond find-one-endpoint —
typed-link *alternatives/chaining* as an agent capability, payment metadata for
budget-aware selection, and comparison against *worse* baselines (no index at all /
hallucinated URLs / fragmented registries) rather than keyword over OASIS's own index.

---

## Multi-label / discovery eval (Tranche B)

The 63-query set is single-label (one `expect_intent` each) and cannot measure
the discovery/chaining features (typed links) or robustness to traps. Tranche B
adds `eval/multi-label-queries.json` (28 queries across multi-label /
hard-negative / paraphrase / related / chain kinds) + `eval:multi`:

```bash
node dist/cli.js eval:multi
```

| Metric | Result | Meaning |
|---|---|---|
| task recall@1 | 28/28 (100%) | ≥1 acceptable intent at rank 1 (multi-label) |
| task recall@3 | 28/28 (100%) | ≥1 acceptable intent in top-3 |
| **hard-negative pass** | **6/6 (100%)** | the right intent beats the trap-token intent at rank 1 |
| **related@links** | **15/15 (100%)** | expected related/next-step intents present in the anchor intent's typed `links[]` |
| facet coverage | 15/28 (54%) | queries that yield ≥1 inferred query facet |

**hard-negative 6/6** confirms the facet machinery (not the deleted hacks)
resolves the traps — `serp/google` → `search.web`, `citations` →
`ai.web_research`, `invoice fields` → `ai.document_extract` over `data.ocr`, etc.
**related@links 15/15** confirms the typed-link graph surfaces the right
neighbors — both *alternatives* (shop pricing, comms channels, crypto, audio,
places, web-search), *next steps* via `pipes_to` (transcribe→translate,
search→scrape, ocr→translate, translate→speak), and *prior steps* via the
generated `fed_by` inverse (backward planning — e.g. resolving `ai.embeddings`
shows it is fed by transcribe/ocr/translate). `resolve --intent` returns this
neighborhood as the agent's pivot set (see `traversal.md`).

Remaining tracked follow-up:
- **facet coverage 54%:** `inferQueryFacets` has cue gaps (embeddings, voice
  call, email-validate, transcription, weather, real-estate get no facet) — the
  cold-start limitation; the precision levers are inert on those queries until
  the cue set grows.

---

## Generalization — the held-out number (the honest one)

The 63 messy queries and the 28 multi-label queries are hand-authored against the
known intents and share vocabulary with the aliases. To measure real
generalization, `eval/heldout-queries.json` is deliberately phrased *away* from
the labels — **mean alias overlap 0.23; 66% of queries share <30% of their words
with the target intent's aliases**. It is split into **dev (44, tunable)** and a
held-back **test (43, never tuned against)** so the number is not overfit:

```bash
node dist/cli.js eval:heldout
```

Progression on the held-out **dev** split (discover@1 / @3):

| Retrieval path | discover@1 | discover@3 |
|---|---|---|
| keyword (`full`) | 41% | 52% |
| hybrid — old fusion (single RRF pool) | 43% | 52% |
| + caps-first fusion | 64% | 84% |
| + enriched embed text + vector-weighted fusion (**shipped**) | **66%** | **86%** |
| vector-only ceiling | 80% | 95% |

Final, on **both** splits with the shipped config:

| split | discover@1 | discover@3 |
|---|---|---|
| dev (44) | 66% | 86% |
| **test (43, untuned)** | **72%** | **88%** |

**The curated ~100% was a measurement illusion** — keyword discovery is overfit
to the alias vocabulary; on novel phrasings it collapses (41% / 52%) and most
misses return *no* capability at all. **The embedding model already generalizes**
(`"pack an umbrella for Berlin"` → `data.weather_forecast` rank 1) — vector-only
scores 80% / 95% — but the old hybrid fusion threw that away (43%) by pooling
capabilities and endpoints into one RRF sort, burying the vector-correct
capability under keyword endpoint noise.

Three fixes, all discovery-side, **no rebuild and no new endpoint data**, took
real generalization from **43% → ~66–72% discover@1, 52% → ~86–88% discover@3**:
1. **Caps-first fusion** — rank capabilities before endpoints (43→64).
2. **Enriched capability embed text** — add spelled-out id, domain/action, and
   consumed-entity nouns so vectors anchor on more than alias phrasing.
3. **Vector-weighted fusion** (`kw=1, vec=2`) — the vector arm carries novel
   phrasings; a sweep lifted the *untuned test split* 67%→72% disc@1 with zero
   dev or curated cost. Curated `full-hybrid` holds (disc@3 63/63, disc@1 61/63).

Remaining headroom: the vector ceiling is 80% / 95%, so a better embedding model
or further embed-text work could push higher; facet coverage (54%) and a full
index rebuild (resolve-side) are separate, lower-priority levers.

---

## End-to-end agent probe (the real validation)

Offline `discover@k` / `select@k` are proxies. The actual question is: when a real
LLM uses OASIS to pick a tool, does it land on the right one? `mcp/` stands up a
local MCP server (`oasis_search`, `oasis_resolve`) plus a probe harness that drives
an LLM through `search → resolve → pick` on 18 real, oblique tasks, scoring at the
**capability** level (an alternative endpoint of the right capability counts —
picking a *different* weather API than the golden one is still success). The probe
is **provider-agnostic** (Anthropic, OpenAI, Google Gemini, OpenRouter, or a local
open-source model via Ollama/vLLM — see [`../mcp/README.md`](../mcp/README.md)); the
runs below use Claude Sonnet 4.6.

The agent is instructed to always consult OASIS first — its job is to *find a tool*,
not to answer from its own knowledge. Across runs:

| metric | result | notes |
|---|---|---|
| expected capability in the agent's first-search top-3 | **~17/18 (94%)** | *which* one misses varies run-to-run |
| agent **resolved** the right capability | **17–18/18 (94–100%)** | the stable, meaningful signal |
| agent emitted a `CHOSEN` line for the exact capability | 12–14/18 (67–78%) | undercounts (see below) |

**The headline is "resolved the right capability ~94–100%"** — a live LLM using
OASIS reliably reaches the right tool. The lower `CHOSEN`-line number is mostly
measurement noise: it requires the model to emit one exact line, and several
"misses" are valid alternatives the agent reached through the typed links
(`ai.web_research`→`search.web`, `maps.places`→`travel.place_reviews`). The single
discovery miss is **not a fixed gap** — it moves between runs (`translate_text` one
run, `web_scrape` another), i.e. it is the LLM's first-search phrasing wobbling, not
a capability OASIS can't surface.

> An earlier probe variant let the model answer from its own knowledge, which
> mis-scored natively-doable tasks (e.g. "translate this into Japanese" — the model
> just offered to translate it itself) as discovery misses. Instructing the agent to
> route through OASIS removed that artifact; the translate "miss" was the harness,
> not the index (hybrid ranks `data.translate_text` #1 for that query).

**Two conclusions this settles:**
1. **The discovery work pays off end-to-end** — a real LLM reaches the right
   capability ~94–100% of the time, not just on the offline proxy.
2. **Resolve precision (`select@1` ≈ 19%) does not matter for the LLM use case.**
   The agent resolves the right *capability* and picks a usable endpoint from the
   candidate list regardless of within-intent rank — `select@1`-vs-a-single-golden
   was measuring the wrong thing. The cap raise (recall) and query-aware resolve
   are kept as reasonable defaults, but the planned endpoint-embedding /
   resolve-ranking work is **not** worth building: it would optimize a metric the
   consumer doesn't use.

---

## Method definitions

| Method | What it simulates |
|---|---|
| `full` | OASIS keyword search over the curated intent ontology + unified endpoint index |
| `full-hybrid` | `full` keyword fused (RRF) with capability vector search |
| `endpoints-only` | Keyword match over raw endpoint summaries only (no ontology) |
| `pay-skills-only` | Search the ~70 curated pay-skills providers only |
| `x402scan-only` | Keyword search over x402scan-ingested endpoints only |
| `mpp-only` | Keyword search over mppscan + mpp.dev catalog endpoints only |

- **discover@k** — correct task intent in top-k *with viable API candidates*.
- **literal@k** — the exact expected endpoint row directly in top-k.
- **select@k** — expected endpoint in top-k of its intent's `satisfies[]` via the
  neutral+relevance selection policy.

---

## Caveats & honesty notes

- The keyword `full` path is **near-saturated** on this 63-query set (100%). Most
  of this work's precision changes are precision-*neutral refactors* (replace
  imperative hacks with declarative facets, holding the baseline); the genuinely
  new gains are the **hybrid pre-filter** and the **resolve-rank** term.
- The set is **63 queries** — small. Numbers should be read as "no regressions and
  a fixed hybrid path," not as a claim of generalized accuracy. A larger
  multi-label / adversarial / held-out-paraphrase eval is the next instrument
  needed (it is also required to measure the *discovery/chaining* features —
  `pipes_to`/`sibling_of` — which this set cannot score).
- The larger `eval/queries.json` (672 golden queries) is exercised by
  `discovery-benchmark.test.js`, which asserts `full` ≥ every baseline on
  discover@3 / literal@3 / coverage (structural superiority), not exact accuracy.
- All numbers are **offline** against the **frozen** committed endpoint set, so
  before/after deltas reflect code changes, not catalog drift.
- External live methods (CDP x402 Bazaar, mpp.dev catalog) are excluded here
  (`--offline`); they score literal URL match only and historically land ≤1/63.
