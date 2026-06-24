# OASIS Next — Entity Model Spec

> **Parent:** [00_oasis-next-blueprint.md](./00_oasis-next-blueprint.md) · **Component:** A (Ontology entity model)
>
> **Status:** draft. This is the gating design — if A is wrong, B/C/D wobble.

---

## 0. Purpose

The entity model is the substrate for `oasis_next`. Every follow-up suggestion must answer:

> *"Does the agent hold an entity that this capability consumes?"*

Today the closed vocab in `spec/entity-vocab.json` exists and `consumes`/`produces` ports are typed, but the vocabulary is too fragmented and too coarse in the wrong places for cross-domain bridges to light up. The grounding pass (2026-06-24) found:

- **Over-coarse:** 15 of 56 intents consume `Query`, which connects everything to everything and carries no investigative signal.
- **Over-fragmented:** place-like entities split across `Location`, `Place`, `PostalAddress`, `GeoCoordinates` with inconsistent `role` (identifier vs payload).
- **Under-connected:** genuinely bridgeable entities (`Company`, `Place`, `CryptoAsset`) are either buried under `Query` or named inconsistently, so lateral traversal cannot fire.

This spec defines the canonical entity set (A1), subtype graph (A2), re-typing rules (A3), and vocab/validation changes (A4).

---

## 1. Design principles

1. **Model domain nouns, not wire formats or capability names.** Entities name what exists in the world (`Place`, `Company`, `WeatherReport`) — never what an API returned (`StructuredRecord`) or which intent ran (`company_enrich_result`). Capabilities are the kinetic layer; entities are the semantic layer.
2. **Identity ≠ observation.** *Identity* entities are the things an investigation pivots on (`Place`, `Company`, `Person`). *Observation* entities are measurements or enrichments *about* an identity (`WeatherReport`, `PriceSignal`, `EconomicIndicator`). Lateral bridges fire on **identity only** — an agent investigates *through* a Place, not through a weather payload.
3. **Granularity for bridges, not for domains.** Identity entities should be coarse enough to span domains (`Place` bridges weather, civic, travel, real estate) but fine enough to exclude noise (`Query` is not a bridge).
4. **Identifier vs payload is about chaining, not taxonomy.** `role` governs whether entity A's output can flow into entity B's input (`payload` → `identifier`). Compatibility matching (A2) is orthogonal.
5. **Absorption, not explosion.** Prefer `absorbs` in `entity-vocab.json` over near-duplicate top-level entities.
6. **Re-type, don't hand-link.** Derive forward/lateral edges from entity flow at build time. Authored `links:` remain for human-curated exceptions (`alternative_of`, `sibling_of`) only.

---

## 2. A1 — Canonical entity set

Entities are split into three roles in the vocab:

| Kind | Purpose | On consumes/produces ports? | Lateral bridge? |
|------|---------|----------------------------|-----------------|
| **identity** | Real-world thing the agent pivots on | ✅ | ✅ when `bridge_eligible` |
| **observation** | Measurement/enrichment *about* an identity | ✅ (usually `produces`) | ❌ — forward chain only |
| **abstract** | Compatibility class for subtype matching | ❌ **never** | ❌ |

### 2.1 Identity entities (consolidation map)

| Entity | Subsumes (→ §3.1) | Role default |
|--------|-------------------|--------------|
| **Place** | `Location`, `PostalAddress`, `GeoCoordinates`, `City`, `Region` | `identifier` when consumed; `payload` when produced |
| **Company** | `Brand` | `identifier` or `payload` |
| **Person** | — | `identifier` or `payload` |
| **Product** | — | `identifier` |
| **ProductCategory** | — | `identifier` |
| **CryptoAsset** | — | `identifier` |
| **WalletAddress** | — | `identifier` |
| **Domain** | — | `identifier` |
| **Topic** | — | `identifier` (NL port, not a bridge) |

Which identities are lateral bridges, and to which domains, is the consume-side map in §2.1a. (Subsumption is defined once in `entity-subtypes.json` — §3.1 — not duplicated as `absorbs`.)

### 2.1a Which identities bridge (consume-side map)

A lateral bridge exists only where an identity is **consumed**. For each identity, the intents that consume it (after A3 re-typing) and their domains are below — an identity is a v1 lateral bridge only if its consumers span **≥2 domains without derivation**. A held identity whose target consumes a *different real-world key* (a Company name vs `Domain`, a coin vs `WalletAddress`) is **not** a type bridge (see §4.4). `bridge_eligible` and the E1 fixtures follow this table.

| Held identity | Post-A3 consumers (intent → domain) | Distinct domains | v1 |
|---|---|---|----|
| **Place** | weather_forecast→data, gov_civic→data, places→maps, geocode→maps, place_reviews→travel, property_lookup→realestate | data, maps, travel, realestate (**4**) | ✅ **flagship** |
| **ProductCategory** | find_deals→shop, competitive_landscape→marketing, inflation_tracker→analyst | shop, marketing, analyst (3) | ✅ |
| **Company** | social_data→media, person_search→data, job_search→data | media, data (2) | ✅ (needs re-type of those 3 consume ports) |
| **Person** | person_search→data, influencer_search→social | data, social (2) | ✅ |
| **Domain** | whois_lookup→data, company_enrich→data, cloud.domains→cloud | data, cloud (2) | ✅ |
| **CryptoAsset** | crypto_spot_price→finance, trading_signals→finance; onchain/rpc need Wallet/Network (derivation) | finance only | ⛔ defer |
| **WalletAddress** | token_balance→finance, onchain_analytics→finance | finance only | ⛔ defer |

**v1 lateral scope = {Place, ProductCategory, Company, Person, Domain}.** Crypto/Wallet are deferred: their only cross-domain hops (onchain analytics, blockchain RPC) need an identity→identifier *derivation* (coin → wallet/network) that pure type-matching cannot do (§4.4).

### 2.2 Observation entities (new + existing)

Observations are typed capability **outputs**. They forward-chain to downstream processors but do **not** seed lateral investigation — the agent must retain (or re-declare) the underlying identity.

| Entity | Kind | Use when | Example intent |
|--------|------|----------|----------------|
| **WeatherReport** | observation *(new)* | Forecast/conditions returned for a Place | `data.weather_forecast` |
| **PriceSignal** | observation | Price quotes, history, competitive scans, category inflation | `shop.compare_price`, `marketing.competitive_landscape`, `analyst.inflation_tracker` |
| **EconomicIndicator** | observation | Macro/regional trend data | `finance.economic_data` |
| **MarketQuote** | observation | Stock/crypto spot quotes | `finance.stock_quote`, `finance.crypto_spot_price` |
| **TradingSignal** | observation | Buy/sell signals | `finance.trading_signals` |
| **Answer** | observation | NL search/research results | `search.web`, `ai.web_research` |
| **GovernmentService** | observation | Civic service lookup results | `data.gov_civic` |
| **DnsRecord** | observation | WHOIS/DNS payloads | `data.whois_lookup` |
| **SocialProfile** | observation | Social metrics/profile data | `media.social_data` |
| **ScientificEntity** | observation | Papers, genes, compounds | `data.scientific_lookup` |
| **CodeRepository** | observation | Repo metadata | `data.code_repository` |

Add new observation types only when an output is semantically distinct **and** reused by ≥2 capabilities. One-off shapes do not get a new entity — tighten the closest observation or the identity produce.

### 2.3 No broad compatibility markers in v1

v1 uses **no broad compatibility markers** — a `NamedEntity`/`Org` matching root re-creates the `Query` hairball one level up (§3.4). Compatibility is **narrow absorption only** (place family → `Place`; `Brand` → `Company`).

**Hard rule (retained as a forward guard):** `oasis_validate` **errors** if any `abstract: true` entry appears in `consumes` / `produces`. v1 ships **no** abstract entities, so consumer ports use concrete identities (`Company`, `Place`) or the deliberate NL port (`Query` / `Topic`).

### 2.4 Escape hatches (restricted)

| Entity | Status | Rule |
|--------|--------|------|
| **Query** | last-resort NL consume only | `bridge_eligible: false`; never a lateral bridge |
| **StructuredRecord** | **deprecated** on ports | Existing uses must migrate in A3; validator errors on new/edited intents. Unstructured blobs belong in observations or identity payloads, not a generic record type. |

### 2.5 Payload / media entities (unchanged)

These are well-typed, domain-specific, and generally forward-chain only:

`Money`, `Currency`, `Webpage`, `WebContent`, `Document`, `Image`, `AudioClip`, `Text`, `Embedding`, `Contact`, `Message`, `BlockchainNetwork`, `IpAddress`, `PredictionMarket`, `MemoryKey`, `MemoryEntry`, `AgentProfile`, `Mailbox`

### 2.6 Entities to deprecate as top-level ports (migrate → canonical)

| Deprecated port entity | Migrate to | Notes |
|------------------------|------------|-------|
| `Location` | `Place` | identity consume |
| `PostalAddress` | `Place` | identity consume |
| `GeoCoordinates` | `Place` | identity produce (coordinates are place data) |
| `StructuredRecord` | identity or observation per §4.1 | e.g. weather → `WeatherReport` |
| `SearchResults`, `CitedAnswer`, `ComputedAnswer` | absorbed under `Answer` | already in vocab |
| `PriceQuote`, `PriceHistory`, `InflationTrend` | absorbed under `PriceSignal` | already in vocab |

### 2.7 The `Query` rule

`Query` remains in the vocab for capabilities that truly take unstructured natural language and produce unstructured results (web search, LLM completion, influencer search). Rules:

- **Do not use `Query` when a typed entity applies.** If the agent holds or the capability produces `Place`, `Company`, `Product`, etc., that entity must appear on the port.
- **Do not traverse laterally on `Query`.** The engine (see [02_oasis-next-engine.md](./02_oasis-next-engine.md)) excludes `Query` from the lateral index.
- **May traverse forward on `Query` only when paired with a typed produce.** e.g. `maps.places` may keep `Query` as consume if we decide NL place search is irreducibly query-shaped, but it *produces* `Place` — and lateral fires on `Place`, not `Query`.

---

## 3. A2 — Entity compatibility graph

Subtype parents are **compatibility classes for port matching**, not business taxonomy. A parent means "a capability consuming the parent accepts a held child" — a `Place` consumer accepts a held `PostalAddress`. **v1 keeps this deliberately narrow** (see §3.4): only the place family collapses to `Place` and `Brand` to `Company`; there is **no broad root** that lets unrelated identities match.

### 3.1 Graph definition

Stored in `spec/entity-subtypes.json` (new file), validated at build time. **v1 is narrow on purpose** (§3.4): only the place family and `Brand` have a parent; every other identity matches **exactly itself**.

```json
{
  "spec_version": "0.1.0",
  "subtypes": {
    "PostalAddress": { "parent": "Place" },
    "GeoCoordinates": { "parent": "Place" },
    "Location": { "parent": "Place" },
    "City": { "parent": "Place" },
    "Region": { "parent": "Place" },
    "Brand": { "parent": "Company" }
  }
}
```

`Person`, `Topic`, `Product`, `ProductCategory`, `CryptoAsset`, `Domain`, `WalletAddress`, `Ticker` are **top-level** — no parent, no broad root. (`Ticker` is equities-only — `finance.stock_quote` — and is **not** a `CryptoAsset`.)

### 3.2 Matching semantics

A consumer port **X** accepts a held entity **Y** iff **`Y == X`** OR **`parent(Y) == X`** (one hop up to the canonical parent). **No** transitive climb through a shared abstract root — that is the hairball (§3.4).

Examples:

| Consumer port | Held entity | Match? | Why |
|---------------|-------------|--------|-----|
| `Place` | `PostalAddress` | ✅ | `parent(PostalAddress) == Place` |
| `Place` | `GeoCoordinates` | ✅ | place family |
| `Company` | `Brand` | ✅ | `parent(Brand) == Company` |
| `Company` | `Company` | ✅ | exact |
| `Topic` | `Company` | ❌ | no god-marker; "search the web for the company" is the **skill's** job, not a lateral hop (§3.4) |
| `Product` | `Company` | ❌ | different identities |
| `Place` | `WeatherReport` | ❌ | observation ≠ identity |
| `Query` | `Place` | ❌ | `Query` is outside the graph |

### 3.3 `absorbs` vs `subtypes`

- **`absorbs`** (in `entity-vocab.json`): synonym collapse — bidirectional equivalence for matching.
- **`subtypes`** (in `entity-subtypes.json`): upward compatibility only — consumer port is the target class.

During migration, an entity listed in both `absorbs` and `subtypes` resolves to the canonical parent. After A3 lands, remove absorbed names from intent YAML ports.

### 3.4 Why no broad compatibility root in v1

v1 uses **no broad compatibility root** (`NamedEntity` / `Org`), for two reasons:

1. **It re-creates the `Query` hairball one level up.** If `Company`, `Person`, `Product`, `Topic`, … all subtype `NamedEntity`, then *every* `Topic`/`Query`-consuming search/research intent becomes a lateral target for *every* held identity — the signal-free sprawl this redesign exists to kill.
2. **The engine can't realize it cleanly.** Traversal ([02 §2.2](./02_oasis-next-engine.md)) matches by directional set-intersection; `Company` and `Topic` meet *only* at the excluded abstract `NamedEntity` — so broad matching is possible only *through* a marker that is banned from ports.

So v1 lateral matching is **exact-identity + narrow place/brand absorption only**. The genuinely useful "hold a `Company` → search/research the web about it" follow-up is handled by the **skill** ([04](./04_oasis-next-skill.md)): the agent passes the company name to `oasis_find` as a query. A *narrow, explicit* `Company → Topic` compatibility (a single declared edge, never a god-marker) is a **v2** candidate, gated on the over-firing eval (E2) showing lateral precision holds.

---

## 4. A3 — Re-typing the 56 intents

### 4.1 Re-typing rules (decision tree)

Work **consumes** and **produces** separately. Ask: is this port an **identity** the agent pivots on, an **observation** about an identity, or genuinely unstructured NL?

**Consumes (inputs):**

1. Geographic input (city, address, coordinates, ZIP) → `Place` / `identifier`
2. Company / brand / org identifier → `Company` / `identifier`
3. Person name or profile handle → `Person` / `identifier`
4. Product SKU, URL, or name → `Product` / `identifier`
5. Category / market segment → `ProductCategory` / `identifier`
6. Crypto token or contract → `CryptoAsset` / `identifier`
7. Wallet or on-chain address → `WalletAddress` / `identifier`
8. Hostname → `Domain` / `identifier`
9. Output of a prior capability in the same chain → matching **observation** entity / `identifier` (e.g. consume `PriceSignal` after a price scan)
10. Genuinely free-text NL with no typed referent → `Query` / `identifier` (document why in PR)

**Produces (outputs):**

1. Returns a real-world thing the agent can pivot on → **identity** / `payload` (`Place`, `Company`, `Person`, …)
2. Returns a measurement, enrichment, or lookup result *about* an input identity → **observation** / `payload` (`WeatherReport`, `PriceSignal`, `Answer`, …)
3. Never `StructuredRecord` — pick the closest identity or observation. If the agent would say "I now have a Company," produce `Company`; if "I have the forecast," produce `WeatherReport`.
4. Never name produces after the capability (`company_enrich_result` ✗).

### 4.2 High-priority migrations (bridge unlockers)

These consume-port re-types are what make each v1 identity consumable — they are the gate for E1, listed by the bridge they unlock.

| Intent | Consume: current → v1 | Bridge |
|--------|-----------------------|--------|
| `data.weather_forecast` | `Location` → `Place` | Place |
| `data.gov_civic` | `PostalAddress` → `Place` | Place |
| `maps.geocode` | `PostalAddress` → `Place` | Place |
| `realestate.property_lookup` | `Location` → `Place` | Place |
| `travel.place_reviews` | `Query` → `Place` | Place |
| `maps.places` | `Query` (keep) — but **must produce `Place`** | Place (on produce) |
| `media.social_data` | `Query` → `Company` / `Person` | Company / Person |
| `data.person_search` | `Query` → `Person` (also accepts `Company`) | Person, Company |
| `data.job_search` | `Query` → `Company` / `ProductCategory` | Company |
| `shop.find_deals` | `ProductCategory` (keep) | ProductCategory |
| `marketing.competitive_landscape` | `ProductCategory` (keep) | ProductCategory |
| `analyst.inflation_tracker` | `ProductCategory` (keep) | ProductCategory |
| `data.company_enrich` | `Domain` (keep; produces `Company`) | Domain consume; `Company` source — held `Company`→enrich needs derivation (§4.4) |
| `data.whois_lookup` | `Domain` (keep) | Domain |
| `cloud.domains` | `Domain` (keep) | Domain |
| `finance.crypto_spot_price` | `CryptoAsset` (keep) | crypto lateral deferred (§2.1a) |
| `search.web` | `Query` (keep) | none — excluded from lateral |

Produce re-types (e.g. weather → `WeatherReport`, geocode/places → `Place`, `StructuredRecord` → a real observation/identity) follow §4.1, but **v1 lateral fires on consume, not produce** — forward-on-observation is deferred (see [00](./00_oasis-next-blueprint.md)).

### 4.3 Fan-out execution

Once A1/A2 are frozen, re-type intents in parallel (one agent per domain cluster):

| Cluster | Intents | Owner |
|---------|---------|-------|
| maps + travel + realestate | 4 | place family |
| shop + marketing + analyst | 6 | commerce |
| finance + crypto + compute | 8 | markets |
| data | 14 | enrichment / lookup |
| ai + search + web | 10 | NL-heavy (Query decisions) |
| comms + media + social | 8 | people / orgs |
| agent + devtools + storage + cloud | 6 | infra |

Each PR must pass `oasis_validate` and the bridge scenarios in [05_oasis-next-validation.md](./05_oasis-next-validation.md) §2.

### 4.4 Identity→identifier derivation (deferred to v2)

Some investigative hops cross *different real-world keys*: a held `Company` (a name) vs `data.company_enrich`, which consumes a `Domain` (a hostname); a held `CryptoAsset` (a coin) vs `finance.onchain_analytics`, which consumes a `WalletAddress`. Type-matching on consume/produce ports cannot bridge these — a name is not a domain, a coin is not a wallet.

v1 does **not** model derivation: these are simply not lateral bridges, and the dependent scenarios (crypto on-chain, company-domain enrichment) are out of v1 scope (§2.1a). A `resolves_to` relation (`Company ⇒ Domain`, `CryptoAsset ⇒ {WalletAddress, BlockchainNetwork}`), expanded over held identities before matching, is the v2 mechanism — taken up once the over-firing eval (E2) shows v1 lateral precision holds.

### 4.5 Authored links after re-typing

- **Keep:** `alternative_of`, `sibling_of` — human judgment, not derivable from entity flow.
- **Demote:** `pipes_to` in `ontology/inferred-links.json` — superseded by engine-derived edges; keep file for audit but stop merging into `oasis_next` output path.
- **Auto:** `fed_by` inverses generated at materialize remain for `oasis_resolve` `related[]`, but are not the investigative substrate.

---

## 5. A4 — Vocab + validation

### 5.1 `spec/entity-vocab.json` changes

1. Bump `spec_version` → `0.3.0`.
2. Add optional fields per entity: `kind: identity | observation | abstract`, `bridge_eligible: boolean`.
3. Add `Place` as canonical identity (merge `Location` into `absorbs`).
4. Add `WeatherReport` as observation (`bridge_eligible: false`).
5. No abstract markers (`NamedEntity`, `Org`) — v1 compatibility is narrow absorption only (§3.4).
6. Add `Topic`, `Brand` as concrete vocab entries.
7. Mark `Location` absorbed by `Place`; mark `StructuredRecord` deprecated (`kind: observation`, error on new port use).
8. Set `bridge_eligible: false` on `Query` and all observation entities.

### 5.2 `spec/entity-subtypes.json` (new)

As defined in §3.1. Referenced by `ontology-source.schema.json` optionally (subtype parents must exist in vocab).

### 5.3 Validation extensions

**`validate-source.ts`:**

- Reject unknown entities (unchanged).
- **Error** when `abstract: true` / `kind: abstract` entities (`NamedEntity`, `Org`) appear on ports.
- **Error** when `StructuredRecord` appears on new/edited intents.
- Warn when `Query` is used but a typed entity from §4.1 clearly applies.
- Warn when deprecated identity aliases appear on ports (`Location`, `PostalAddress`).
- Warn when an observation is the *only* produce and no identity is produced alongside it *and* the capability clearly returns a pivot noun (re-type to identity).

**`validate.ts` (bundle integrity):**

- Extend `pipes_to_flow` lint to use compatibility expansion (not just exact entity match).
- New lint `bridge_entity`: intent has only `Query` / observation ports and no identity ports — flagged for re-type.
- New lint `subtype_unknown`: `entity-subtypes.json` references missing vocab entry.
- New lint `abstract_on_port`: abstract marker used in consumes/produces.

### 5.4 Build artifact

`dist/entity-index.json` (new, built in `build.ts`):

```json
{
  "spec_version": "0.3.0",
  "entities": ["Place", "Company", "..."],
  "subtype_closure": {
    "Place": ["Place", "PostalAddress", "GeoCoordinates", "Location", "City", "Region"],
    "Company": ["Company", "Brand"]
  },
  "bridge_eligible": ["Place", "Company", "Person", "Product", "ProductCategory", "CryptoAsset", "WalletAddress", "Domain"],
  "observation_entities": ["WeatherReport", "PriceSignal", "EconomicIndicator", "Answer", "..."],
  "produces_index": { "maps.places": ["Place"], "...": ["..."] },
  "consumes_index": { "data.weather_forecast": ["Place"], "...": ["..."] }
}
```

**Build order** (in `build.ts`, before the bundle is finalized):

1. Load `spec/entity-vocab.json` + `spec/entity-subtypes.json`.
2. Compute `subtype_closure` from the subtypes graph.
3. Read each materialized intent's `consumes` / `produces` ports.
4. Emit `dist/entity-index.json` (produces/consumes indices + closures + `bridge_eligible`).
5. The traversal engine ([02](./02_oasis-next-engine.md)) and E1 load `entity-index.json` **only** — they never re-parse the vocab, so a pinned/deterministic build is enough to make E1 stable.

---

## 6. Acceptance criteria (A done)

- [ ] All 56 intents pass `oasis_validate` with zero deprecated top-level ports (except explicitly waived `Query` intents).
- [ ] `bridge_eligible` entities participate in ≥1 cross-domain consume/produce match (verified by E1).
- [ ] `Query` is not used as a consume on more than 12 intents (down from 15; target NL-only).
- [ ] Zero intents produce `StructuredRecord`; `WeatherReport` and other observations used where applicable.
- [ ] Zero ports reference abstract markers (`NamedEntity`, `Org`).
- [ ] `entity-index.json` ships in `dist/` and is consumed by the traversal engine.
- [ ] `oasis_find` resolve benchmark (E3) shows no regression on held-out queries.

---

## 7. Open questions

1. **`Place` as identifier vs payload:** unify to one entity with context-dependent `role`, or split identifier/record shapes? *Lean:* one identity, role on the port.
2. **`WeatherReport` vs `GovernmentService`:** is civic output distinct enough to keep both observations, or should civic unify under one observation type? *Lean:* keep both — different forward chains.
3. **`Brand` vs `Company`:** marketing competitive sets → produce `Company` / `many` rather than a new identity type.