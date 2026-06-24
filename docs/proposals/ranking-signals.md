# Discovery Ranking Signals — Proposal (parked)

**Status:** parked — revisit after the binding pipeline is productionized. The per-record substrate already exists (`_completeness`, `_flags`, `_wellknown`); this doc captures how to turn it into a composite ranking score.

## Goal
Rank `oasis_find`/`resolve` results by quality + trust + demand, not just relevance.

## Signal dimensions & sources

| Dimension | Source | Freshness |
|---|---|---|
| **Completeness** | our `_completeness` (0–13 fleshed-out fields) | every ingest |
| **Trust** | AFTA profile depth | every ingest (probe) |
| **Standards adoption** | x402/MPP well-known + spec-conformant `x-payment-info.offers` | every ingest |
| **Agent-readiness** | `llms.txt` richness, MCP/A2A cards, openapi `x-service-info` | every ingest (probe) |
| **Coverage** | x402 resource-list cross-check | every ingest (probe) |
| **Demand / liveness** | Bazaar `quality` telemetry | ⚠️ stale (see below) |

## Well-known contents to extract (upgrade probe from *presence* → *parse-and-store*)
- **`/.well-known/x402`** → `{version, resources:[...]}` — the origin's self-declared endpoint list ⇒ **coverage cross-check** (did we capture the full surface?) + endpoint count.
- **`/.well-known/agent-fair-trade.json` (AFTA)** → a structured **trust profile**: `publisher.{legal_entity, source_repo, contact}` (real org / open-source), `no_charge_guarantees[]` (+ `verifiable_via` audit endpoints), `receipts` (Ed25519-signed), `freshness_slas`, `deprecation`, `sanctions`, `data_license`, `lastUpdated`. → a real trust score, far beyond yes/no.
- **`/llms.txt`** → agent-doc quality (sections, links to openapi/docs/whitepaper) + a clean **summary blockquote we can use to enrich thin records' descriptions.**

## Other well-known files worth probing
`/.well-known/agent-card.json` (Google A2A) · `/.well-known/mcp/server-card.json` (MCP) · `/.well-known/security.txt` (RFC 9116) · `/.well-known/api-catalog` (RFC 9727).

## ⚠️ Bazaar telemetry caveat (measured)
`l30DaysTotalCalls` / `l30DaysUniquePayers` / `lastCalledAt` are **batch-updated per-origin on an irregular cadence — hours to *weeks* stale.** Verified: ottoai unchanged over 3h (frozen `lastCalledAt`); onesource ~15 days stale. So:
- **Do NOT** use as a precise score or as liveness (`lastCalledAt` is a batch timestamp, can't distinguish "quiet origin" from "stale crawl").
- **DO** use as a **coarse demand bucket** (heavy/some/none, order-of-magnitude) with a **staleness flag** (ignore when `lastCalledAt` > N days). Secondary signal only — never top-weighted.

## Implementation sketch (later)
1. Extend the well-known probe to fetch + parse contents → store a per-origin `signals` blob.
2. Compute a composite `_rank_score` from the dimensions (weights TBD — lean: completeness + trust + standards as primary; demand as coarse secondary).
3. Use `_rank_score` to order `oasis_find`/`resolve` within an intent bucket.
