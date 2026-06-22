# How OASIS scales (and the architecture direction)

The honest finding from the [end-to-end benchmarks](eval_results.md): at today's ~30k
endpoints, with a strong model, **raw keyword search over the unified index matches the
capability ontology on accuracy.** That isn't a failure of the ontology — it's that the
substrate is still small enough for brute force, and a capable LLM disambiguates by
reading endpoint summaries itself. The ontology was built for a *larger, noisier* world.
This doc is the thesis for that world.

## The shape: endpoint-atomic, ontology as a server-side aid

Three roles, kept distinct:

- **Endpoint = the atomic unit the agent sees.** One tool (`oasis_find`), one flat ranked
  list, one round-trip. Search and resolve collapse server-side — there is no
  capability→endpoint hop for the agent to traverse (or for a binder to get wrong).
- **Capability = a server-side recall + ranking aid**, not an agent-facing routing layer.
  It bounds and ranks the candidate set behind the curtain, paid in compute, not agent
  tokens. (Exposing it as a hop cost ~2× tokens for no accuracy gain — see below.)
- **Service = a facet** (auth, price, rails, reputation, coverage), never the routing unit.
  The binding pollution that caused a real resolve bug was a *service-coarse* artifact.

The evidence that drove this (full tables in [eval_results.md](eval_results.md)):

| design | accuracy | tokens/task | why |
|---|---|---|---|
| `oasis_find` (one hop) | 18/18 | **2,562** | server-side recall+ranking, flat output |
| two-hop search→resolve | 18/18 | 5,031 | agent reads capability list + resolve + related[] |
| raw keyword (same index) | 17/18 | 2,723 | no ranking; fine at small scale |

The one-hop interface is the cheapest *and* most accurate. The agent-facing capability
traversal is the part to retire; the ontology earns its keep underneath it.

## Why this holds as the corpus grows 10–100×

Raw keyword ties OASIS at 30k but degrades with N on three axes:

1. **Collision explosion.** "weather" matches a few hundred endpoints at 30k; tens of
   thousands at 3M. The lexical top-k becomes a thin, noisy slice — the right endpoint
   may not be in it, and a recall miss is fatal (no model intelligence recovers an
   endpoint never shown).
2. **A new "best-of-many" problem.** 100× means ~100 equivalent weather APIs. The question
   shifts from "find *an* endpoint" to "find the *best* one" (cheapest, most reliable,
   right rails). Keyword can't rank by quality; ranking can.
3. **Token cost inverts.** To hold recall as collisions grow, a keyword agent reads more
   results / searches more (already visible: the low-coverage pay-skills slice costs ~2×
   at 3.3 searches/task). A pre-ranked, bounded list stays constant-size.

What scales: **vector/ANN recall** (semantic, sublinear, stable), **faceted pruning**
(domain/action/freshness/price filters indifferent to N), a **bounded task vocabulary**
(~hundreds of tasks regardless of millions of endpoints, so the agent's reasoning surface
doesn't grow), and **within-task ranking** by objective signals. `oasis_find` already runs
on these primitives server-side — so it is the design expected to *widen* its lead, not
lose it, as N grows.

## The hard requirement: automated, distributed binding

The ontology only scales if the **binding** (endpoint→capability) is automated, not
hand-curated — you cannot hand-bind 3M endpoints, and the binding is exactly the part that
was polluted. The model:

- **LLM-as-curator, run by the contributor.** The service owner curates *their own*
  endpoints with *their own* key, against the controlled taxonomy
  ([oasis_taxonomy](contributing-capabilities.md)), and opens a PR. Cost is distributed to
  the edge; quality goes *up* (full spec + domain knowledge, not a scraped summary);
  incentives align (they want discoverability). OASIS centrally keeps only a cheap,
  objective validation gate (`validate-source`, run in CI) — and, later, a PR-review agent
  that checks for gaming. Ranking uses objective signals (price/rails/quality), never the
  contributor's self-description, so over-tagging buys nothing.

### Open piece: the per-service binding artifact

The contribution toolchain today authors **task intents** (the capabilities). The common
case — "bind my service's 20 endpoints onto existing capabilities" — needs an authored
**per-service binding artifact**: a committed file the curator produces stating
`{endpoint → capabilities, facets, price, rails}` for a service, validated in CI (paths
exist in the spec, capabilities exist in the taxonomy), and ingested at build time to
*replace* the heuristic binder for that service. That file format is the keystone that
makes distributed curation work end-to-end and retires the heuristic binding entirely. It
is designed-but-not-built; it's the next concrete step.

## Still to measure

- **Best-of-many quality at scale** is testable *now* on the naturally high-cardinality
  tasks (`finance.stock_quote` already has 638 endpoints, `crypto_spot_price` 295): does
  ranking pick a *cheaper/better* endpoint than keyword's arbitrary one? Requires
  price-aware ranking in `oasis_find`.
- **Endpoint-level embeddings** would make recall fully endpoint-atomic — but naive
  embeddings of terse OpenAPI summaries mostly add noise; the higher-signal move is to
  embed the LLM-curated representation, i.e. the binding above.
