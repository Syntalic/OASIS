# Ontology Robustness Recommendations

Status: recommendation document, not an implemented schema change.

This note proposes how to evolve the OASIS ontology mechanism to improve **intent
precision**, **typed graph traversal**, and the discovery of **related capabilities**
and **related endpoints** — without turning the compact index into a heavy runtime
knowledge graph. It synthesizes a codebase audit (the `related[]` graph, the regex
matchers, the search scorer, the vector index) with an adversarially-judged design
pass over four independent proposals (object-graph-first, dataflow-pipeline-first,
retrieval-precision-first, minimal-incremental-first) and a completeness critique. The
critique materially **tempered** the design — it is reflected throughout (and in §13).

Constraints kept throughout: **task-only, vendor-neutral, read-only,
progressive-disclosure**, three record types (intents / endpoints / providers), and a
small embeddable `dist/` artifact.

> **TL;DR.** Move "aboutness" out of imperative code (regexes + score hacks) into
> declarative, build-validated data on the 47 intents. But **ship the cheap, verified
> wins first** — a `lanceKey` bug-fix, a referential-integrity gate, and hack deletion
> — and **build a multi-label eval before any new schema**, because the discovery and
> chaining goals are currently *unmeasurable*. Start with **2 facets and 3 link types**,
> not 5 and 6.

---

## 1. Diagnosis — what actually caps precision and discovery today

OASIS encodes *what an intent is about* in **three** brittle, hand-coded places, plus a
broken vector arm:

1. **47 per-intent regex matchers** (`src/intent-match.ts`, `INTENT_MATCHERS`) decide
   endpoint membership over `corpus() = path+summary+description+search_text+category`,
   with no shared vocabulary and **pairwise negative look-aheads** as the only
   disambiguation (`data.web_scrape` excludes `markdown|screenshot|proxy`;
   `ai.speech_to_text` excludes `tts`). New vendor phrasing silently fails
   (`matchEndpointsForIntent` returns `[]` with no fallback, and no report of endpoints
   that bound to nothing). This is O(n²): each new overlapping intent needs edits to
   *both* regexes' negative lists.
2. **Per-query score hacks** (`src/search.ts`, ≈L88–111) — literal
   `ai.web_research *0.25` / `search.web *1.35` on `serp|google`, and a
   `gas|fmv|trademark *0.15` penalty. `'announcements'` was added to a trigger to pass
   one eval row. A real query like *"research the Google antitrust case with citations"*
   is wrongly penalized 4× on `ai.web_research`.
3. **A third binding layer** (`src/ontology-expand.ts`, `inferCapabilityLinks`) tags
   endpoints by raw lowercase substring scan (`term.length ≥ 5`), **first-match-wins
   and order-dependent**, competing with the regexes as a second source of truth (alias
   `"best price"` substring-hits deal/price-history endpoints; whichever intent iterates
   first claims them).

Supporting weaknesses:

- **Vector index embeds capabilities only — a bug, not a design.** `LanceRecord.kind`
  is hard-typed `"capability"`, `buildLanceRecords` ignores endpoints even at
  `scope='all'`, and `search-hybrid.ts` `lanceKey` maps non-capability hits to an inert
  `other:` key the merger never resolves. Net: **~30k endpoints get zero semantic
  recall**; the vector arm can only re-rank the 47 intents keyword search already found.
- **Flat `2.2` capability multiplier** (`search.ts`) regardless of match confidence — a
  one-token capability hit (`~0.3 → 0.66`) can outrank a strongly-overlapping endpoint.
- **Substring token scoring + hand stopwords** (`scoreTokens`/`tokenize`): 0.5 credit
  for *any* substring overlap (`call`→`recall`), and `STOPWORDS` drops
  `paid, api, keys, agent` — the exact words of the "paid API without keys" framing.
- **Intent-agnostic endpoint ranking** (`score-endpoint.ts`): within an intent,
  `satisfies[]` is ordered by description length / input *count* / price / shallow path
  — no per-query relevance, so the verbose-but-wrong endpoint wins, and the depth bonus
  favors `/take` over `/v1/shopper/best-price`.

Every near-twin collision is **structurally identical**: two intents share the same
**input noun** and differ only on **output noun + format/freshness** — expressible
nowhere, so it leaks into regex negatives and string hacks.

The only intent↔intent link, `related[]`, is in poor shape: **present on only 11 of 47
intents**, untyped, **read by nothing in the ranker** (only `traversal.md` step 4, as a
blind fallback), and **4 of its edges are dangling** (`analyst.price_dispersion`,
`comms.buy_inbox`, `finance.crypto_market_data`, `marketing.brand_tracker` — provider/
tool names mistaken for intent ids). `src/validate.ts` is AJV-only and cannot catch them.

Finally, **the eval is 1:1 and overfit**: every row asserts exactly one `expect_intent`/
`expect_endpoint`, usually one query per intent, with no negatives, multi-intent, or
held-out paraphrases — so eval, alias, regex, and hack are mutually fitted, and green
metrics mask brittleness.

**Thesis of the fix:** make *aboutness* (typed input/output nouns + a couple of facets)
and *relationships* (typed links) first-class, **additive, optional** metadata; drive
matching, scoring, and traversal from it generically; retire the regexes, hacks, and the
substring tagger one at a time, eval-gated.

---

## 2. Design stance — "object-lite", shipped minimally

Keep the runtime artifact compact and the three-record model intact. The central choice:
**entities are a closed controlled vocabulary referenced by string facets — not new
ontology records.** This delivers Palantir-style typed nouns, typed links, and the
identifier/payload duality **without** an entity-instance store or an interfaces-as-records
layer. It is the middle between a full object graph and bare task strings.

Per the critique, **adopt the spine but ship ~40% less machinery than the full design**:
start with two facet axes and three link types (below); add the rest only when a measured
collision or a real escalation pair demands it.

> Reconciliation with earlier drafts: the **action frame**
> (`verb`/`object`/`result`/`freshness`) becomes `facets.action` + `consumes[]` +
> `produces[]` + `facets.freshness`; the **interface** idea becomes *shared entity +
> facet membership* (two intents are interface-compatible iff their ports unify) rather
> than separate interface records.

---

## 3. The collision map (11 clusters)

The headline four are the tip; the audit found **11 collision clusters**, each resolvable
on a missing facet. No single axis separates them — which is why facets must be orthogonal.

| Cluster | Intents | Resolves on |
|---|---|---|
| Web fetch | `data.web_scrape` · `web.markdown_extract` · `web.screenshot` | **output modality** (HTML / markdown / PNG), same input URL |
| Web discover | `search.web` · `ai.web_research` | **output modality** (SERP links vs cited answer) |
| Doc/text-from-pixels | `data.ocr` · `ai.document_extract` | **input + output structure** (photo→text vs PDF→fields) |
| Price quote | `finance.crypto_spot_price` · `finance.stock_quote` · `data.exchange_rates` | **entity** (coin / ticker / currency-pair) |
| Crypto/on-chain | `crypto_spot_price` · `token_balance` · `onchain_analytics` · `blockchain_rpc` | **entity × action** |
| Outbound comms | `send_email` · `send_sms` · `send_fax` · `voice_call` · `agent_inbox` | **channel modality** + send-vs-provision **action** |
| Audio/voice | `speech_to_text` · `text_to_speech` · `voice_call` | **direction/modality transform** |
| Identity/people | `person_search` · `influencer_search` · `company_enrich` · `media.social_data` | **entity × purpose** |
| Domain | `whois_lookup` · `cloud.domains` · `company_enrich` | **action** (read / provision / enrich) |
| Places | `maps.places` · `travel.place_reviews` | **purpose** (local resolution vs reviews) |
| Pricing intelligence | `compare_price` · `track_price_history` · `inflation_tracker` · `competitive_landscape` | **entity granularity × time axis** |

These map onto the **~13 parent→child groupings** in §4.4 where children differ on
exactly one facet (e.g. `web.fetch_url` → {scrape, markdown_extract, screenshot}).

---

## 4. Recommended primitives

### 4.1 Entity / object vocabulary (the missing noun layer)

A **closed enum** in `spec/entity-vocab.json` (versioned with `spec_version`), ~24 nouns,
each with a `role` and a `schema.org` crosswalk — activating the dormant `schema_org`
hook that **0 of 47 intents populate today**:

```jsonc
{ "spec_version": "0.2.0", "entities": {
  "Product":     { "role": "identifier", "schema_org": ["Product"] },
  "PriceSignal": { "role": "payload", "schema_org": ["PriceSpecification"],
                   "absorbs": ["PriceQuote","PriceHistory","InflationTrend"] },
  "Money":       { "role": "constraint", "schema_org": ["MonetaryAmount"] },
  "Query":       { "role": "identifier" },
  "Answer":      { "role": "payload", "absorbs": ["SearchResults","CitedAnswer","ComputedAnswer"] },
  "Webpage":     { "role": "identifier", "schema_org": ["WebPage"] },
  "WebContent":  { "role": "payload", "schema_org": ["CreativeWork"] },
  "Document":    { "role": "identifier", "schema_org": ["DigitalDocument"] },
  "Image":       { "role": "payload", "schema_org": ["ImageObject"] },
  "AudioClip":   { "role": "payload", "schema_org": ["AudioObject"] },
  "Text":        { "role": "payload", "schema_org": ["Text"] },
  "Contact":     { "role": "identifier", "absorbs": ["EmailAddress","PhoneNumber"] },
  "Message":     { "role": "payload", "absorbs": ["EmailMessage","SmsMessage","Fax","PhoneCall"] },
  "Location":    { "role": "identifier", "schema_org": ["Place","PostalAddress"] },
  "MarketQuote": { "role": "payload", "absorbs": ["StockQuote","CryptoPrice"] },
  "CryptoAsset": { "role": "identifier" }, "Domain": { "role": "identifier" }
  // ... ~24 total
}}
```

`role ∈ {identifier, payload, constraint}` is the identifier/payload duality. It powers
chaining (a `payload` of A flows into an `identifier` input of B) and the **constraint
guard** (`Money`-as-budget in `shop.find_deals` is never the primary noun). *Caveat
(critique): how `"airpods under $200"` gets `Money` tagged `constraint` vs `Product`
tagged `identifier` is slot-filling and is the hard part — it needs its own spec + eval
rows, not a one-line mention.*

### 4.2 Intent I/O contract + facets — the extended source schema

`consumes[]`/`produces[]` are typed **ports** (entity + role + format + cardinality).
`facets` adds query-side axes. `negative_terms[]` replaces scattered regex negatives.
**All new keys optional; the 47 existing YAMLs validate unchanged.**

```jsonc
// spec/ontology-source.schema.json — ADDITIVE; additionalProperties:false preserved
{
  "properties": {
    "id": {}, "label": {}, "description": {}, "aliases": {}, "schema_org": {},
    "consumes": { "type": "array", "items": { "$ref": "#/$defs/Port" } },
    "produces": { "type": "array", "items": { "$ref": "#/$defs/Port" } },
    "facets": { "type": "object", "additionalProperties": false, "properties": {
      "domain":   { "enum": ["shop","ai","data","web","comms","finance","maps","travel",
                             "realestate","social","media","marketing","analyst","cloud",
                             "compute","devtools","storage","search","crypto"] },
      "action":   { "enum": ["search","lookup","compare","extract","generate","transform",
                             "validate","send","provision","analyze","execute","monitor"] },
      "modality": { "type": "array", "items": { "enum": ["text","html","markdown","json",
                             "image","audio","vector","citations","timeseries"] } },
      "freshness":{ "enum": ["realtime","recent","historical","forecast","static"] } } },
    "negative_terms": { "type": "array", "items": { "type": "string" } },
    "links": { "type": "array", "items": { "type": "object", "additionalProperties": false,
      "required": ["type","to"], "properties": {
        "type": { "enum": ["alternative_of","sibling_of","pipes_to",
                           "narrower_of","broader_of","prerequisite_of"] },
        "to":   { "type": "string", "pattern": "^[a-z][a-z0-9._-]*$" },
        "note": { "type": "string" } } } },
    "related": { "type": "array", "items": { "type": "string", "pattern": "^[a-z][a-z0-9._-]*$" } }
    //          ^ DEPRECATED, still accepted; build coerces to links[type=sibling_of]
  },
  "$defs": { "Port": { "type": "object", "required": ["entity"], "additionalProperties": false,
    "properties": {
      "entity":      { "type": "string" },   // must resolve to entity-vocab
      "role":        { "enum": ["identifier","payload","constraint"] },
      "format":      { "type": "string" },   // e.g. html | markdown
      "cardinality": { "enum": ["one","many"], "default": "one" } } } }
}
```

**Facets must be orthogonal** — no single axis separates the clusters (`search.web` vs
`ai.web_research` share `domain+entity+freshness` and split only on output modality;
crypto/stock/fx share `action+freshness` and split only on entity). **But ship only the
two that carry measured weight first** (critique): `domain` + `consumes`/`produces.entity`
(+ `produces.format` for the output-modality twins). Defer `action`, `freshness`, and
`modality[]` until a collision needs them — backfilling 47 YAMLs × 5 axes is a large cost
for 2 axes of value, and `modality[]` is inert on the keyword path (tokens already in
aliases).

**Before / after** (`ontology/intents/web.markdown-extract.yaml`):

```yaml
# AFTER (additive)
schema_org: [CreativeWork]
consumes: [{ entity: Webpage, role: identifier }]
produces: [{ entity: WebContent, role: payload, format: markdown }]
facets:   { domain: web }                               # start minimal
links:    [{ type: narrower_of, to: data.web_scrape }]  # build auto-generates the broader_of inverse
# data.web-scrape.yaml gets produces:[{entity: WebContent, format: html}]
# -> the scrape/markdown collision is now a FORMAT difference, not a regex negative-lookahead.
```

### 4.3 Typed capability links — MVP three, plus deferred

| Link | Dir. | Tier | Semantics | Drives |
|---|---|---|---|---|
| `alternative_of` | symmetric | **MVP** | substitutable near-twins competing for the **same** query | Precision tie-break + "also consider" |
| `sibling_of` | symmetric | **MVP** | same-family co-hyponyms, **not** substitutable; coercion target for legacy `related[]` | Discovery (related-capabilities panel) |
| `pipes_to` (+ derived `fed_by` inverse) | directed | **MVP** | `produces[entity]` of A unifies `consumes[entity]` of B | Discovery + chaining; backward planning |
| `narrower_of` / `broader_of` | directed pair | *deferred* | general ↔ specific | prefer-narrower precision; broaden/drill nav |
| `prerequisite_of` | directed | *deferred* | A must run before B (gating) | plan ordering |

The critique pushes `narrower_of`/`broader_of` and `prerequisite_of` to *deferred*: the
catalog is 47 **atomic** single-action tasks (the same "too sparse" argument that kills
`part_of`), and `prerequisite_of` ("validate before you pay") edits toward the agent-policy
layer a read-only discovery standard should avoid — its cases (`email_validate →
send_email`) are already expressible as `sibling_of`/`pipes_to`. Add them only when a real
escalation/precondition pair appears. Earlier-draft names map in: `complements →
sibling_of`, `post_step →` inverse of `pipes_to`; external `*_match` links to schema.org
are dropped in favor of the per-entity `schema_org` crosswalk (§4.1).

### 4.4 Hierarchy groupings (documentation now, link types later)

Even before authoring `narrower_of`/`broader_of`, these **parent→child** groupings (children
differ on exactly one facet) make the catalog self-documenting and the disambiguator
obvious — and double as the high-value `alternative_of`/`sibling_of` seed set:

- `web.fetch_url` → web_scrape (HTML) · markdown_extract (markdown) · screenshot (PNG)
- `web.discover` → search.web (links) · ai.web_research (cited answer)
- `finance.market_quote` → crypto_spot_price · stock_quote · exchange_rates *(by entity)*
- `comms.outbound` → send_email · send_sms · send_fax · voice_call *(by channel)*
- `pricing.product` → compare_price · track_price_history · price_drop_alert *(by time axis)*
- `ai.media_transform` → image_generate · text_to_speech · speech_to_text · ocr · translate_text
- `identity.lookup` → person_search · company_enrich · influencer_search · email/phone/ip *(by entity)*
- `domain.registry` → whois_lookup (read) · cloud.domains (provision)
- `places.lookup` → maps.places (resolution) · travel.place_reviews (reviews)

### 4.5 Endpoint implementation edges — keep it light

Keep `endpoint.capabilities[]` as a fast reverse index. Make the canonical membership
carry only **`{ source, confidence }`** — `source ∈ {facet-gate, match_hint, curated}`,
reusing the **already-present-but-unused `SatisfiesRef.confidence`**. The critique
explicitly **rejects** full Wikidata-style provenance quads (`evidence[]`, `rank`) here:
membership is machine-regenerated every build over ~30k records, so `evidence[]` bloats
`dist/` for no agent-visible benefit and `rank:deprecated` duplicates the score threshold.

### 4.6 Derived facets + derived links (bounded)

- **`deriveEndpointFacets()`** — one pass in `build.ts` computing `domain` /
  `primary_entity` / `output_entity` / `modality` from `path+summary+description+inputs`.
  *Honest framing: this caches the existing path/summary signal — not new information.*
- **`derive-links.ts`** — O(47²) walk emitting `pipes_to` candidates where
  `produces[entity]` of A unifies `consumes[entity]` of B; authored links always win;
  derived edges tagged `derived:true` + `via_entity`. **Hub-explosion guard (critique):
  lock a concrete fan-out cap and a hub-suppression list before merge** — `Webpage`,
  `Query`, `Text`, `Location` each connect 8–12 intents pairwise; without a cap + a
  relevance score on derived edges, `fed_by` backward-planning returns noise and
  undermines the one affordance the design calls irreplaceable.

---

## 5. Mechanism changes (file-level)

- **`search-hybrid.ts` / `embed/lance-index.ts`** — *fix the `lanceKey`/capability-only
  bug first* (widen `LanceRecord.kind` to `capability|endpoint`, embed endpoints
  `summary+description+inputs` keyed `ep:`, resolve `ep:` keys). This is a pure bug fix,
  no schema change. Then add the **coarse hybrid pre-filter** (`domain`+`primary_entity`)
  before RRF — the highest-value, lowest-risk new-precision lever. *Caveat: vector is
  currently net-negative on capabilities; gate endpoint-embedding behind proof it beats
  keyword recall on a held-out split, don't ship it blind.*
- **`search.ts`** — replace the flat `2.2` with a **confidence-scaled** capability
  weight; replace 0.5-substring credit with **token-boundary stemming**; derive stopwords
  from IDF (stop dropping `paid/api/keys`). Add `inferQueryFacets` +
  **mismatch-demotion** (`facetMatchBoost`) and `negative_terms[]` (multiplicative `<1`,
  never hard-gate). A naive additive facet boost is inert; the *demotion-on-mismatch* is
  the new signal. Delete the ≈L88–111 hacks **only after** the pre-filter/`negative_terms`
  reproduce their pinned eval rows.
- **`intent-match.ts` + `ontology-expand.ts`** — unify the two competing binding layers
  into one **scored, thresholded, deterministic** binding ranked by confidence; keep each
  regex as an optional `match_hints` precision-booster, deleted per-intent only when
  facet-gating reproduces its prior `satisfies[]`. Emit an **unbound-endpoint report**.
- **`score-endpoint.ts`** — stays vendor-neutral but not *relevance*-neutral: blend the
  neutral quality prior with a per-query **input-identifier overlap** term (the only lever
  that moves `select@1`/resolve-rank). Today it counts `#inputs` but is blind to input
  *semantics*.

---

## 6. Typed traversal

Keep `search → resolve → schema → execute`; make `traversal.md` step 4 typed:

```text
FORWARD chain:  resolve data.web_scrape (produces WebContent)
                  -> pipes_to (via WebContent) -> ai.document_extract (produces StructuredRecord)
BACKWARD plan:  want ai.embeddings (consumes Text), hold a URL (Webpage)
                  -> fed_by = [web.markdown_extract, data.ocr] -> plan: markdown_extract -> embeddings
ALTERNATIVE:    resolve maps.places, no MPP rail -> alternative_of -> travel.place_reviews
SIBLING:        resolve comms.send_email -> sibling_of -> {send_sms, send_fax, voice_call}
RELATED EPs:    endpoint(data.web_scrape) --pipes_to--> ai.document_extract --satisfies--> endpoints[]
```

---

## 7. Precision wins, discovery wins — and what can't yet be measured

**Precision** (eval-measurable today on the 64-row + 656-row sets): the `lanceKey`
bug-fix + coarse pre-filter; output-modality mismatch-demotion on the Webpage trio;
`primary_entity` separating OCR (Image) vs document-extract (Document); input-identifier
overlap moving resolve-rank; confidence-scaled multiplier + token-boundary matching
removing two noise sources; referential-integrity removing dangling traversal targets.

> **Honest ceiling:** the keyword eval is near-saturated; most levers are precision-*neutral
> refactors* (replace hacks with data, hold baseline). The real new gains are the
> `lanceKey` fix, the coarse pre-filter, and resolve-rank.

**Discovery** (`pipes_to`/`fed_by`/`sibling_of`/`alternative_of`): high value but —
**critical caveat from the critique** — the current eval is single-label 1:1 and **cannot
measure any of it**. Every discovery claim is unfalsifiable until a multi-label eval
exists (§10). Build the instrument *before* shipping the link taxonomy.

---

## 8. Coverage gaps (intent catalog)

The audit surfaced demand-heavy tasks with **no intent** — orphaning catalog endpoints the
matchers already negative-look-ahead away:

- **Payments / checkout / refund** — the repo is about agentic **commerce** on x402/MPP
  rails yet has **only price discovery, no buy/pay/refund intent.** Biggest gap vs the
  stated mission.
- **Calendar / scheduling**, **maps routing / geocoding / ETA**, **news search**,
  **image / reverse-image search**, **video/audio generation beyond TTS**, **rerank**
  (the RAG companion to `ai.embeddings`), **document *generation*** (HTML→PDF), **sentiment
  / NER / text classification**, **KYC / identity & sanctions screening**, **in-stock /
  inventory checking** (sibling to the `shop.*` pricing cluster).

---

## 9. Validation rules (build-time, before publishing `dist/`)

1. **Referential integrity** — resolve every `links[].to`, `related[]` entry, and
   `consumes/produces.entity`. **ID-normalization trap (critique):** filenames use hyphens
   (`shop.compare-price.yaml`), the `id:` field and all refs use underscores
   (`shop.compare_price`), and `cloud.domain-manage.yaml` has `id: cloud.domains` — resolve
   against the in-file `id:`, never the filename, and keep the three id grammars straight
   (CamelCase entities, dotted-snake intent ids, lowercase link targets).
2. Auto-generate inverses; enforce symmetry for `alternative_of`/`sibling_of`.
3. `pipes_to` flow-consistency lint (producer's `produces[]` ∩ consumer's `consumes[]`).
4. Entity-tag plausibility check (the enum validates vocabulary, not whether `Text` is the
   *right* tag — else mis-tags rot silently).
5. WARN during authoring; flip to ERROR after backfill.

---

## 10. Evaluation overhaul (the long pole — do this first)

The single biggest gap: the eval **cannot measure the owner's #2/#3 goals**. Before any
facet code:

- Define the **multi-label / chaining eval schema** — `expect_intents[]`,
  `expect_related[]`, `expect_next[]` (chain), and **hard negatives** (queries containing
  a *wrong* intent's trigger tokens), authored by a different person than the aliases.
- Add a **facet-inference-coverage** metric (% of queries that get a confident
  entity/facet tag) to gate the precision levers — the apparatus is alias-driven and has
  an unknown firing rate on unseen queries (cold-start).
- **Gate on BOTH eval files**, including `eval/queries.json` (**656 rows**, 10× larger) —
  stemming/stopword/multiplier changes are exactly the global edits that regress a large
  set while passing the curated 64.
- Metrics: `intent@k`, `endpoint_recall@k`, `related@k`, `chain_success@k`,
  `facet_coverage`, `unresolved_link_count`.

---

## 11. Risks & open design traps

- **Consumer contract / versioning** — adding `facets`/`consumes`/`produces`/`links` to
  emitted `dist/capabilities.json` changes the public contract of an **open standard**.
  Specify what appears in `dist/`, bump `spec_version`, and define how a v0.1 agent behaves
  when `links[]` appears. (Entities stay out of `dist/`.)
- **External vocabulary alignment** — align `facets.action` to **schema.org Actions /
  potentialAction** (a real crosswalk, not a private enum) and align the `Port` shape to
  **JSON-Schema / MCP tool-definition** conventions that downstream x402/MPP agents already
  consume; `consumes`/`produces` are conceptually tool input/output schemas.
- **Cold-start firing rate**, **constraint-guard slot-filling**, and **derived-edge
  hub-explosion** are all under-specified precision/discovery risks (see §4.1, §4.6, §10).

---

## 12. Phased roadmap — three tranches (not six phases)

**Tranche A — pure ROI, zero schema risk (week 1).**
1. `validate.ts` referential-integrity gate (WARN; resolve against in-file `id:`; fix the 4
   dangling refs in place).
2. **Fix the `lanceKey`/capability-only vector bug** (widen `kind`, embed + resolve `ep:`
   keys) — a verified bug giving 30k endpoints zero recall; day-one, no schema change.
3. Delete the ≈L88–111 literal hacks **only after** the coarse pre-filter / `negative_terms`
   reproduce their eval rows. All measurable on the existing 64-row eval.

**Tranche B — precision movers, gated on a NEW eval.** Build the multi-label / adversarial
/ paraphrase eval + facet-coverage metric **first** (the only instrument that can prove B/C
worked). Then ship the verified movers only: coarse (`domain`+`primary_entity`) hybrid
pre-filter, `negative_terms[]` mismatch-demotion, confidence-scaled multiplier, token-boundary
stemming. Backfill **only `domain` + `consumes`/`produces.entity`** on the 47 intents.

**Tranche C — discovery, last.** Author `alternative_of` + `sibling_of` (highest value,
cheapest); coerce `related[]`→`sibling_of`; then derived `pipes_to`/`fed_by` **with the
fan-out cap + hub-suppression locked**; then the typed `traversal.md` rewrite. **Defer**
`prerequisite_of`, `narrower_of`/`broader_of`, satisfies-provenance quads, and full endpoint
embedding until a measured need appears.

---

## 13. Deliberately rejected / cut as over-engineering

From the design and sharpened by the critique:

1. **Entity *records* / instance store** — entities stay a closed string vocabulary.
2. **Palantir "actions" (writeback / mutable state)** — breaks read-only.
3. **`part_of`/`has_part`** — too sparse in a 47-node atomic catalog.
4. **The full 52-noun catalog** — collapsed to ~24; the discriminator lives in
   `format`/`modality`, not the entity id.
5. **Five-axis facets** → ship **two** (`domain` + `consumes`/`produces.entity`); the other
   three carry no measured weight yet.
6. **Six link types** → ship **three** (`alternative_of`, `sibling_of`, `pipes_to`/`fed_by`);
   `narrower/broader` + `prerequisite_of` deferred.
7. **Wikidata-style provenance quads on `satisfies[]`** → cut to `{source, confidence}`.
8. **Embedding all 30k endpoints in the same phase** → gate behind proof it beats keyword
   recall (vector is currently net-negative); the cheap fix is the `lanceKey` bug + pre-filter.
9. **A pure specificity-scalar tie-break** → replaced by facet-agreement (handles
   `search.web ⊥ ai.web_research` both directions).
10. **Naive additive facet boost on keyword path** → kept only mismatch-demotion + the
    coarse hybrid pre-filter.
11. **Big-bang regex replacement** → regexes become optional `match_hints`, removed
    one-at-a-time, eval-gated.

---

## 14. Open questions

1. Do generated/provider-derived capabilities participate in traversal, or only curated?
2. Does `satisfies[]` stay embedded, or become a generated view over implementation edges?
3. Entity-vocab governance — who owns adding a noun and reviewing the schema.org crosswalk?
4. Should `facets.action` be a private enum or a hard schema.org Actions crosswalk?
5. How is the payments/checkout gap (§8) reconciled with read-only discovery — discover-only,
   or a new `execute`-class intent family?

---

## 15. References (external grounding)

- **Palantir Foundry / AIP Ontology** — [Overview](https://www.palantir.com/docs/foundry/ontology/overview),
  [Object types](https://www.palantir.com/docs/foundry/object-link-types/object-types-overview),
  [Link types](https://www.palantir.com/docs/foundry/object-link-types/link-types-overview),
  [Action types](https://www.palantir.com/docs/foundry/action-types/overview),
  [Interfaces](https://www.palantir.com/docs/foundry/interfaces/interface-overview),
  [Shared properties](https://www.palantir.com/docs/foundry/object-link-types/shared-property-overview);
  semantic/kinetic/dynamic layers ([explainer](https://pythonebasta.medium.com/understanding-palantirs-ontology-semantic-kinetic-and-dynamic-layers-explained-c1c25b39ea3c)).
- **SKOS** — [Reference](https://www.w3.org/TR/skos-reference/) (broader/narrower/related,
  mapping properties, S27 disjointness), [Primer](https://www.w3.org/TR/skos-primer/).
- **schema.org Actions** — [Actions design doc](https://schema.org/docs/actions.html),
  [Action](https://schema.org/Action), [EntryPoint](https://schema.org/EntryPoint)
  (agent/object/result/instrument, potentialAction, -input/-output).
- **OWL object properties** — [OWL Reference](https://www.w3.org/TR/owl-ref/) (domain/range,
  inverseOf, characteristics), [Common Errors in OWL](https://protege.stanford.edu/conference/2004/slides/6.1_Horridge_CommonErrorsInOWL.pdf),
  [OBO modelling with object properties](https://oboacademy.github.io/obook/lesson/modelling-with-object-properties/).
- **Wikidata statement model** — [Data model](https://www.wikidata.org/wiki/Wikidata:Data_model),
  [Qualifiers](https://www.wikidata.org/wiki/Help:Qualifiers),
  [Statements/rank](https://www.wikidata.org/wiki/Help:Statements).
- **Ontology engineering** — [Ontology Development 101 (Noy & McGuinness)](https://protege.stanford.edu/publications/ontology_development/ontology101.pdf),
  [Competency Questions survey (2023)](https://link.springer.com/chapter/10.1007/978-3-031-47262-6_3).
- **Faceted classification** — [Overview](https://en.wikipedia.org/wiki/Faceted_classification),
  [Hedden](https://www.hedden-information.com/faceted-classification-and-faceted-taxonomies/),
  [Slavic (arXiv)](https://arxiv.org/pdf/1705.07047).
- **Agent tool discovery / Tool-RAG** — [RAG-MCP (arXiv:2505.03275)](https://arxiv.org/abs/2505.03275),
  [Toolshed (arXiv:2410.14594)](https://arxiv.org/abs/2410.14594),
  [Tool RAG (Red Hat)](https://next.redhat.com/2025/11/26/tool-rag-the-next-breakthrough-in-scalable-ai-agents/),
  [Progressive discovery vs semantic search (Speakeasy)](https://www.speakeasy.com/blog/100x-token-reduction-dynamic-toolsets).
- **Service ontologies / intent NLU** — [OWL-S vs WSMO vs METEOR-S](https://pbour.github.io/docs/SWS_Conceptual_Comparison.pdf),
  [Joint intent + slot-filling survey (ACM)](https://dl.acm.org/doi/10.1145/3547138),
  [Entity linking](https://en.wikipedia.org/wiki/Entity_linking).
- **Hybrid retrieval** — [Vector search filtering (Qdrant)](https://qdrant.tech/articles/vector-search-filtering/),
  [Reciprocal Rank Fusion](https://spice.ai/learn/reciprocal-rank-fusion).

---

## Summary recommendation

Give intents a **typed I/O contract + a couple of facets** and the graph **typed, validated
links** — additive, optional metadata that lets matching/scoring/traversal run generically
and retires the regexes, score hacks, and substring tagger eval-gated. But **lead with the
cheap, verified wins**: the `lanceKey` bug-fix, the referential-integrity gate, and hack
deletion (Tranche A), and **build a multi-label eval before any new schema** — the discovery
and chaining goals are currently unmeasurable. Start with **2 facet axes and 3 link types**,
defer the rest, and keep endpoint membership light (`{source, confidence}`). This turns OASIS
from a flat task taxonomy into a navigable capability graph while staying lightweight,
vendor-neutral, and read-only — and it confronts the strategic gap that an agentic-commerce
standard today has no checkout/payment intent.

---

*Provenance: synthesized from a codebase audit (`intent-match.ts`, `search.ts`,
`score-endpoint.ts`, `ontology-expand.ts`, `embed/lance-index.ts`, the `related[]` graph) and
an adversarially-judged design pass over four independent proposals plus a completeness
critique. Winner: retrieval-precision-first; the critique tempered the design (§13) and
re-sequenced delivery (§12). External grounding in §15.*
