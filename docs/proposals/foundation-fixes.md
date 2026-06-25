# Discovery Foundation Fixes

**Status:** proposed — from the persona dogfood investigation (June 2026). WIP, uncommitted.

## Principle

OASIS controls exactly four things: the **ontology** (intents / aliases / entity typing), the
**cleaning** process (the text we embed), the **core logic** (binding, ranking, serving), and
the **quality gate** (the bar for what becomes a candidate). Make those solid. Whether a
*specific* endpoint surfaces is the **provider's** job — they write the spec; we set the bar
(the gate + [authoring guide](../authoring-openapi-specs.md)) and reward quality.

**No per-endpoint tuning. Don't rescue bad specs — drop them cleanly.** Endpoint symptoms are
how we *find* foundation flaws; the fix is always the foundation, never the endpoint.

## What the dogfood surfaced

A persona-based dogfood (marketing / finance / crypto / sales / traveler / shopper / home-buyer)
over the live MCP on the production index. **Routing (NL → intent) was correct in every case** —
every failure was downstream, and all four trace to a foundation axis, not to an endpoint:

| symptom | root cause | axis |
|---|---|---|
| "scrape reddit" → Twitter (reddit absent) | query-blind `MAX_SATISFIES = 50` truncates the candidate pool at build time, before any query exists — 75/80 intents affected (`media.social_data`: 532 bound → 50 kept; reddit's 41 cut) | core logic |
| "cheapest AirPods" → hotel `accommodation/compare`; "hotels" → `ecommerce-review-sentiment` | no intent for the true capability + over-broad aliases (`"compare prices"`, `"reviews"`) → off-domain endpoints spill to the nearest action-match | ontology |
| `sociavault/reddit` → `blockchain_rpc` | payment-rail chain names ("USDC on Base, Polygon, Solana") leak into the embedded text; the normalizer doesn't strip them | cleaning |
| `oasis_next` `Place=Tokyo` → generic bridges only | bridge selection truncates (a typed `travel.place_reviews` bridge was cut); some intents consume `Query` (untyped) so can't bridge at all | core logic + ontology |

## Fixes

### 1. Cleaning — strip payment/rail boilerplate (small, isolated, do first)
`src/embed/endpoint-text.ts` — extend the `BOILERPLATE` denylist to drop payment-rail tokens
that are never capability content: chain names (`Base`, `Polygon`, `Arbitrum`, `Optimism`,
`Solana`, `World`, `Ethereum`), `USDC on <chain>` / settlement phrasing. Payment lives in
`x-payment-info`, not the embedded text.
**Effect:** a boilerplate-only spec (empty-ish summary + payment-only description) reduces to
near-empty text → it **orphans/drops cleanly** instead of mis-binding to `blockchain_rpc`. This
isn't rescuing the bad spec — it's making it fall out cleanly; the publisher fixes their summary.

### 2. Core logic — uncap candidates + rank query-aware at serve time (the big one)
- **Remove the build-time truncation.** `src/materialize-satisfies.ts`: `satisfies[]` = *all*
  quality-gated, bound endpoints. Keep `MAX_SATISFIES` as a **named, tunable constant**, default
  uncapped/generous, documented as a **ranking-compute / index-memory knob for scale — NOT a
  token knob.** (Per-call tokens are bounded by each tool's `limit`, default 8; `satisfies[]` is
  the internal pool, never returned wholesale.) Flip it to ~100–200 later when corpus scale makes
  ranking the full pool a latency concern.
- **Rank query-aware over the full candidate set.** The resolve/serve path
  (`src/select-policy.ts` / `resolveEndpointsForQuery`) must order an intent's full `satisfies[]`
  by the **query**, then return `limit`. This brings the endpoint-arm's query↔endpoint relevance
  *into* the intent layer. Verify it genuinely favors query terms — the dogfood showed Twitter
  out-ranking reddit even for "reddit," so the query weighting must be real, not a neutral prior.
  **Effect:** reddit (now a candidate) ranks top for "reddit"; fixes the 75/80 magnet truncation.
- **Same pattern for `oasis_next`.** `src/entity-flow-traverse.ts`: rank bridges identity/query-
  aware over all typed candidates rather than a static top-N that cut `travel.place_reviews`.

### 3. Ontology — typing, alias scoping, coverage
- **Entity typing** — type the `Query`-consume intents (`maps.places`, `travel.aviation`) and
  migrate the rebase's `StructuredRecord` intents to typed entities, so `oasis_next` can bridge
  them. (Also clears the `validate-source` failure the rebase introduced.)
- **Alias scoping** — tighten over-broad, domain-generic aliases so an off-domain endpoint
  *doesn't* qualify (when nothing fits, it should **orphan, not spill**): e.g.
  `shop.compare_price`'s `"compare prices"`, `travel.place_reviews`'s `"reviews"`.
- **Coverage gaps** — add genuinely-missing **vendor-neutral** intents (lodging/booking
  price-compare, review-sentiment, …) per the [ontology-coverage](ontology-coverage.md)
  discipline (≥3 independent providers; never mint a per-vendor intent).

### 4. Quality gate — keep it the load-bearing bar
Uncapping `satisfies[]` makes the gate the *only* filter on candidacy, which is correct. Keep it
solid (it already drops content-free / stub / thin records). No secondary count cap.

## Sequencing
1. **Cleaning (#1)** — small, isolated, high-leverage.
2. **Core logic (#2)** — biggest quality win (reddit + magnets + `oasis_next`); medium effort.
3. **Ontology (#3)** — entity typing first (also unblocks CI) → alias scoping → coverage (ongoing).
4. After each: re-run the persona dogfood + golden-coverage eval; watch the via-signal /
   orphan-count for regressions.

## Out of scope / parked
- **Per-endpoint tuning** — never. Symptoms validate the foundation, not individual endpoints.
- **Rescuing bad specs** — drop cleanly; publishers fix via the [authoring guide](../authoring-openapi-specs.md).
- **Ranking signals** (completeness + well-known prior) — a separate quality enhancement; see
  [ranking-signals.md](ranking-signals.md). Note it does *not* fix the reddit/cap issue (that's
  candidacy + serve ranking, above).
- **Volume / usage ranking** — needs facilitator/settlement data (stale via Bazaar); parked.
