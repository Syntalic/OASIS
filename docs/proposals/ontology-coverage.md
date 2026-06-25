# Ontology Coverage — Candidate Intents (next round)

**Status:** partially addressed (2026-06-24) — 4 new intents + anchor widening on 5 existing. Re-run orphan audit after next index rebuild.

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

## Implemented (2026-06-24)

| Change | Files |
|--------|-------|
| **NEW `compute.convert_units`** | `ontology/intents/compute.convert-units.yaml` — measurement, data-size, time, hex encodings (+ absorbs `data.abstract_timezone` eval remap) |
| **NEW `data.gov_records`** | `ontology/intents/data.gov-records.yaml` — KYC/KYB, electoral, AML (+ absorbs `data.orth_didit`) |
| **NEW `finance.market_data`** | `ontology/intents/finance.market-data.yaml` — COT, positioning, market briefs |
| **NEW `travel.aviation`** | `ontology/intents/travel.aviation.yaml` — flights, airports (+ absorbs `data.flightapi`, `data.goflightlabs`, `data.aviationstack`) |
| **Widen `media.social_data`** | reddit hot/trending/subreddit, X timeline, Community Notes aliases |
| **Widen `finance.trading_signals`** | forex scan, strategy/arena signal aliases |
| **Widen `ai.web_research`** | ecosystem/climate/news-monitoring aliases |
| **Widen `data.gov_civic`** | EPA TRI, county environmental context (folded instead of minting `data.environmental`) |
| **Registry** | `src/intent-match.ts` curated set 56 → **60** |

**Round 2 (69 intents):** `shop.tcg_catalog`, `compute.financial_calculator`, `data.book_lookup`, `data.drug_label`, `finance.stablecoin_monitor`, `media.movie_lookup`, `data.vat_validate`, `data.holidays_lookup`, `data.iban_validate` + widened `compute.convert_units`.

**Round 3 (73 intents):** `data.news_headlines`, `devtools.pdf_manipulate`, `media.anime_lookup`, `data.sports_scores` + widened `ai.llm_complete`, `finance.onchain_analytics`, `data.company_enrich`.

### Bind-rate results (fresh ingest 2026-06-25, 23,927 endpoints)

| Stage | Intents | Bound | Rate |
|-------|---------|-------|------|
| After round 1 enrich | 60 | 15,182 | **63.5%** |
| After round 2 enrich | 69 | 16,083 | **67.2%** (+901) |
| After round 3 enrich | 73 | 16,394 | **68.5%** (+311) |
| **Total gain** | +17 | **+2,212** | **+5.0 pp** |

Top binders added: `shop.tcg_catalog` (~1,290), `compute.convert_units` (~887), `compute.financial_calculator` (~367), `finance.stablecoin_monitor` (~206), `data.vat_validate` (~187).

**Naming rule:** major platforms and category references (Reddit, Twitter, DeFiLlama, …) are fine in aliases; endpoint- or niche-service-specific names are not.

**Round 4 (80 intents):** `finance.defi_analytics`, `data.nft_metadata`, `devtools.webhook_tools`, `finance.crypto_market_intel`, `data.airdrop_tracker`, `data.agriculture_stats`, `data.lei_lookup` (`media.anime_lookup` already in round 3).

**Still orphaned (~7,533 pre-R4):** `orbisapi.com` proxy micro-APIs (~948), thin-summary `agent402` utilities (~721/origin), payment/checkout stubs, and swarm template hosts — mostly one-off deployed agents or boilerplate summaries below sparse floor.

Audit artifact: `dist/orphan-audit.json` · compare script: `scripts/bind-compare.mjs` · audit script: `scripts/orphan-audit.mjs`

---

## Method note
Bind rate is gated by **ontology coverage**, not the sparse floor (see `oasis-sparse-floor-calibration`). The lever to raise correct-bind rate is this list — adding `convert.units` alone could recover ~2,000+ orphans in one stroke — **not** lowering the floor further (which trades precision for noise). Orphans remain discoverable via the endpoint-arm fallback in the meantime.
