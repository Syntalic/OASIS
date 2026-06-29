# OASIS vs AgentCash — discovery benchmark

**Date:** 2026-06-29 · **Question:** head-to-head #1-correctness on natural-language API discovery, toward "beat AgentCash."

## TL;DR
On **240 blind queries**, **OASIS trails AgentCash by ~10pp on #1-correctness** (OASIS 69.6% vs AgentCash 79.2%; robust to judge noise at 9.2–9.6pp). The headline is sound and — because the query set is OASIS's *home turf* — likely a **conservative (OASIS-flattering) floor**. An adversarial review materially corrected the **diagnosis**: a first-pass attribution ("0% routing, not usage-data, mostly cheap to fix") was substantially an artifact of how the harness was built, not a finding. Honest decomposition: **~half the gap is a real coverage gap** (origins OASIS never crawled — including AgentCash's *proprietary* first-party APIs), and the rest is **binding/ranking, where a quality/usage signal genuinely matters**.

## Method
- **240 blind queries** — 3 per intent × 80 intents, 3 phrasing styles (terse / conversational / contextual-with-distractor-token), LLM-generated from OASIS **task definitions only**, blind to any engine. ⚠️ Generated from OASIS's own intents → **home-turf bias**: every query has a guaranteed OASIS home intent, which favors OASIS routing and makes the measured deficit a floor.
- **Arms:** OASIS-local gate-scoped (candidate) · OASIS-local gate-off · AgentCash `search`. Real MCP calls. Live-hosted OASIS ≈ gate-off (same code); deploy delta = the gate's +0.8pp.
- **Blind LLM judge** (gemini-3.5-flash): per query judges the deduped union of all arms' top-3 — never sees which engine produced which. **Calibrated 95%** vs 21 hand-labels (after a judge-prompt fix, below). Caveat: 21-item set (±~12pp CI), single-candidate condition; the prompt's exclusion examples were tuned on observed OASIS failures (mild overfit).
- **Scoring:** P@1 / P@3, head-to-head, loss attribution.

## Headline (sound, robust, conservative)
| Arm | P@1 (#1 correct) | P@3 |
|---|---|---|
| **AgentCash** | **79.2%** | 71.7% |
| OASIS (scoped gate) | 69.6% | 61.8% |
| OASIS (gate off) | 68.8% | 60.6% |

- Gap **9.6pp**. Re-scoring with all 7 borderline judge-disagreements from the adversarial review flipped → OASIS 71.3% / AgentCash 80.4%, gap **9.2pp**. The comparative metric moves ≤0.4pp under judge-call noise — the most trustworthy number here.
- **Likely conservative:** home-turf query set + minor harness bugs that all *under*-credit AgentCash (1 empty AC result, 3 AC duplicate-URL-in-top-3). A neutral / real-traffic query set would probably *widen* the gap.
- **Scoped gate macro contribution: +0.8pp** (2 intents) — real where applied, negligible across 80. Necessary, far from sufficient.

## Diagnosis — corrected after adversarial review
The first-pass attribution overstated how cheaply OASIS can close the gap. Honest version:

**Defensible:**
- **Coverage is ~half the gap and real.** 26/53 losses (49%) are on hosts OASIS **never crawled**. ≥7 are AgentCash's **own first-party `stable*.dev` APIs** (proprietary inventory OASIS may structurally never include); 16 are third-party aggregators (`x402helper.xyz` ×10, `gg402.vercel.app` ×6). Half the gap is a data/coverage problem — part of it AgentCash's competitive moat, not something the gate/ranking touches.
- **Routing/ontology is small but NOT zero.** The claimed "0%" was leniency: attribution counted routing "OK" if the home intent was in top-3, while the headline is top-1. Under a top-1 definition ~4/53 (7.5%) are routing mismatches — and even that is flattered by the home-turf query set.

**Overstated (retracted):**
- **"Not blocked on usage-data" was unfalsifiable** — the attribution taxonomy had no usage-data bucket, so no loss *could* be attributed to it. Unsupportable from this data.
- **"~half cheaply fixable binding/ranking, no usage data needed" is a non-sequitur** — the "ranking" losses are correct-but-buried endpoints (rank 2–3), and promoting a buried endpoint to #1 is *exactly* what a usage/popularity signal buys. These are evidence usage-ranking would **help**, not evidence it's unnecessary.

## Honest path to closing the gap
1. **Coverage expansion** — crawl the third-party aggregators OASIS lacks (`x402helper.xyz`, `gg402.vercel.app`, …). Caveat: AgentCash's first-party `stable*.dev` inventory may be uncapturable — a structural competitive limit, not a bug.
2. **Binding/ranking + a real quality signal** — the gate sweep fixes wrong-class #1s (the benchmark surfaced a QR generator and a text-to-video model topping `ai.image_generate`, a property-tax lookup topping a mortgage query); a **usage/popularity prior** is what promotes the right-but-buried endpoints. (Correction to the first pass: usage-data IS relevant here.)
3. **The ontology moat is validated** — routing is not the bottleneck (~7.5%, mostly home-turf-flattered). The hybrid's structural advantage holds; the gap is downstream of routing.

## Adversarial review (what it caught, incorporated)
An independent skeptic agent found: the headline is sound and conservative; the judge is roughly neutral (one clear error, which favored OASIS); but the **diagnosis was largely baked in** — query provenance (OASIS's own intents) near-guarantees the "0% routing" result, and a taxonomy with no usage-data category makes "not usage-data" unfalsifiable. The "mostly fixable without data" framing buries a real ~49% coverage gap, part of it AgentCash's proprietary inventory. All corrections above reflect that review.

## Caveats
- Judge 95% on 21 items (±~12pp CI), single-candidate; prompt exclusion examples tuned on observed failures (mild overfit).
- Minor harness bugs (1 empty AC, 3 AC dup-URLs) all *under*-credit AgentCash → its true lead is marginally larger.
- "Win-or-tie 78%" counts both-engines-fail as OASIS-not-losing — not a real win metric; excluded from the headline.
- One competitor as yardstick; home-turf query provenance. A neutral/real-traffic query set is the obvious next iteration.

## Repeatable
240-query set (`eval/benchmark/queries.json`) + judge calibration (`eval/benchmark/calib.json`) + harness (`scripts/benchmark/`) committed. Re-run to track win-rate over time — the win-rate tracker and the scaling tripwire. **Next iteration: a neutral (non-OASIS-derived) query set + a usage-data bucket in the attribution.**
