# Binding precision: type the endpoints, then gate binding on facets

**Status:** proposal / investigation
**Date:** 2026-06-28
**Provenance:** deployed tip `a427f9f` (PR #12 `feat/local-relevance-ranking` + pinned index
snapshot); `dist/` built 2026-06-27 (21,834 endpoints, 80 capabilities).

## TL;DR

`oasis_search` (routing into the ontology) is solid; the accuracy lost in `oasis_find` is almost
entirely an **endpoint→intent binding-precision** problem. The root cause is structural, not a
tuning miss: **the ontology is a typed graph, but the endpoints are bound to it by text similarity,
not by type.** The intents carry `domain`/`action`/`modality` facets; the binder and resolve ranker
match on *topic nouns* instead. Any intent that collides with another on its noun and separates only
on a facet will mis-bind. The fix is to **type the endpoints** (give them the same facets the intents
have) and then gate binding/ranking on facet compatibility — with **no surgery to the curated
taxonomy** (the moat stays intact).

## How this surfaced

Six colloquial queries run through `oasis_search`, `oasis_find`, and a control (the baseline):

| Query | `oasis_search` routing | `oasis_find` result |
|---|---|---|
| weather / bitcoin / OCR | correct intent | clean |
| PDF → audio summary | exposes all 3 legs (`document_extract`→`llm_complete`→`text_to_speech`) | collapses to TTS leg |
| restaurant reviews near a hotel | `travel.place_reviews` + `maps.places` (both correct) | ecommerce/product-review scrapers bleed in |
| register a domain | `cloud.domains` ("Register or renew") — correct | registrars buried under availability/DNS/parse/ENS |

`search` was right on all six. Every `find` miss originated *after* routing, at binding.

## Root cause: facet-blind binding and ranking

The taxonomy declares facets per intent (`ontology/intents/*.yaml`):

```yaml
# cloud.domains            # travel.place_reviews
facets:                    facets:
  domain: cloud              domain: travel
  action: provision          action: lookup
```

But trace where those facets go in the matching pipeline:

- **Binding** (`src/embed/bind-endpoints.ts:180-185`): the sparse/lexical discriminator builds the
  intent's matchable text from `[id, label, description, aliases]` — **facets are not included**.
  The dense side (`src/embed/lance-index.ts:33-42`) appends `facets.domain` + `facets.action` as ~2
  word-tokens among ~50 — additive natural-language surface, never a constraint.
- **Resolve ranking** (`src/bind/select-policy.ts`): the dominant signal is
  `matchCount(ep, intentIdTokens)`, where `intentIdTokens` = the id minus its domain prefix:
  - `cloud.domains` → `["domains"]`
  - `travel.place_reviews` → `["place", "reviews"]`

  The catch-all/breadth penalty fires **only on a *zero* id-token match** (`select-policy.ts:247`).

Consequences, both inevitable rather than accidental:

- **Domain register:** the only id-token is the plural noun `domains`, matched as an exact substring
  over summary + description + **path** + inputs. So what actually scores is incidental: REST-path
  pluralization (`/domains/{id}`) lights up *every* CRUD verb equally — `Create`, `Delete`, `List`,
  `Get Domain` all match — while the terse real registrars (`doma.xyz/register`) often *don't* (14 / 20
  register endpoints score `idHits = 0`, i.e. are themselves eligible for the breadth penalty). The
  ranking is effectively **blind to the action**: the verb that separates *register* from
  *check* / *manage* / *parse* is the `action` facet, which the ranker never reads — and the noun match
  it does read is a path-pluralization accident, not a task signal.
- **Restaurant reviews:** id-tokens `["place","reviews"]`. An Amazon product-review scraper contains
  "reviews" → matches. The `domain: travel` facet that would exclude a `shop`-domain endpoint is
  never checked.

The git history is the tell: every prior fix (hand-tuned margins → TF-IDF sparse arm → breadth
penalty → endpoint-arm + consensus) is a better *text heuristic* — epicycles on retrieval — never a
move to typed binding. OASIS today is **an ontology used as a search index**, not an ontology used
as a typed graph.

## Live evidence (measured against `dist/`, no API)

Endpoints already carry a partial type — `facets: { domain, primary_entity, output_entity, modality }`
(coverage 73 / 42 / 38 / 28%) — but **no `action`** (0 / 21,834). Intent facets, by contrast, **are**
materialized into `dist/capabilities.json`: 70 / 80 capabilities carry `facets` **including `action`**
(`cloud.domains → {domain: cloud, action: provision}`, `travel.place_reviews → {domain: travel,
action: lookup}`). The asymmetry is one-sided — the *intent* side is fully typed (domain + action); the
*endpoint* side has domain but no action.

Binding-domain audit of the two failing buckets:

```
travel.place_reviews — 75 bound
  endpoint domain facet: travel:43  shop:21  maps:6  crypto:2  (none):3
  → 21/75 (28%) are shop-domain product-review endpoints in a TRAVEL intent
  → e.g. [shop] api.cn402.com/ecom/reviews :: "Amazon product reviews by ASIN…"
  any endpoint with an action facet? NO

cloud.domains — 81 bound
  endpoint domain facet: (none):54  shop:5  cloud:5  crypto:4  devtools:4  ai:2 …
  → domain facet does NOT separate register from check/connect/admin/ENS
  any endpoint with an action facet? NO
```

This is the diagnosis, quantified, and it splits the two cases:

- **Domain-collisions** (`place_reviews`): the endpoint `domain` facet **already exists** → a
  domain-compatibility gate drops 21/75 off-domain endpoints with **no new classification**.
- **Action-collisions** (`cloud.domains`): no endpoint `action` facet exists → requires classifying
  `action` onto endpoints (the keystone).

## The typing asymmetry

| Facet | On intents (`dist/`) | On endpoints (`dist/`) | Gap |
|---|---|---|---|
| `domain` | **yes** (`facets.domain`, materialized) | **yes** (`facets.domain`, 73%) | both sides exist → **add the gate only** (cheap) |
| `action` | **yes** (`facets.action`, materialized, 70/80) | **no** (0%) | classify onto endpoints — keystone |
| entity (`consumes`/`produces` / `primary_entity` + `output_entity`) | yes (materialized) | yes (`primary_entity` 42%, `output_entity` 38%) | usable, currently ungated |
| `modality` | materialized | **partial** (`facets.modality`, 28%) | extend coverage + gate (lower priority) |

"Get the ontology right and the endpoints match" is correct — but **"the endpoints match" means
"the endpoints are typed into the same schema as the ontology."** That typing layer is the missing
piece. The work is on the **endpoint side**, not the taxonomy side.

## Failure is systematic (not these two queries)

Predictor: **any intent whose discriminating dimension is the action/domain rather than the topic
noun.** Enumerable mechanically — cluster intents by shared noun-tokens, flag clusters that differ
only on a facet.

- **Action-collisions** (same noun, different verb): domain register/check/parse; image
  generate/edit/analyze/OCR; email send/validate/enrich; translate/detect-language.
- **Domain-collisions** (same noun, different domain): "reviews" (travel/product/app-store/agent-rep);
  "price" (crypto/equity/FX/commodity/retail-product); "search" (web/people/jobs/places/social).
- **Freshness-collisions:** price-*now* vs price-*history* — **already** fought with the endpoint-arm
  consensus rule. Same root cause, different hat → instances are being solved, not the class.

## On "just raise the spec-quality bar"

A reasonable lever, but not step one, and not as "maximum fields filled in":

1. **Volume ≠ discrimination.** Extra boilerplate text *dilutes* the dense vector (the binder's own
   comments note this). What matters is the *discriminative* fields — a declared action verb and
   input/output entity types — not field count.
2. **Third-party dependence.** OASIS federates Bazaar/mpp.dev/pay.sh/x402scan; a stricter gate trades
   **recall (coverage)**, which is part of the value prop.
3. **Gameable.** Author-declared metadata is adversarial (agent-SEO keyword stuffing).
4. **Doesn't fix the mechanism.** A perfectly-specced registrar still binds by text cosine today.

Refinement: **don't demand authors type their endpoints — infer the facets at ingest.** Spec quality
becomes a prior/tiebreaker, not a gate.

## Missing instrumentation

The build emits `bound` / `gatedSparse` / `promotedSparse` / `gatedMargin` counts, but **nothing
measures per-intent binding *precision*** ("of endpoints bound to intent X, what fraction actually do
X"). That is why the v5 "concentrate" change silently regressed `whois` 2→0 — a global floor tuned
against aggregate eval, with per-intent precision invisible. Any facet work is unmeasurable without
this metric; building it is part of the lowest-hanging fruit. (`dist/orphan-audit.json` is a start
but is recall-side, not precision-side.)

## Roadmap — lowest-hanging fruit → biggest lift

| # | Move | Touches | Effort | Lift | Depends on |
|---|---|---|---|---|---|
| **0** | **Facet-collision eval slice + per-intent binding-precision metric.** Auto-enumerate noun-colliding / facet-differing intent pairs; hand-label a few queries each; measure per-intent precision over `dist/`. | nothing (measurement) | low | unblocks everything | — |
| **1** | **Domain-gate (free signal).** Intent `domain` *and* endpoint `domain` already ship in `dist/` → purely penalize endpoint↔intent `domain` mismatch in `select-policy.ts` (no build change). Catches the `place_reviews` 21/75 today. | `select-policy.ts` | low | medium-high | #0 to measure |
| **2** | **Type the endpoints — classify `action` (+ `modality`) at ingest.** Assign each endpoint the same facet vocab the intents use; cache. **KEYSTONE** — the only thing that fixes action-collisions (`cloud.domains`). | build pipeline | medium | **highest** | — |
| **3** | **Facet-gated binding + facet-aware ranking.** Constrain dense/sparse similarity by facet compatibility — `action=lookup` cannot bind `action=provision` regardless of cosine; same penalty at resolve time. | `bind-endpoints.ts` + `select-policy.ts` | medium | high | #2 |
| **4** | **Spec-quality prior.** Completeness / discriminative-field richness as a ranking prior + light gate; normalize declared fields into #2's facets. | `quality-gate.ts` | medium | medium | #2 |
| **5** | **Surgical ontology refinement.** Split over-broad intents (`cloud.domains` provision vs DNS-manage/availability), add missing (geospatial "near me"). | curated taxonomy | low-med | medium | #0 audit |

**Sequencing note.** Facet-aware binding/ranking (#1, #3) is the goal, but it **does not touch the
curated taxonomy** — the taxonomy already has the facets. It needs the **endpoint-side facets**:
`domain` exists today (#1 is therefore cheap), `action` does not (#2 is the keystone). #5 (touching
the taxonomy) is **last and surgical** — the ontology is the moat; the win is typing the data *to*
it, not re-cutting it.

**Single highest-leverage experiment:** #0 + a quick `action` classifier (LLM over the 21,834
endpoints into the existing action enum, cached once) → re-run `oasis_find` on the collision slice
with a facet penalty bolted onto ranking. One build tells you whether typed binding closes the gap —
no full refactor, no taxonomy changes.

## Key files

- `src/embed/bind-endpoints.ts` — binder (dense floor + TF-IDF sparse promotion); intent text lacks facets.
- `src/embed/lance-index.ts` — `capabilityEmbedText` (facets appended as bag-of-words only).
- `src/bind/select-policy.ts` — resolve ranker (id-token + vocab; breadth penalty fires on zero noun match).
- `src/enrich-facets.ts` — where endpoint facets / `host_breadth` are computed at build.
- `ontology/intents/*.yaml` — where `domain`/`action` facets are authored.
- `dist/capabilities.json` — served intents; `facets` **materialized** (`{domain, action}` on 70/80 caps).
- `dist/endpoints.json` — served endpoints; `facets: {domain, primary_entity, output_entity, modality}` (partial), **no `action`** (0%).

## Appendix A — Live validation against the deployed tip

**Validated 2026-06-28** against deployed tip `a427f9f` + pinned index
`oasis-index-20260627-80e97e2`, hosted at `mcp.oasisindex.org` (= `oasis-mcp.fly.dev`).
Control: a **vector-search discovery baseline** — an independent x402/MPP discovery engine over a
smaller, brand-curated catalog. Every row of [How this surfaced](#how-this-surfaced) reproduces:
`oasis_search` routes correctly on all six queries; `oasis_find` is clean on the three baselines
and shows the three predicted failure shapes. Stable to phrasing — "register a domain **for my
project**" vs "**for my startup**" reshuffles the top-7 but keeps the first true registrar at rank 8.

Reproduce (no build, no key — hits the deployed index directly):

```
oasis_search(q) ; oasis_find(q)         for q in the six queries below
baseline search(q)                      control, for the three failing queries
```

### A.1 Verdicts

| Query | `oasis_search` (routing) | `oasis_find` (endpoints) | Verdict |
|---|---|---|---|
| weather | `data.weather_forecast` #1 | 8/8 weather | ✓ clean |
| bitcoin | `finance.crypto_spot_price` #1 | 8/8 crypto-spot | ✓ clean |
| OCR | `data.ocr` #1 | OCR; `qr-code-decode` bleed @6 | ✓ (one wart) |
| PDF→audio | TTS #1, `ai.document_extract` #3, `ai.llm_complete` #6 | 10/10 `ai.text_to_speech` | ⚠ orchestration gap, not binding |
| restaurant reviews | `travel.place_reviews` #1, `maps.places` #2 | product-review bleed @3/@8/@10 | ✗ binding precision |
| register a domain | `cloud.domains` #1 | first registrar @8 | ✗ binding precision |

### A.2 OASIS transcripts (condensed; `via` = bound intent)

**register a domain name for my startup** — `search` → `cloud.domains` #1 ✓, then `data.whois_lookup`,
`data.company_enrich`, `agent.marketplace`, `storage.hosting`, … `find` (all `via: cloud.domains`):

```
 1. GET  palmyr.ai/domains/pricing                       registration pricing (preflight)
 2. GET  the-stall.intuitek.ai/cap/domain-availability   availability check
 3. POST x402.agentutility.ai/business-name-generator    business-name generator
 4. POST mpp.api.agentmail.to/v0/pods/{id}/domains        "Create Domain" (email domain)
 5. POST mpp.buildwithlocus.com/v1/domains/:id/verify     CNAME + cert verify (DNS)
 6. POST win.oneshotagent.com/.../domains/{d}/resume      resume a paused domain
 7. GET  orbisapi.com/proxy/domain-parser-api-8057e3      parse domain into TLD/SLD
 8. POST mpp.doma.xyz/register          ◀ FIRST TRUE REGISTRAR ("Register a domain name via MPP")
 9. POST stabledomains.dev/api/register                  "Register a domain" (bonding curve)
10. POST gpt55.558686.xyz/v1/tools/domain-extract        extract host/domain parts
```

**find restaurant reviews near my hotel** — `search` → `travel.place_reviews` #1, `maps.places` #2
(both ✓), then `realestate.property_lookup`, `travel.aviation`, … `find` (all `via: travel.place_reviews`):

```
 1-2. stableapify.dev / apify-…vercel   Tripadvisor Reviews Scraper          [travel] ✓
 3.   x402.agentutility.ai/ecommerce-review-sentiment    Ecommerce review sentiment [shop] ✗
 4.   api.getanyapi.com/v1/run/maps.reviews   Google Maps Reviews             [maps]   ✓
 5.   mpp.orthogonal.com/reviews   Google Reviews                            [maps]   ✓
 6.   stabletravel.dev/api/hotels/ratings   hotel sentiment ratings           [travel] ✓
 7.   stableninja.dev/api/yelp/business-reviews   Yelp reviews                [~]
 8.   stableproduct.dev/api/wirecutter/reviews   Wirecutter product reviews   [shop]   ✗
 9.   apify-…vercel   Tripadvisor Reviews Scraper                            [travel] ✓
10.   api.cn402.com/ecom/reviews   Amazon product reviews by ASIN            [shop]   ✗ (cited in §Live evidence)
```

**turn this PDF into a short audio summary I can listen to** — `search` → `ai.text_to_speech` #1,
`ai.speech_to_text` #2, `ai.document_extract` #3, `devtools.pdf_manipulate` #4, `web.markdown_extract` #5,
`ai.llm_complete` #6, … (all three pipeline legs present: TTS #1, extract #3, llm #6). `find` →
**10/10 `via: ai.text_to_speech`** (klymax402, venice, jarvisclaw, xona, blockrun, omnicall, stablevoice,
glianalabs, agentutility, locus). Collapses to the *output* leg; `document_extract`/`llm_complete` never
appear. **This is a single-intent→pipeline decomposition gap, not a within-intent binding miss — the facet
work in this proposal does not address it.** (`oasis_search` exposes the legs; `oasis_find`/`oasis_next` is
where composition would have to live.)

Baselines clean: `weather`→`data.weather_forecast` (8/8 weather; one aviation TAF); `bitcoin`→
`finance.crypto_spot_price` (8/8 spot); `OCR`→`data.ocr` (OCR endpoints + one `qr-code-decode` at #6 — a
small same-mechanism wart in an otherwise clean bucket, corroborating the thesis rather than denying it).

### A.3 Control — the vector-search baseline's `search` (the three failing queries)

The baseline federates a much smaller, brand-curated catalog and returns its ranking signals inline: each hit
carries `vectorSimilarity` **and** `resourceUsage`/`originUsage` (`transactionCount`, `volumeUsd`,
`trustedUserUsageRatio`) — i.e. it ranks on a **popularity-aware blend**, the very signal OASIS documents as
intended-but-unbuilt (`select-policy.ts:125-131`; `docs/proposals/onchain-usage-ranking.md`).

**register a domain name for my startup** (26 hits):

```
 1. stabledomains.dev/api/register   REGISTER ✓   (score .293; vec-rank 4; origin 270 tx / $497 vol)
 2. x402helper.xyz/x402/startup-domain-check        availability + handle check
 3. x402helper.xyz/domains/register                 REGISTER ✓
 4. api.strale.io/x402/startup-domain-check          domain health/availability
 5. stableemail.dev/api/subdomain/buy                email subdomain
 6. stablefeedback.dev/api/namespace/register        namespace register  ← "register" keyword bleed
 7. stabledomains.dev/api/check                      availability check
 8. tempoid.xyz/api/mpp/register                     .tempo domain register ✓
 9-10. netintel / the-stall                          domain-availability checks
```

**Sharpest contrast — same endpoint, two rankers.** `stabledomains.dev/api/register` is in **both** indexes:
OASIS ranks it **#9**, the baseline **#1**. Inversely `the-stall …/domain-availability` is OASIS **#2** but
the baseline **#10**. OASIS's lexical-id ranker puts the *checker* above the *registrar*; the baseline's usage-blend
inverts it. But the popularity signal only *incidentally* separates the action (registrars happen to be more
used than checkers) — it is not a principled gate: the baseline still surfaces `namespace/register` (#6) and four
availability checkers. → **Typed binding (this proposal) and usage ranking (the deferred proposal) are
complementary levers**; the control exercises the second and still shows action-confusion.

**find restaurant reviews near my hotel** (8 hits): hotel-ratings #1, Resy restaurant *search/booking*
#2/#5/#8, nearby-hotels/POI #3/#4/#6/#7 — **no actual restaurant-review endpoint**, and the baseline's own
`vectorSimilarity` ranks are 57–78 (it knows these are weak). OASIS surfaces real review providers
(Tripadvisor, Yelp, Google/Maps) *with* product-review bleed. → Validates §"On 'just raise the spec-quality
bar'" point 2: OASIS's precision problem is the **cost of the recall** the narrow control simply lacks — less
breadth yields fewer wrong answers *and* fewer right ones.

**turn this PDF into a short audio summary** (32 hits): collapses to "audio **summarization**" —
`audio_summarize` #1/#2, `podcast_summarizer` #3, `book_summary` #4 — with the one real text→MP3 leg
(`mondello.dev/media/narrate`) at #5; no PDF-extract leg. → Both engines fail this query by collapsing a
3-step pipeline to a single capability (OASIS → TTS; the baseline → audio-summary), confirming it as an
orchestration gap independent of binding precision.

### A.4 Net

The symptom layer of this proposal is reproducible on the deployed tip and survives a cross-engine control.
The control adds two things: (a) a **same-endpoint registrar swing from rank 9 (OASIS) to rank 1 (the baseline)**
that a usage-aware blend buys — evidence the deferred popularity ranker is real headroom, complementary to
typing; and (b) confirmation that OASIS's breadth is the source of **both** its recall edge and its precision
tax — which is exactly why the fix is *type the endpoints and gate*, not prune the corpus.
