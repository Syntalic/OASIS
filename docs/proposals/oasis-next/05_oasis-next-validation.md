# OASIS Next — Validation Spec

> **Parent:** [00_oasis-next-blueprint.md](./00_oasis-next-blueprint.md) · **Component:** E (Validation)
>
> **Depends on:** A (entity model) for E1/E3; C (tool) for E2
>
> **Status:** draft

---

## 0. Purpose

Three validation tracks that gate the redesign:

| ID | Name | When | Gates |
|----|------|------|-------|
| **E1** | Bridge validation | After **A3**, on the built index, before B | Entity granularity is right |
| **E2** | Usefulness eval | After C | Follow-ups beat a **catalog-aware** agent (`oasis_find` + catalog) |
| **E3** | `oasis_find` regression | After A3 | Entity enrichment doesn't hurt find |

E1 is the cheap early gate. If the expected bridges don't appear on the built, re-typed index, re-granularize A before building the engine ([00 §2a](./00_oasis-next-blueprint.md) Phase 1b).

---

## 1. E1 — Bridge validation

### 1.1 What it tests

Given a set of **held entities**, does the built consume/produce graph surface the expected cross-domain capabilities?

This runs over the **built** `dist/entity-index.json` (after A3 re-typing), using the shared `entity-match.ts` primitive — no full engine required, but not a parallel reimplementation either (§1.3).

### 1.2 Fixture format

New file: `fixtures/bridge-scenarios.json`

```json
{
  "spec_version": "0.1.0",
  "scenarios": [
    {
      "id": "place_la_weather",
      "description": "Agent holds a Place — weather capability should be reachable cross-domain",
      "held_entities": [{ "entity": "Place", "value": "Los Angeles, CA" }],
      "source_domain": "analyst",
      "expect_intents": [
        "data.weather_forecast",
        "data.gov_civic",
        "travel.place_reviews",
        "realestate.property_lookup"
      ],
      "min_hits": 3,
      "must_cross_domain": true
    },
    {
      "id": "company_competitor_enrich",
      "description": "Agent holds Company — enrichment and social intel reachable",
      "held_entities": [{ "entity": "Company", "value": "Acme Corp" }],
      "source_domain": "marketing",
      "expect_intents": [
        "data.company_enrich",
        "media.social_data"
      ],
      "min_hits": 2,
      "must_cross_domain": true
    },
    {
      "id": "product_category_competitive",
      "description": "Agent holds a ProductCategory — competitive + inflation intel reachable cross-domain",
      "held_entities": [{ "entity": "ProductCategory", "value": "consumer electronics" }],
      "source_domain": "shop",
      "expect_intents": ["marketing.competitive_landscape", "analyst.inflation_tracker"],
      "min_hits": 2,
      "must_cross_domain": true
    },
    {
      "id": "person_social_lookup",
      "description": "Agent holds a Person — social + people-search reachable cross-domain",
      "held_entities": [{ "entity": "Person", "value": "Jane Roe" }],
      "source_domain": "comms",
      "expect_intents": ["data.person_search", "media.social_data"],
      "min_hits": 2,
      "must_cross_domain": true
    },
    {
      "id": "domain_whois_dns",
      "description": "Agent holds a Domain — registration + DNS intel reachable cross-domain",
      "held_entities": [{ "entity": "Domain", "value": "acme.com" }],
      "source_domain": "marketing",
      "expect_intents": ["data.whois_lookup", "cloud.domains"],
      "min_hits": 2,
      "must_cross_domain": true
    },
    {
      "id": "crypto_asset_onchain",
      "description": "Agent holds CryptoAsset — DEFERRED to v2 (needs coin→WalletAddress derivation, 01 §4.4); not in the v1 gate set",
      "v1": false,
      "held_entities": [{ "entity": "CryptoAsset", "value": "SOL" }],
      "source_domain": "finance",
      "expect_intents": ["finance.onchain_analytics", "compute.blockchain_rpc"],
      "min_hits": 2,
      "must_cross_domain": true
    },
    {
      "id": "place_forward_geocode",
      "description": "Forward mode — DEFERRED to v2 (00 §0a); not in the v1 gate set",
      "v1": false,
      "held_entities": [{ "entity": "Place", "role": "payload" }],
      "source_intent_id": "maps.places",
      "expect_intents": ["travel.place_reviews"],
      "min_hits": 1,
      "must_cross_domain": false,
      "mode": "forward"
    },
    {
      "id": "query_no_lateral",
      "description": "Query must NOT bridge laterally",
      "held_entities": [{ "entity": "Query" }],
      "source_domain": "search",
      "expect_intents": [],
      "max_lateral": 0
    },
    {
      "id": "observation_no_lateral",
      "description": "Observations forward-chain but do NOT seed lateral investigation",
      "held_entities": [{ "entity": "WeatherReport", "value": "rainy, 58°F, 5-day forecast" }],
      "source_domain": "data",
      "expect_intents": [],
      "max_lateral": 0,
      "mode": "lateral"
    },
    {
      "id": "observation_forward_ok",
      "description": "Forward chaining on an observation — DEFERRED to v2 (00 §0a)",
      "v1": false,
      "held_entities": [{ "entity": "WeatherReport", "role": "payload" }],
      "source_intent_id": "data.weather_forecast",
      "mode": "forward",
      "min_hits": 0
    }
  ]
}
```

### 1.3 Runner

New script: `src/eval/bridge-validation.ts`

```typescript
interface BridgeScenarioResult {
  id: string;
  passed: boolean;
  matched: string[];
  missing: string[];
  unexpected_lateral_on_query: boolean;
}

export function runBridgeValidation(
  capabilities: CapabilityIntent[],
  entityIndex: EntityIndex,
  scenarios: BridgeScenario[],
): { passed: number; failed: number; results: BridgeScenarioResult[] };
```

**De-circularized matching.** E1 imports the **`entityMatches` primitive** from `src/entity-match.ts` ([02 §2.1a](./02_oasis-next-engine.md)) — the same one-hop matcher the engine uses — so it exercises real matching logic, not a paraphrase. But it does **not** import the full traversal (`entity-flow.ts`); the **fixtures are the independent oracle** — a human authored which intents *must* appear for each held entity. A pass therefore means "the built index + matcher genuinely surface the bridges a human says exist," not "the engine agrees with a second copy of itself."

### 1.4 Pass criteria

- **100%** of scenarios pass `min_hits` / `max_lateral` thresholds.
- **0** lateral bridges on `Query` or observation entities.
- Investigative scenarios pass **identity** entities in `held_entities`, not observations alone.
- **≥3** distinct `facet.domain` values appear across Place scenarios' `expect_intents`.

### 1.5 CLI

```bash
pnpm exec capindex eval:bridges       # NEW subcommand (add to src/cli.ts, alongside eval:methods/eval:resolve)
# or: node dist/eval/bridge-validation.js
```

Exit code 1 on any failure — wired into CI after A3 lands. (`eval:bridges`, `eval:usefulness`, and the find regression below are **new** `eval:*` subcommands to implement; they follow the existing `eval:methods` / `eval:resolve` convention — not a new `eval <name>` form.)

---

## 2. E2 — Usefulness eval

### 2.1 What it tests

The honest question from the blueprint: **does `oasis_next` surface useful, callable leads that beat the agent reasoning alone?**

This is a judged eval — automated pre-filter + human or LLM-judge scoring.

### 2.2 Scenario format

New file: `fixtures/investigation-scenarios.json`

```json
{
  "scenarios": [
    {
      "id": "la_sales_investigation",
      "user_query": "Why are LA electronics sales down? Investigate.",
      "steps": [
        {
          "simulate_intent_id": "analyst.inflation_tracker",
          "simulate_finding": "LA consumer electronics sales down 12% YoY",
          "simulate_entities": [
            { "entity": "Place", "value": "Los Angeles, CA", "kind": "identity" },
            { "entity": "ProductCategory", "value": "consumer electronics", "kind": "identity" },
            { "entity": "EconomicIndicator", "value": "−12% YoY", "kind": "observation" }
          ],
          "simulate_entities_for_investigative": [
            { "entity": "Place", "value": "Los Angeles, CA" },
            { "entity": "ProductCategory", "value": "consumer electronics" }
          ]
        }
      ],
      "good_follow_ups": [
        { "intent_id": "data.weather_forecast", "reason": "weather drives foot traffic" },
        { "intent_id": "marketing.competitive_landscape", "reason": "competitive pricing pressure" },
        { "intent_id": "data.gov_civic", "reason": "local policy / civic events" }
      ],
      "bad_follow_ups": [
        { "intent_id": "ai.image_generate", "reason": "not investigatively relevant" },
        { "intent_id": "comms.send_fax", "reason": "not callable from held entities" }
      ]
    }
  ]
}
```

### 2.3 Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| **callable_precision** | % of returned follow-ups where a held identity satisfies the consume port under `entityMatches` ([02 §2.1a](./02_oasis-next-engine.md)) | ≥ 0.95 |
| **lateral_relevance_precision** | % of returned leads judged *relevant* (not merely callable) on a labeled relevant/noise set — **the over-firing gate** ([00 §2a](./00_oasis-next-blueprint.md) Phase 2) | ≥ 0.70 |
| **identity_recall** | % of scenarios where the investigative call used ≥1 identity entity (not observations alone) | 1.0 |
| **good_recall@6** | % of `good_follow_ups` appearing in top-6 investigative | ≥ 0.60 |
| **bad_rate@8** | % of `bad_follow_ups` appearing in top-8 (v1 limit) | ≤ 0.10 |
| **domain_diversity** | distinct domains in top-6 investigative | ≥ 2 (when scenario has cross-domain goods) |
| **usefulness_score** | judge rates 1–5 on "would an agent actually call this?" for top-3 | ≥ 3.5 avg |

### 2.4 Runner

New script: `src/eval/usefulness-eval.ts`

1. For each scenario step, call `suggestFollowUps()` (same path as MCP handler).
2. Compute automated metrics (callable_precision, good_recall, bad_rate, diversity).
3. Optionally call judge model with rubric:

```
Score 1-5: Given the finding and entities, is this follow-up a worthwhile
investigative lead the agent can actually invoke? 5=clearly yes, 1=irrelevant or unc callable.
```

### 2.5 Baseline comparison — must be *catalog-aware*

The honest baseline is **not** a naive LLM guessing API names. It is an agent that already has
**`oasis_find` + the full catalog** and is told to find its own follow-ups — it can search the index
for "weather for a place", "competitor intel", etc. E2 only proves `oasis_next` earns its place if it
beats *that* agent: same catalog, but the baseline has to think of and phrase each follow-up search
itself, while `oasis_next` derives them from the entities already in hand.

| Baseline | Tools | What it isolates |
|----------|-------|------------------|
| `naive` | none (LLM from memory) | sanity floor only — not the gate |
| **`catalog_aware`** | `oasis_find` + catalog | **the real gate** — does deriving-from-entities beat searching-from-scratch? |

E2 passes only if OASIS beats **`catalog_aware`** on `good_recall@6` + `lateral_relevance_precision`.

### 2.6 Pass criteria

- All automated metric targets met (including `lateral_relevance_precision` ≥ 0.70).
- OASIS beats the **`catalog_aware`** baseline: `good_recall@6` ≥ baseline + 0.15 **OR** `lateral_relevance_precision` ≥ baseline + 0.15 at equal-or-better recall.
- If fail: loop to A (re-granularize) or B4 (ranking tuning) before ship.

---

## 3. E3 — `oasis_find` regression

### 3.1 What it tests

Entity model changes (A3) must not regress the shipped `oasis_find` discovery quality. Bonus: resolve ranking may improve when intents are more precisely typed.

### 3.2 Harness

Reuse existing benchmarks:

- `src/eval/discovery-benchmark.ts` — task_hit@1, discover_hit@1 on held-out queries
- `src/eval/resolve-benchmark.ts` — endpoint resolution accuracy
- `mcp/compare.mjs` or probe harness if present

### 3.3 Baseline capture

Before merging A3, snapshot:

```bash
pnpm exec capindex eval:methods --out fixtures/baselines/find-pre-a3.json   # existing benchmark
```

After A3:

```bash
pnpm exec capindex eval:methods --out fixtures/baselines/find-post-a3.json
```

### 3.4 Pass criteria

| Metric | Threshold |
|--------|-----------|
| `task_hit@1` (discovery) | ≥ baseline − 0.02 |
| `discover_hit@1` | ≥ baseline − 0.02 |
| `resolve_accuracy` | ≥ baseline (no regression) |
| Any intent with 0 endpoints | count unchanged or lower |

### 3.5 CI wiring

```yaml
# .github/workflows/eval.yml (or existing CI)
- run: pnpm exec capindex eval:methods       # E3 — existing
- run: pnpm exec capindex eval:bridges       # E1 — new, after A3
- run: pnpm exec capindex eval:usefulness    # E2 — new, after C
```

---

## 4. Skill dogfood scenarios (D validation)

Manual or semi-automated runs using [04_oasis-next-skill.md](./04_oasis-next-skill.md) with **today's tools**:

| # | Scenario | Success criterion |
|---|----------|-------------------|
| 1 | LA sales investigation | ≥2 hops, synthesis cites endpoint evidence |
| 2 | Competitor Company intel | agent declares `Company`, calls ≥1 follow-up |
| 3 | Domain / brand intel | agent declares `Domain` or `Company`, calls ≥1 cross-domain follow-up (whois, social) |

Record in `fixtures/dogfood-log.md` (informal) or as E2 scenario inputs.

---

## 5. Gate sequence

```
A1+A2 designed
    │
    ▼
A3 re-type intents
    │
    ▼
E1 bridge validation (built index) ──FAIL──► re-granularize A1/A2 (do NOT build B)
    │
   PASS
    │
    ▼
E3 find regression ──FAIL──► fix A3 ports hurting routing
    │
   PASS
    │
    ▼
B + C built
    │
    ▼
E2 usefulness eval ──FAIL──► tune B4 ranking OR re-granularize A
    │
   PASS
    │
    ▼
F ship
```

---

## 6. Acceptance criteria (E done)

- [ ] `fixtures/bridge-scenarios.json` committed with ≥5 **v1** scenarios (Place, Company, ProductCategory, Person, Domain); crypto/forward marked `v1: false`.
- [ ] E1 imports `entity-match.ts` (shared primitive), runs on the **built** index, gates merges to the entity model.
- [ ] `fixtures/investigation-scenarios.json` with ≥3 judged scenarios.
- [ ] `usefulness-eval.ts` produces a metrics report including `lateral_relevance_precision`; E2 runs the **`catalog_aware`** baseline.
- [ ] Pre/post A3 baselines captured for `oasis_find` (`eval:methods`).
- [ ] `eval:bridges` / `eval:usefulness` subcommands added to `src/cli.ts` and documented in `--help`.