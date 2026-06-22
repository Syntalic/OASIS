# OASIS Evaluation Results

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

## Resolve quality (`select@k`)

Once the right intent is found, does the *best* endpoint sort to the top of its
`satisfies[]`?

- Intents with ≥1 candidate: **47/47**; endpoint refs that resolve to the index: **536/536**.
- **`select@1`: 12/63 (19%)**, **`select@3`: 19/63 (30%)**.

This is the **weakest area and an honest open problem.** Resolve ranking now blends
the neutral quality prior with a per-intent input-identifier/output-entity overlap
term, which lifted `select@1` from 8 → 12, but the ceiling is **data-limited**:
~9 of the expected endpoints have **no `inputs[]`** in the index (an OpenAPI-parse
gap), so the input-overlap signal cannot rank them. Raising `select@k` further
needs richer endpoint input extraction, not more ontology tuning.

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
generalization, `eval/heldout-queries.json` (44 queries) is deliberately phrased
*away* from the labels — **mean alias overlap 0.23; 66% of queries share <30% of
their words with the target intent's aliases**:

```bash
node dist/cli.js eval:heldout
```

| Retrieval path (44 held-out queries) | discover@1 | discover@3 |
|---|---|---|
| keyword (`full`) | 18/44 (41%) | 23/44 (52%) |
| hybrid — old fusion (single RRF pool) | 19/44 (43%) | 23/44 (52%) |
| vector-only (capability embeddings) | 34/44 (77%) | 40/44 (91%) |
| **hybrid — caps-first fusion (shipped)** | **28/44 (64%)** | **37/44 (84%)** |

**The curated ~100% was a measurement illusion** — keyword discovery is overfit
to the alias vocabulary, and on novel phrasings it collapses (most misses return
*no* capability at all, because the query shares no alias tokens).

**But the embedding model already generalizes** (`"pack an umbrella for Berlin"`
→ `data.weather_forecast` rank 1; `"boil this contract down"` →
`ai.llm_complete` rank 2) — vector-only scores **77% / 91%**. The old hybrid
fusion *destroyed* that signal: it pooled capabilities and endpoints into one RRF
sort, so with keyword weight 2× and endpoints dominating by count, a correct
capability that only the vector arm found was buried below keyword endpoint noise
(43% < 77%).

**Fix (shipped):** the fusion now ranks **capabilities first, endpoints after**
(the traversal protocol prefers capability matches anyway). Held-out hybrid
**43%→64% discover@1, 52%→84% discover@3** — ~+30 points on novel queries, no
rebuild and no new data. Curated `full-hybrid` holds (disc@3 63/63; disc@1 61/63
= 97%).

Remaining headroom, now correctly prioritized:
1. **Close the gap to vector-only (64% → 77%)** — on some novel queries the
   keyword arm still ranks a wrong capability above the vector-correct one;
   rebalancing the vector weight (eval-gated on a larger held-out set to avoid
   overfitting) should help.
2. **Facet coverage + richer capability embed text** (description + use-cases) to
   push vector recall past 91%.
3. **Full index rebuild** remains a resolve-side (endpoint-precision) concern,
   separate from this discovery finding.

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
