# Discovery ranking: quality, trust & demand signals

**Status:** parked — revisit after the binding pipeline is productionized. The per-record substrate
already exists (`_completeness`, `_flags`, `_wellknown`); this doc captures how to turn it into a
composite ranking score. The **demand** dimension (on-chain usage, § below) is **help-wanted / not
yet implemented** and can land independently. · **Date:** 2026-07-03 · **Provenance:** `main` @
`e2ed5aa`. *(Consolidates the former `onchain-usage-ranking.md` as the demand dimension.)*

> **Shipped since (separate from this composite proposal):** a **catch-all / breadth penalty**
> (`host_breadth` — down-weight a host bound to many intents when it has no id-token match to the
> routed intent) and a **breadth-gated semantic rescue**, plus the endpoint-arm **consensus** rule.
> These are *relevance/precision* signals in `src/bind/select-policy.ts` / `mcp/tools.mjs` (see
> ARCHITECTURE.md → Resolve path), **not** the completeness/trust/demand composite below — which is
> still parked.

## Goal

When many paid endpoints do the same task, which should an agent pick? Today OASIS ranks candidates
by **task fit** (intent-id / vocab / query match) plus weak structural quality, with a guard against
absurd prices — enough to find *a* correct endpoint, not the *best* one. This proposal ranks
`oasis_discover`/`resolve` results **within an intent bucket** by **quality + trust + demand**, not
just relevance. Every signal here is **gated by task fit** — it only decides among comparably
on-task endpoints, never overrides relevance.

## Signal dimensions & sources

| Dimension | Source | Freshness |
|---|---|---|
| **Completeness** | our `_completeness` (0–13 fleshed-out fields) | every ingest |
| **Trust** | AFTA profile depth (`/.well-known/agent-fair-trade.json`) | every ingest (probe) |
| **Standards adoption** | x402/MPP well-known + spec-conformant `x-payment-info.offers` | every ingest |
| **Agent-readiness** | `llms.txt` richness, MCP/A2A cards, openapi `x-service-info` | every ingest (probe) |
| **Coverage** | x402 resource-list cross-check | every ingest (probe) |
| **Demand** | **on-chain payment activity** (primary, § below); Bazaar `quality` telemetry (coarse fallback) | on-chain: enrichment pass · Bazaar: ⚠️ stale |

## Trust & agent-readiness — parse the well-known files (probe: *presence* → *parse-and-store*)

- **`/.well-known/x402`** → `{version, resources:[...]}` — the origin's self-declared endpoint list ⇒
  **coverage cross-check** (did we capture the full surface?) + endpoint count.
- **`/.well-known/agent-fair-trade.json` (AFTA)** → a structured **trust profile**:
  `publisher.{legal_entity, source_repo, contact}` (real org / open source), `no_charge_guarantees[]`
  (+ `verifiable_via` audit endpoints), `receipts` (Ed25519-signed), `freshness_slas`, `deprecation`,
  `sanctions`, `data_license`, `lastUpdated` → a real trust score, far beyond yes/no.
- **`/llms.txt`** → agent-doc quality (sections, links to openapi/docs/whitepaper) + a clean
  **summary blockquote to enrich thin records' descriptions.**

Also worth probing: `/.well-known/agent-card.json` (Google A2A) · `/.well-known/mcp/server-card.json`
(MCP) · `/.well-known/security.txt` (RFC 9116) · `/.well-known/api-catalog` (RFC 9727).

## Demand — real on-chain payment activity

The signal that should decide among comparably on-task endpoints is **real usage**: historical
volume / revenue, paying buyers, and a recent uptick (trending up). Explicitly **not price** — we do
not optimize for cheapest, only guard against the absurd. A heavily-used, growing endpoint is the one
to reach for, and that usage is **observable on-chain and hard to game.**

### Why on-chain (the durable, un-gameable source)

Both rails are `402`-challenge-over-HTTP and settle on public chains, so every paid call is a public
stablecoin transfer:

- **x402** (Coinbase) → settlements on **Base** / **Solana**
- **MPP** (Machine Payments Protocol) → settlements on **Tempo**

That makes per-service volume / buyers / trend **objective and un-gameable** (unlike self-description
or self-reported telemetry), available to anyone who reads the chain.

### Sourcing

The signal exists on-chain for both rails; the open question is the most robust pull. Plausible
paths: settlement explorers that already aggregate it, third-party chain indexers, or reading
settlements directly. **Contributors are encouraged to find the cleanest, most vendor-neutral
approach** rather than depend on one provider — the durable end state is sourcing straight from the
chain. Figures are **per service (origin)**, so every endpoint of a service shares its snapshot.

### Integration (small, independent of the source)

1. **A `usage` field on each endpoint record** — origin-level: `volume_usd`, `transactions`,
   `unique_buyers`, optional windowed counts for a `trend` factor, plus `observed_at` + source.
   Absent until ingested.
2. **An offline enrichment pass** mirroring `src/enrich-facets.ts`: read the built `dist/index.json`,
   attach the per-origin `usage` snapshot by matching the service origin (`canonicalOrigin` in
   `src/ingest/origin-aliases.ts`), rewrite `dist`. Best-effort — a fetch failure must never break
   the build.
3. **A popularity term in resolve ranking** — an additive signal in `resolveEndpointsForQuery`
   (marked extension point in `src/bind/select-policy.ts`), **gated by task fit**. Roughly:
   log-compressed volume + buyers, times a trend factor when windowed data exists. Tune against the
   eval gate.

### ⚠️ Bazaar telemetry — the coarse interim fallback (measured)

Until on-chain sourcing lands, Bazaar's `l30DaysTotalCalls` / `l30DaysUniquePayers` / `lastCalledAt`
are the only demand proxy — but they are **batch-updated per-origin on an irregular cadence, hours to
*weeks* stale** (verified: ottoai unchanged over 3h; onesource ~15 days stale). So:

- **Do NOT** use as a precise score or as liveness (`lastCalledAt` is a batch timestamp — can't
  distinguish "quiet origin" from "stale crawl").
- **DO** use as a **coarse demand bucket** (heavy / some / none, order-of-magnitude) with a
  **staleness flag** (ignore when `lastCalledAt` > N days). Secondary signal only, never top-weighted
  — and superseded by the on-chain source once available.

## Implementation sketch (later)

1. Extend the well-known probe to fetch + parse contents → store a per-origin `signals` blob (trust,
   standards, agent-readiness, coverage).
2. Add the `usage` field + on-chain enrichment pass (demand); Bazaar bucket as the interim fallback.
3. Compute a composite `_rank_score` (weights TBD — lean: completeness + trust + standards primary;
   demand secondary until the on-chain source is proven).
4. Use `_rank_score` to order results **within an intent bucket**, gated by task fit.

## Validation (honest)

A/B that ranking now surfaces the more-complete / more-trusted / more-used endpoint at **equal task
accuracy**, and gate against regression: `eval:resolve` and curated `eval:compare` discover@3 must
hold. Never trade relevance for a quality/demand signal.

## References
- Origin matching: `src/ingest/origin-aliases.ts` (`canonicalOrigin`)
- Enrichment pattern to mirror: `src/enrich-facets.ts`
- Ranking extension point: `src/bind/select-policy.ts` → `resolveEndpointsForQuery`
- Ingest adapter pattern: `src/ingest/mpp-catalog.ts`
