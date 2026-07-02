# Proposal: quality-aware ranking from on-chain usage

**Status:** Proposed · **Help wanted** · not yet implemented

When many paid endpoints do the same task, which one should an agent pick? Today OASIS
ranks an intent's candidates by **task fit** (intent-id / vocab / query lexical match) plus
weak structural quality, with a guard against absurd prices. That is enough to find *a*
correct endpoint, but not to prefer the *best* one.

This proposal adds the signal that should decide among comparably on-task endpoints:
**real on-chain payment activity — historical volume / revenue, paying buyers, and a recent
uptick (trending up).** Explicitly **not** price: we do not optimize for cheapest, only
guard against the absurd. A heavily-used, growing endpoint is the one an agent should reach
for, and that usage is observable on-chain and hard to game.

## Why on-chain

Both payment rails are `402`-challenge-over-HTTP and settle on public chains, so every paid
call is a public stablecoin transfer:

- **x402** (Coinbase) → settlements on **Base** / **Solana**
- **MPP** (Machine Payments Protocol) → settlements on **Tempo**

That makes per-service volume / buyers / trend **objective and un-gameable** (unlike
self-description), and available to anyone who reads the chain.

## Sourcing the data

The signal exists on-chain for both rails; the open question is the most robust way to pull
it in. There are several plausible paths — settlement explorers that already aggregate this,
third-party chain indexers, or reading the settlements directly from chain. **Contributors
are encouraged to find the cleanest, most vendor-neutral approach** rather than depend on any
one provider; the durable end state is sourcing it straight from the chain.

Whatever the source, the figures are **per service (origin)**, so every endpoint of a service
shares its snapshot.

## How it plugs into OASIS

The integration shape is small and independent of how the data is sourced:

1. **A `usage` field on each endpoint record** — origin-level: `volume_usd`, `transactions`,
   `unique_buyers`, optional windowed counts for a `trend` factor, plus `observed_at` and the
   source. Absent until ingested.
2. **An offline enrichment pass** that mirrors `src/enrich-facets.ts`: read the built
   `dist/index.json`, attach the per-origin `usage` snapshot by matching the service's origin
   (`canonicalOrigin` in `src/ingest/origin-aliases.ts`), and rewrite `dist`. Best-effort — a fetch
   failure must never break the build.
3. **A popularity term in resolve ranking** — an additive signal in
   `resolveEndpointsForQuery` (see the marked extension point in `src/bind/select-policy.ts`),
   **gated by task fit** so it only decides among comparably on-task endpoints. Roughly:
   log-compressed volume + buyers, times a trend factor when windowed data exists. Tune the
   weight against the eval gate.

## Next steps

1. **Source per-service usage** for both rails (volume, transactions, unique buyers; ideally a
   recent window for trend).
2. **Implement** the `usage` field + enrichment pass + the gated popularity term.
3. **Validate honestly** — A/B that ranking now surfaces the more-used / trending endpoint at
   **equal** task accuracy, and gate against regression: `eval:resolve` (currently 47/47) and
   curated `eval:compare` discover@3 must hold.

## References
- Origin matching: `src/ingest/origin-aliases.ts` (`canonicalOrigin`)
- Enrichment pattern to mirror: `src/enrich-facets.ts`
- Ranking extension point: `src/bind/select-policy.ts` → `resolveEndpointsForQuery`
- Ingest adapter pattern: `src/ingest/mpp-catalog.ts`
