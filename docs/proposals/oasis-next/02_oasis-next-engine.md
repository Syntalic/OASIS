# OASIS Next — Traversal Engine Spec

> **Parent:** [00_oasis-next-blueprint.md](./00_oasis-next-blueprint.md) · **Component:** B (Traversal engine)
>
> **Depends on:** [01_oasis-next-entity-model.md](./01_oasis-next-entity-model.md) (A frozen)
>
> **Status:** draft

---

## 0. Purpose

Replace the hand-authored typed-link graph (`relatedOptions` over `intent.links` + `inferred-links.json`) with a **build-time entity-flow index** that derives follow-ups from `consumes`/`produces` ports.

One mechanism — **surface capabilities that consume an identity the agent holds**. **v1 ships the
lateral (cross-domain investigative) mode**; the forward/same-domain data-flow mode is specced here
but **deferred to v2** — its observation case has no consumers today and its identity case overlaps
lateral ([00 §0a](./00_oasis-next-blueprint.md)).

| Mode | Question | Relation label | v1? |
|------|----------|----------------|-----|
| **Lateral** | "I hold identity X from any source — what *other-domain* capabilities can investigate it?" | `investigative` | ✅ ships |
| **Forward** | "I just ran capability A and hold its outputs — what can I call next?" | `forward` (replaces `pipes_to`) | ⏳ v2 |

Every surfaced follow-up includes the **bridging entity** — the consume port that matched — so the agent knows *why* the suggestion is callable.

---

## 1. Current state (superseded)

Today `oasis_next` in `mcp/tools.mjs` calls `relatedOptions()` (`src/related.ts`), which walks authored + inferred `CapabilityLink` edges (`pipes_to`, `broader_of`, `narrower_of`, `alternative_of`, `sibling_of`, `fed_by`). This is topic-adjacent, not entity-guaranteed — a `pipes_to` edge may fail the `pipes_to_flow` lint in `validate.ts` when produces/consumes don't intersect.

The engine retires this path for follow-up surfacing. `relatedOptions` remains for `oasis_resolve` `related[]` until a later cleanup.

---

## 2. B1 — Entity-flow index

### 2.1 Build-time construction

New module: `src/entity-flow.ts`, invoked from `build.ts` after capabilities are materialized.

**Inputs:**

- `bundle.capabilities[]` — the **56 curated, entity-typed intents** (not raw endpoints), each with `consumes`, `produces`, `facets.domain`
- `dist/entity-index.json` — subtype closure + `bridge_eligible` set (from A4)

**Outputs:**

- `dist/entity-flow.json`

```json
{
  "spec_version": "0.1.0",
  "forward": [
    {
      "from": "maps.places",
      "to": "travel.place_reviews",
      "entity": "Place",
      "match": "exact",
      "from_role": "payload",
      "to_role": "identifier"
    }
  ],
  "lateral": [
    {
      "entity": "Place",
      "from_domain": "maps",
      "to": "data.weather_forecast",
      "to_domain": "data",
      "to_role": "identifier"
    }
  ]
}
```

### 2.1a The matcher — one definition, shared with E1

Both the index build and E1 import a single function from `src/entity-match.ts`, so E1 exercises the
engine's real matching logic rather than a parallel copy (no self-confirming test —
[00 §2a](./00_oasis-next-blueprint.md)):

```typescript
// held: an entity the agent holds; port: a consume-port entity on a capability
// closure: subtype_closure from dist/entity-index.json (01 §5.4)
export function entityMatches(held: string, port: string, closure: SubtypeClosure): boolean {
  if (held === port) return true;          // exact
  return closure.parentOf[held] === port;  // one hop up to the canonical parent (01 §3.2)
}
```

This is **exact-identity or a single hop to the canonical parent** — never a transitive climb to a
shared abstract root (there is none; [01 §3.4](./01_oasis-next-entity-model.md)). A held
`PostalAddress` matches a `Place` port; a held `Company` does **not** match a `Topic` port.

### 2.2 Forward edge rule *(v2 — deferred; §0)*

Forward edges are still emitted into the index (cheap), but v1 does not surface them. For each
ordered pair `(A, B)` where `A ≠ B`:

1. Let `P = expand(produces(A))` — entities A outputs, expanded via subtype closure downward (produced type includes subtypes).
2. `B` accepts a produced `e` when `entityMatches(e, port)` holds for one of B's consume ports (§2.1a) — exact or one-hop, no abstract climb.
3. For each `e ∈ P ∩ C` where `role(produces A, e) = payload` (or `identifier` when chaining identifiers) AND `role(consumes B, e) = identifier`:
   - Emit forward edge `A → B` with bridging entity `e`.
4. **Role guard:** apply the existing chaining rule from `entity-vocab.json` — payload flows into identifier; constraint is not a traversal bridge unless explicitly enabled later.

### 2.3 Lateral edge rule

Lateral traversal bridges on **identity entities only** (`bridge_eligible` ∩ `kind: identity`).
Observations (`WeatherReport`, `PriceSignal`, `Answer`, …) participate in forward chaining
but never seed investigative hops — the agent must hold (or declare) the underlying identity.

For each identity entity `e ∈ bridge_eligible` and each capability pair `(A, B)` where `domain(A) ≠ domain(B)`:

1. `A` may be the *source context* (last intent) or any intent that produces `e` — lateral index is entity-centric, not edge-centric.
2. `B` has a consume port `p` with `entityMatches(e, p)` (§2.1a).
3. Emit lateral entry `{ entity: e, from_domain, to: B, to_domain }`.
4. **Exclude** when `B = A` (same capability).
5. **Exclude** `Query` and all observation entities from `e` (no abstract markers exist — [01 §3.4](./01_oasis-next-entity-model.md)).
6. **Exclude** same-domain pairs by default (lateral = cross-domain investigative).

### 2.4 Index size control

With the 56 typed intents, brute force is ~3k pairs — trivial. Pre-index by entity → consuming capabilities for O(1) lateral lookup. The index is keyed so a held entity resolves its consumers under `entityMatches` — `consumersByEntity["PostalAddress"]` includes every `Place`-consuming capability (one-hop parent), computed once at build via the shared matcher.

```typescript
interface EntityFlowIndex {
  /** entity → capabilities that consume it (with domain) */
  consumersByEntity: Map<string, Array<{ intent_id: string; domain: string; role: string }>>;
  /** capability → forward neighbors */
  forwardFrom: Map<string, ForwardEdge[]>;
}
```

---

## 3. B2 — Forward traversal *(v2 — deferred; §0)*

Specced for completeness; **not surfaced in v1**. The forward index is built, but `oasis_next` v1 returns only investigative (lateral) leads.

### 3.1 Runtime API

```typescript
function forwardFollowUps(
  ctx: TraversalContext,
  index: EntityFlowIndex,
  opts?: RankOptions,
): RankedFollowUp[];
```

**`TraversalContext`:**

```typescript
interface TraversalContext {
  /** Last capability invoked (optional) */
  source_intent_id?: string;
  /** Entities the agent holds — canonical names from vocab */
  entities: HeldEntity[];
  /** Intents already called or surfaced — excluded from results */
  exclude?: string[];
}

interface HeldEntity {
  entity: string;
  /** provenance: produced by which intent, or extracted from finding */
  source?: string;
  role?: "identifier" | "payload";
}
```

### 3.2 Algorithm

1. If `source_intent_id` set: start from forward edges where `from = source_intent_id`, filter to entities ⊆ `ctx.entities`.
2. Else: for each held entity `e`, find all capabilities that consume `e` (forward = "process this output further" — includes same-domain).
3. Drop capabilities already in the call chain (optional `exclude` list from skill).
4. Pass survivors to ranking (B4).

### 3.3 Relation to old `pipes_to`

Engine-derived forward edges and authored `pipes_to` should largely agree, but neither is a strict superset — an authored edge can lack an entity match (a bad edge), and a valid entity edge can be unauthored (the point of the redesign). During transition, log divergences:

- Authored `pipes_to` with no entity match → warn (bad edge, prune input for A).
- Engine edge with no authored `pipes_to` → expected (the point of the redesign).

---

## 4. B3 — Lateral traversal

### 4.1 Runtime API

```typescript
function lateralFollowUps(
  ctx: TraversalContext,
  index: EntityFlowIndex,
  opts?: RankOptions,
): RankedFollowUp[];
```

### 4.2 Algorithm

1. For each `e ∈ ctx.entities` where `e` is `bridge_eligible`:
2. Lookup `consumersByEntity[e]`.
3. Filter to `domain ≠ source_domain` where `source_domain` comes from `source_intent_id` facets, or is unknown (then allow all cross-domain).
4. Exclude capabilities in `ctx.exclude` (already called or surfaced).
5. Rank (B4) with cross-domain diversity bias.

### 4.3 Scenario validation (from blueprint)

| Agent holds | Source domain | Expected lateral targets |
|-------------|---------------|--------------------------|
| `Place` (Austin TX) | shop / analyst | `data.weather_forecast`, `data.gov_civic`, `travel.place_reviews` |
| `Company` (competitor) | marketing | `data.company_enrich`, `media.social_data`, `data.person_search` |
| `Person` | comms / social | `data.person_search`, `media.social_data` |
| `ProductCategory` | shop | `marketing.competitive_landscape`, `analyst.inflation_tracker` |
| `Domain` | data | `data.whois_lookup`, `cloud.domains` |
| ~~`CryptoAsset`~~ | finance | **deferred to v2** — needs coin→`WalletAddress` derivation ([01 §4.4](./01_oasis-next-entity-model.md)) |

These are E1 fixtures — the engine must surface them on the built, re-typed index ([05](./05_oasis-next-validation.md)).

---

## 5. B4 — Ranking & selection

### 5.1 Score components

Each candidate follow-up gets a composite score:

| Signal | Weight | Description |
|--------|--------|-------------|
| **Semantic fit** | 0.30 | The primary over-firing control — cosine(finding/context, capability) via `gemini-embedding-001`; a `Place` consumer that's topically irrelevant ranks low even though the type matches |
| **Entity specificity** | 0.25 | Prefer exact match over one-hop-parent match (`Place` exact > `PostalAddress`→`Place`) |
| **Cross-domain novelty** | 0.20 | Lateral only — reward domains farthest from source |
| **Endpoint readiness** | 0.15 | Capability has ≥1 bound endpoint in bundle |
| **Endpoint quality** | 0.05 | Prefer lower `price_usd`, known rails (x402/mpp) |
| **Diversity penalty** | 0.05 | Downrank if same domain/intent family already in results |

```typescript
interface RankedFollowUp {
  intent_id: string;
  label: string;
  mode: "forward" | "investigative";
  bridging_entity: string;
  match_kind: "exact" | "parent";
  score: number;
  top_endpoint?: EndpointRef;
  why: string; // human sentence: "consumes Place you hold from maps.places"
}
```

### 5.2 Selection policy

- `limit` default: **8 investigative** (v1 surfaces lateral only; forward is v2).
- **Per-entity cap:** max 3 lateral results per bridging entity (prevents `Place` sprawl).
- **Per-domain cap:** max 2 investigative results per target domain.
- **Semantic floor:** drop lateral candidates below a cosine threshold even if the type matches — a hard over-firing cut, tuned on the E2 precision set ([05](./05_oasis-next-validation.md)).

### 5.3 `why` string generation

Template:

- Forward: `"`{B.label}` consumes `{entity}` produced by `{A.label}`"`
- Lateral: `"`{B.label}` can investigate `{entity}` you hold (from {source})"`

---

## 6. Implementation plan

| Step | File | Change |
|------|------|--------|
| 1 | `src/entity-flow.ts` | Build index from capabilities + entity-index |
| 2 | `src/entity-flow-traverse.ts` | `forwardFollowUps`, `lateralFollowUps`, `rankFollowUps` |
| 3 | `src/build.ts` | Write `dist/entity-flow.json` |
| 4 | `src/entity-flow.test.ts` | Unit tests for A1 scenarios + edge cases |
| 5 | `mcp/tools.mjs` | `oasisNext` calls new traverse module |

### 6.1 Public exports

```typescript
export function loadEntityFlow(distDir: string): EntityFlowIndex;
// v1 populates `investigative`; `forward` is always [] until v2 (§0).
export function suggestFollowUps(ctx: TraversalContext, index: EntityFlowIndex, opts?: { limit?: number }): {
  forward: RankedFollowUp[];      // [] in v1
  investigative: RankedFollowUp[];
};
```

---

## 7. Edge cases

| Case | Behavior |
|------|----------|
| Agent holds no typed entities | Return empty; response hints: "declare an identity entity (e.g. `Place`, `Company`) for investigative leads" |
| Agent holds only observations | Return empty (observations don't seed v1 hops); hint to declare the underlying identity |
| Agent holds only `Query` | Return empty; warn in response metadata |
| Capability has no endpoints | Suppress from results — v1 requires a bound endpoint per lead ([00 §2a](./00_oasis-next-blueprint.md)) |
| Subtype cycle in config | Build fails with validation error |
| `Money` / `Currency` constraints | Not identity entities — never seed lateral hops |

---

## 8. Acceptance criteria (B done)

- [ ] `dist/entity-flow.json` builds deterministically in CI from the 56 typed intents.
- [ ] E1 bridge scenarios pass on the built index, via the shared `entity-match.ts` ([05](./05_oasis-next-validation.md)).
- [ ] Every surfaced result passes `entityMatches(held, port)` — zero results fail the consume check.
- [ ] Investigative results for `Place` span ≥3 distinct domains in E1 fixtures.
- [ ] No investigative results keyed on `Query` or observation entities; every result has a bound endpoint.
- [ ] Lateral precision ≥ target on the labeled relevant/noise set (the over-firing gate, [00 §2a](./00_oasis-next-blueprint.md) Phase 2).
- [ ] p99 runtime for `suggestFollowUps` < 5ms (in-memory index lookup).