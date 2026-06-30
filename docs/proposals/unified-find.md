# Unified `oasis_find`: vector-baseline retrieval + ontology next-steps

**Status:** proposal · **Date:** 2026-06-29 · **Evidence:** [docs/benchmarks/oasis-vs-agentcash.md](../benchmarks/oasis-vs-agentcash.md)

## TL;DR
Collapse the agent-facing discovery surface to **one tool, `oasis_find`**, that does what an agent
actually needs in a single call: vector-search the corpus for callable endpoints **and** always
return a compact "here's what you can do next" map of adjacent/typed capabilities. `oasis_next`
folds into `find` as an optional `entities[]` enrichment; `oasis_search` stays as the low-level
pure-vector primitive; `oasis_resolve` becomes `find`'s internal primitive. Two changes in one:
**simplify the surface**, and **flip `find`'s retrieval base** from intent-first concentration
(69.6% P@1) to the vector arm (80.4% P@1 — beating AgentCash's 77.9%).

## Status (2026-06-30)
**Shipped:** `oasis_find` now defaults to the vector-arm base + an always-on `next_steps` map
(`mcp/tools.mjs`). 240-query blind benchmark: **80.0% P@1 / 70.8% P@3 — beats AgentCash (77.9% / 71.0%)
and the old intent-first default (68.8%) by +11.2pp** (+46 wins / −19 losses).

**Open problem — the ~19 "moat" losses.** Those 19 are queries where confident routing uniquely beat
the arm. A confident intent-#1 *pin* to recover them (even gated on arm corroboration of the host) was
tried and **regressed more than it recovered: net −23/240** (it dropped unified to 70.4%). So the base
stays *pure arm*. The smarter fusion that captures the moat without the regressions is the next hard
problem — the ~89% oracle ceiling is real but a naive pin does not reach it.

**Also pending:** the `next_steps` **entity-flow** enrichment (folding `oasis_next`'s `entities[]` path).
The always-on *capability-graph* `next_steps` shipped; the entity-anchored cross-domain leads are the
next increment, so `oasis_next` stays a separate tool for now.

## Motivation — two problems, one fix

**1. The surface is confusing.** An agent today faces `oasis_find`, `oasis_next`, `oasis_search`,
`oasis_resolve` (+ contribution tools) with overlapping-sounding jobs and no obvious default. "When
do I use what?" is unclear, so agents under-use the differentiated parts (the relationship layer)
entirely.

**2. `find` is benchmarked *worse than its own parts*.** The blind 240-query benchmark isolated
`find`'s internal arms:

| mode | P@1 | P@3 |
|---|---|---|
| intent-first *concentration* (the current base) | 67.1% | 59.7% |
| **vector arm alone (query-first)** | **80.4%** | 71.7% |
| current fused `oasis_find` | 69.6% | 61.7% |
| AgentCash (external control) | 77.9% | 71.0% |

The vector arm — *already inside OASIS* (`endpoint-arm.ts`) — beats AgentCash, but `find` buries it
as a conservative fallback (fires only on near-tie routing) and ships 69.6%. Separately, `find`
flattened away the relationship payload it was designed to surface ("no separate `related[]`
payload" — `mcp/tools.mjs`). Diagnostics on the 240: the arm is right where the fused result is
wrong **46** times (wins left on the table), while the intent path is uniquely right **20** times
(the moat). Oracle fusion of both ≈ **89%** P@1.

## Design

### The contract
`oasis_find({ query, entities?, finding?, limit? })` →
```json
{
  "endpoints": [ { "method", "url", "summary", "price_usd", "rails" } ],          // vector-baseline, ranked for the task
  "next_steps": [ { "do": "<plain-language adjacent task>", "intent_id": "...",
                    "endpoint": "<method url>", "price_usd": 0.0 } ]              // always present
}
```
- `query` — the NL task (required unless `entities`/`finding` supplied).
- `entities?` / `finding?` — typed entities the agent already holds → enriches `next_steps` with
  cross-domain entity-flow leads (the old `oasis_next` behavior). Optional.
- **Always returns BOTH** `endpoints` and `next_steps`.

### Retrieval base = the vector arm, ontology = reranker (not prefilter)
`endpoints` is produced by the endpoint arm (`endpointArm.topK(queryVec, k)` + the thin-row drop) as
the **base**, not the intent-routed `resolveEndpointsForQuery` concentration. The ontology/intent
layer applies as a **reranker/confirmer** on the retrieved set, not a prefilter:
- Re-impose facet/type compatibility (the gate) to kill the vector-distraction failures pure
  retrieval has ("voice" → a script writer; "Shopify" → product search; QR/video → image-gen).
- Preserve the ~20/240 cases where intent routing uniquely beats raw vector (the moat).

Target: the fusion ≈ **85–89%** P@1, vs 69.6% today and 77.9% for AgentCash.

### `next_steps`: two flavors, one field
- **Capability-adjacency (always, from the query alone):** `relatedOptions(routedIntent)` — the
  typed ontology edges (`pipes_to`→next, `alternative_of`/`sibling_of`→alternatives,
  `broader_of`/`narrower_of`→drill/generalize). No held entities needed. This is the "and here are
  endpoints to do X, Y, Z" on every `find` call. Keep it compact (top ~3–5).
- **Entity-flow (progressive, when `entities[]`/`finding` passed):** the current `oasis_next` engine
  (`suggestFollowUps` over the entity-flow runtime) — cross-domain capabilities that *consume* an
  identity the agent holds, each with the bridging entity. Fires only when entities are supplied, so
  the common case stays lean.

### Migration
- **`oasis_next` → removed as a standalone tool**; its logic becomes `find`'s `entities[]` path.
  (Optionally keep a thin deprecated alias for one release.)
- **`oasis_resolve` → internal primitive** behind `find` (may stay exposed for advanced
  "I already know the `intent_id`" use, or drop from the agent-facing set).
- **`oasis_search` → unchanged**: pure vector capability/endpoint search, the primitive.
- **Contribution tools** (`oasis_taxonomy`, `oasis_validate`, `oasis_validate_binding`) — unchanged,
  different concern.

### Resulting agent surface
- **`oasis_find`** — the one you always call: endpoints **+** next-steps; pass held entities for
  cross-domain leads.
- **`oasis_search`** — pure vector primitive (routing only).
- (+ contribution tools, separate.)

## Why this is the moat, not just simpler
AgentCash (any pure-vector engine) returns one ranked endpoint list. Unified `find` returns that
**plus** a typed map of where to go next — *on every call*. Folding `next` in puts the relationship
value (the thing a vector index structurally can't produce) in front of the agent every time,
instead of behind a tool it forgets to call. It surfaces the moat *more*, not less.

## Caveats / deferred
- **Coverage is orthogonal.** ~half the AgentCash gap is origins OASIS never crawled — this rework
  addresses retrieval + relationships, not corpus coverage. Crawl expansion is separate.
- **Keep the default lean.** `next_steps` compact by default; entity-flow expansion only on
  `entities[]`. Don't bloat the common response.
- **The moat needs its own eval.** P@1 measures only the `endpoints` half. The `next_steps`/traversal
  value needs a workflow/multi-step benchmark (does `find` surface the right adjacencies to complete
  a compound task?) — proposed separately; it's the dimension AgentCash can't attempt.
- **Reranker strength is load-bearing.** Query-first reintroduces vector-distraction risk; the
  ontology rerank must be strong enough to reject it — that's what preserves the 20 moat wins. Weak
  rerank ⇒ regress toward pure vector.

## Build sequence
1. **Arm-first retrieval** in `oasisFind`: use `endpointArm.topK` as the base + facet rerank; A/B vs
   current on the 240-query benchmark (target ≥80% P@1, then push toward the ~89% fusion ceiling).
2. **`next_steps` in the response** from `relatedOptions(routedIntent)` (compact, callable).
3. **Fold `oasis_next`** entity-flow into `find`'s optional `entities[]` path; deprecate the tool.
4. **Update** `mcp/skills/oasis.md` + tool descriptions to the 2-tool surface.
5. **Traversal/workflow benchmark** for the `next_steps` value (separate track — measures the moat).
