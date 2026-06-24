# Ontology Coverage — Candidate Intents (next round)

**Status:** jotting / backlog. Not committed work.

The semantic binder matches endpoints to a curated set of **56 vendor-neutral intents**. On the cleaned 21,728-endpoint corpus, **9,496 are orphans** (match none of the 56) → bind rate 56.3%. Most orphans are *correctly* unbound: their capability simply has no intent yet. This doc lists the highest-evidence gaps so we can grow the ontology **deliberately**.

Guardrails (per `oasis-discovery-architecture-philosophy`):
- A new intent must be a **vendor-neutral, generalizable capability** with **≥3 independent providers** — not a reaction to one provider's catalog.
- Prefer **widening an existing intent's anchors** over minting a near-duplicate intent.
- Every new intent needs curated **anchor examples** (the binder embeds them); thin anchors = weak recall.
- After any change, re-run `scratchpad/orphan-audit.mjs` to measure recovery **and** watch the bound set for precision regressions.

---

## A. High-volume gaps — candidate NEW intents

| candidate | evidence (orphans) | generality check | notes / risk |
|---|---|---|---|
| **`convert.units`** — measurement / encoding / format conversion | `agent402.tools` ×2,222 ("cm→furlongs", "GB→bytes", "min→months", hex) | Need ≥3 providers — currently dominated by one. **Confirm it's a category, not a vendor**, before adding. | Largest single gap (23% of orphans). Real agent capability, but verify breadth first. |
| **`data.gov_records`** — gov / identity / public-record verification | Colombia electoral verification (`verifik.x402.paysponge.com`), KYB/KYC (`api.strale.io`), registraduría | Generalizable (KYC/KYB/electoral/registry across countries). | Decide boundary vs `data.person_search` / `data.company_enrich`. |
| **`data.environmental`** — environmental / geospatial context | EPA TRI + "national environmental context for any US county" (`locus.report`) | Generalizable environmental-data axis. | Could fold into a broader `data.gov_civic` instead — evaluate. |
| **`finance.market_data`** — market positioning / reference data | CFTC Commitments-of-Traders (`x402stock.xyz/cot`), daily market briefs | Distinct from `finance.trading_signals` (signals = actionable; data = raw). | Watch overlap with `stock_quote` / `crypto_spot_price`. |

## B. Anchor-widening — existing intents (no new intent)

| intent | missed endpoints | fix |
|---|---|---|
| **`media.social_data`** | `reddit/hot/{subreddit}` (orphan), `reddit/trending` (→ wrong intent), X user timelines, X Community Notes | add reddit/subreddit/post/comment/timeline/community-notes vocab to anchors |
| **`finance.trading_signals`** | SignalPulse forex scan (`/scan/forex`, 9 fields — a real miss), arena strategy signals | widen anchors: forex / scan / signal / strategy |
| **news (→ `ai.web_research`?)** | base-chain ecosystem news, climate-news monitoring | decide: widen `ai.web_research` anchors, or mint `data.news_monitoring` |
| **travel / maps** | airport lists, flight search (FlightAware) | widen `maps.places` / `travel.place_reviews`, or mint `travel.aviation` |

## C. Likely leave orphaned (served by the endpoint-arm fallback)

- One-off calculators (IRA contribution calculator, demand forecaster) — compute, not a discoverable data/service capability. Borderline; the gated endpoint-arm already serves these by direct similarity.

---

## Method note
Bind rate is gated by **ontology coverage**, not the sparse floor (see `oasis-sparse-floor-calibration`). The lever to raise correct-bind rate is this list — adding `convert.units` alone could recover ~2,000+ orphans in one stroke — **not** lowering the floor further (which trades precision for noise). Orphans remain discoverable via the endpoint-arm fallback in the meantime.
