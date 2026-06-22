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
