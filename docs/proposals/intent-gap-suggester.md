# Proposal: intent-gap suggester from unbound endpoints

**Status:** Proposed · **Help wanted** · not yet implemented

As paid endpoints multiply, the curated task ontology (`ontology/intents/*.yaml`) has to keep
up — but today it only grows by hand. Ingestion binds each endpoint to the **existing**
curated intents (dense + sparse hybrid, `src/embed/bind-endpoints.ts`); whatever fails to
bind is **counted and forgotten**. `countUnboundEndpoints` / `unboundEndpoints`
(`src/ontology-expand.ts`) are the only coverage primitives, and they have **no consumer** —
their own doc comment says they're "for visibility / coverage reporting; does not mutate
anything." So the index can already tell us *that* a chunk of the catalog matches no task, but
nothing turns that into a candidate task.

This proposal closes that loop **without** breaking the curation gate: an offline pass that
mines the unbound set for **concepts the existing intents don't cover** and emits
human-reviewable *suggestions* — never writing `ontology/intents/` itself. It's the missing
feedback signal, shaped to feed the existing PR flow rather than replace it.

## Why this is wiring, not new infrastructure

Every primitive already exists — the gap is that they aren't connected:

- **Input:** `unboundEndpoints()` (`src/ontology-expand.ts`) — the endpoints that bound to no
  curated intent after semantic binding + authored overrides.
- **"Already covered" vocabulary:** `intentBindingTerms()` (`src/ontology-expand.ts`) — the
  label/description/alias terms each curated intent contributes. Diffing against this is what
  makes a term *uncovered* rather than just frequent.
- **Keyword extractor:** the TF-IDF sparse arm in `src/embed/bind-endpoints.ts` (IDF over the
  endpoint corpus) already scores lexical salience — reuse it to rank candidate terms instead
  of hand-rolling a new one. This is the "pull out key unique words" step, grounded against
  the existing vocab so it surfaces only what's *new*.
- **Semantic grouping:** endpoint dense embeddings are already computed and cached
  (`src/embed/endpoint-cache.ts`). Cluster the unbound set so each cluster ≈ one candidate
  intent, not one row per endpoint.
- **Draft facets:** `deriveEndpointFacets()` (`src/build.ts`) already maps endpoint text onto
  the closed facet/entity vocab — use it to pre-fill a suggested intent's facets.

Note what this is **not**: `expandOntologyFromProviders()` already mints one shadow capability
*per vendor* from ingested providers, but those rows are a 1:1 mirror (id = `slug(category).slug(name)`),
are filtered out of runtime search (`src/search-hybrid.ts` skips "non-curated shadow rows"),
and never surface a vendor-neutral *concept*. This proposal is the opposite: cross-vendor,
concept-first, and explicitly routed to human review.

## How it plugs into OASIS

A new offline command, mirroring `src/enrich-facets.ts` (read a built `dist/index.json`, never
re-crawl):

1. **`capindex suggest-intents [distDir]`** → collect `unboundEndpoints(bundle.endpoints)`.
2. **Surface uncovered vocabulary** — tokenize each unbound endpoint's `search_text`, rank
   terms/bigrams by IDF (reusing the sparse-arm helpers), and **drop any term that substring-
   hits a curated `intentBindingTerms()`**. What remains is the catalog's vocabulary the
   ontology has no word for.
3. **Cluster the unbound endpoints** by dense embedding (cosine, with a min-cluster floor).
   Each cluster = one candidate intent: representative endpoints, the cluster's top uncovered
   terms (draft `label`/`aliases`), and a `deriveEndpointFacets`-derived facet guess.
4. **Emit `dist/intent-suggestions.json`** (+ a markdown digest): for each candidate, a slug
   id, draft label/aliases/facets, the endpoints + **distinct origins** that would bind, and
   the uncovered-term list. Strictly advisory output — the source-of-truth YAML is untouched.
5. *(Optional)* an **LLM naming step run by the contributor**, consistent with today's
   "LLM-as-curator at the edge" model (`docs/scaling.md`): turn a cluster + its uncovered
   terms into a vendor-neutral candidate `ontology/intents/<id>.yaml` draft — which the human
   then edits, validates, and PRs.

## Keeping it vendor-neutral and un-gameable

The same discipline that demotes the per-provider shadow rows applies here:

- **Require ≥N distinct origins per cluster** before suggesting an intent, so a single vendor
  can't mint a bespoke task (the core failure mode of provider-derived intents).
- **Dedupe** candidate slugs against existing curated ids and recently-rejected suggestions.
- **Cap** the suggestion count and rank by `(distinct origins × uncovered-term IDF mass)` so
  reviewers see the highest-leverage gaps first.
- **Nothing auto-merges.** The output is raw material for the existing flow:
  `validate-source` still gates schema/vocab/links, and a maintainer still approves new
  clusters (`GOVERNANCE.md`, `docs/contributing-capabilities.md`).

## Next steps

1. **Implement** `capindex suggest-intents` as an offline pass over `dist/` (mirror
   `src/enrich-facets.ts`), reusing the sparse-arm tokenizer/IDF and the endpoint embedding
   cache; emit `intent-suggestions.json` + a markdown digest.
2. **Wire the coverage metric** so a CI/manual report prints `countUnboundEndpoints` before vs.
   after a suggested intent is adopted — making the loop's value measurable.
3. **Validate honestly** — adopting a suggested intent must **lower** the unbound count
   **without** regressing task accuracy: `eval:resolve` and curated `eval:compare` discover@3
   must hold.

## References
- Unbound-set primitives (the unused input): `src/ontology-expand.ts` → `unboundEndpoints`, `countUnboundEndpoints`
- "Already covered" vocabulary to diff against: `src/ontology-expand.ts` → `intentBindingTerms`
- Keyword/IDF machinery to reuse: `src/embed/bind-endpoints.ts` (TF-IDF sparse arm)
- Endpoint embedding cache: `src/embed/endpoint-cache.ts`
- Draft facets for a candidate: `src/build.ts` → `deriveEndpointFacets`
- Offline-pass pattern to mirror: `src/enrich-facets.ts`
- Why per-vendor auto-mint is insufficient: `src/ontology-expand.ts` → `expandOntologyFromProviders`; runtime filter in `src/search-hybrid.ts`
- Contribution + governance gate this feeds: `docs/contributing-capabilities.md`, `GOVERNANCE.md`, `docs/scaling.md`
