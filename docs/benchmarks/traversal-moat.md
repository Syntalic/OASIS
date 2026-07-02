# The traversal differentiator: next-step recall vs. a vector-only baseline

**Date:** 2026-06-29 · **Harness:** [`scripts/benchmark/traversal/run.mjs`](../../scripts/benchmark/traversal/run.mjs)
· **Gold set:** [`eval/benchmark/traversal-tasks.json`](../../eval/benchmark/traversal-tasks.json)
· **Method README:** [`eval/benchmark/traversal-README.md`](../../eval/benchmark/traversal-README.md)
· **Motivation:** [`docs/proposals/unified-find.md`](../proposals/unified-find.md) (the differentiator "needs its own eval")

## TL;DR

On 18 compound, multi-step agent tasks, OASIS surfaces **66.8% of the needed downstream next-steps
from the start capability alone, on a single call** (mean recall@8; micro 66.7%, 40/60 gold steps).
A pure-vector discovery engine (any embedding index / vector-search baseline) surfaces **0%** of them — it
returns one ranked endpoint list and has no relationship layer to traverse.

> **OASIS surfaces ~67% of the next-steps a compound workflow needs; a vector-only engine surfaces 0%.**

That gap is not a tuning artifact. A vector index *structurally* has no "what can I do next" edges to
return; the differentiator is the authored ontology (typed capability links + entity-flow), which a similarity
score cannot reconstruct.

## What's measured

The discovery P@1 benchmark ([`discovery-benchmark.md`](./discovery-benchmark.md)) only scores the
`endpoints` half of `oasis_find` — "is the #1 result right for this query". It says nothing about the
`next_steps` half. This benchmark isolates that half.

For each task we take the `start_intent` (the capability an agent resolves first) and compute the
union of two **key-free** signals over the authored ontology, ranked forward-first and capped at the
recall@K budget (K=8):

- **(a) capability graph** — `relatedOptions(intent, bundle)`: typed links (`pipes_to` → next step,
  `sibling_of`/`alternative_of` → substitutes, `broader_of`/`narrower_of` → drill/generalize,
  `fed_by` → prior step).
- **(b) entity-flow** — `suggestFollowUps` seeded from the bridge identity the start intent *produces*
  (Domain / Company / Person / Place / ProductCategory) → other-domain capabilities that *consume* it.
  Fires for the 5 tasks whose start produces a bridge identity; the other 13 score on the graph alone.

`next-step recall@8 = |surfaced@8 ∩ gold_next| / |gold_next|`. The gold steps are the capabilities the
workflow actually needs; the **misses are genuine ≥2-hop / cross-domain steps** an agent reaches on a
*later* call, not relabeled direct links — which is why the score is a meaningful mid-range, not 100%.

## Results

```
=== OASIS TRAVERSAL (next-step) BENCHMARK — 18 compound tasks, recall@8 ===
signals: capability-graph relatedOptions + entity-flow suggestFollowUps
key-free: GOOGLE_API_KEY not set (no embedding / no LLM)
```

| task | start_intent | recall@8 | hit/gold | missed next-steps (genuine multi-hop / cross-domain) |
|---|---|--:|:--:|---|
| startup-web-presence | `cloud.domains` | 66.7% | 2/3 | `comms.send_email` |
| sales-account-research | `identity.company_enrich` | 60.0% | 3/5 | `comms.send_email`, `finance.stock_quote` |
| prospect-sms-outreach | `identity.person_search` | 33.3% | 1/3 | `utility.phone_validate`, `comms.send_sms` |
| localize-address | `maps.geocode` | 100.0% | 3/3 | — |
| daily-weather-brief | `data.weather_forecast` | 33.3% | 1/3 | `media.news_headlines`, `comms.send_sms` |
| marketing-graphic-ship | `ai.image_generate` | 50.0% | 1/2 | `comms.send_email` |
| voice-a-script | `ai.text_to_speech` | 100.0% | 2/2 | — |
| page-to-knowledge-base | `web.scrape` | 75.0% | 3/4 | `ai.llm_complete` |
| equity-snapshot | `finance.stock_quote` | 75.0% | 3/4 | `ai.web_research` |
| bargain-hunt-product | `commerce.compare_price` | 66.7% | 2/3 | `comms.send_sms` |
| cited-research-answer | `ai.web_research` | 75.0% | 3/4 | `ai.llm_complete` |
| investigate-suspicious-domain | `devtools.whois_lookup` | 66.7% | 2/3 | `maps.geocode` |
| brand-social-footprint | `social.social_data` | 75.0% | 3/4 | `comms.send_email` |
| verified-email-send | `comms.send_email` | 66.7% | 2/3 | `utility.phone_validate` |
| crypto-wallet-analysis | `blockchain.onchain_analytics` | 75.0% | 3/4 | `ai.web_research` |
| publish-static-site | `cloud.hosting` | 66.7% | 2/3 | `comms.send_email` |
| underwrite-property | `realestate.property_lookup` | 50.0% | 2/4 | `data.weather_forecast`, `finance.economic_data` |
| process-voicemail | `ai.speech_to_text` | 66.7% | 2/3 | `comms.send_email` |

**Mean next-step recall@8 (macro): 66.8%** · micro recall@8: 66.7% (40/60) · range: 33.3%–100%

**Vector-only baseline (any pure-vector engine): 0.0%.**

## Reading the misses

The misses are not ranking failures — they are the workflow's *deeper* steps, which are not 1-hop
neighbors of the start. Two recurring shapes:

- **2-hop sends.** `comms.send_email` / `comms.send_sms` sit one capability past the identity step:
  `identity.company_enrich → identity.person_search → comms.send_email`. From `company_enrich` (1 hop), the
  email step isn't surfaced; from `person_search` it would be (`person_search` links `pipes_to
  comms.send_email`). The agent reaches it on the *next* call, when `person_search` becomes its
  current intent. So per-task recall@8 is a **floor** on full-traversal reachability.
- **Cross-domain leaps.** `finance.stock_quote` from a company-research start, or `finance.economic_data`
  from a property start, need a different identity (a Ticker, a Region's economic series) the start
  intent doesn't produce — a genuine cross-domain hop.

No miss in this run was a recall@8 **truncation** drop (the harness flags those with `*`; none
appeared) — every miss is a real ontology distance. The two 100% tasks (`maps.geocode`,
`ai.text_to_speech`) are workflows whose every step is a true 1-hop neighbor — legitimately, fully
covered on the first call.

## Why a vector engine scores 0, not "a little"

The baseline is 0% by construction, not by weak tuning. A vector index maps a query to nearby
endpoints by embedding similarity; it has **no typed edges** between capabilities and **no
entity-flow** (which capability *consumes the identity another produces*). There is simply nothing to
return for "what can I do next" — the relationship payload doesn't exist in that representation. You
can make the *endpoint* retrieval excellent (the unified-find proposal flips OASIS's base to exactly
that vector arm, ahead of the baseline at 80.4% P@1) and the next-step recall of a pure-vector engine is
still 0. The two axes are independent; this is the one OASIS owns.

## Caveats

- **Single-call coverage.** Recall is measured from the start intent only. The 2-hop misses are
  reachable on the following call (each `oasis_find`/`oasis_next` re-seeds from the new current
  intent), so 66.8% is a per-call floor, not the ceiling of what a full traversal surfaces.
- **Authored-ontology dependent.** The score moves with the typed links and entity ports in
  `ontology/intents/*.yaml` + the entity index. Better-authored `pipes_to`/`fed_by` edges raise it;
  this is the curation surface, and improving it is the intended lever.
- **Gold is hand-authored (n=18).** Small, opinionated set spanning ~14 domains. It establishes the
  contrast (X% vs 0%) and a regression baseline; it is not a saturating leaderboard.
- **Entity-flow needs `dist/entity-index.json`.** Absent it, the harness reports capability-graph-only
  recall and says so in its header.
