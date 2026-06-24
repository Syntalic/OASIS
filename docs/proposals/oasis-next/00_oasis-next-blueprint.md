# OASIS Next — Investigative Follow-Up Engine · Architecture Blueprint

> **Status:** draft / planning. This is the high-level spine. Detailed specs (entity-model
> spec, engine spec, tool API, skill) will be separate docs that link back here.
> **One-line:** redesign `oasis_next` from a hand-authored typed-link graph into an
> **entity-flow traversal engine** over the OASIS ontology, so an agent gets follow-up
> capabilities it can *actually call* — both to process its output and to investigate what
> it just found.

---

## 0. The principle

OASIS's ontology already types every capability by what it **consumes** and **produces**
(entities from a closed vocab). That typed-entity model *is* the follow-up substrate:
**"can the agent call this follow-up?" reduces to "does it hold the entity that follow-up
consumes?"** So `oasis_next` should *derive* follow-ups from the entity flow, not from
hand-authored edges. Every suggestion is then provably **callable** (the agent has the data),
not merely topically similar.

One mechanism — **surface capabilities that consume an entity the agent already holds** — over
two kinds of entity:

- **Identity entities** (`Place`, `Company`, `Person`, `ProductCategory`, `Domain`) **seed the
  investigative hop:** the agent holds an identity (extracted from its finding, or produced by the
  last call) → surface *cross-domain* capabilities that consume that same identity. The shared
  identity guarantees callability and is the "why." (`LA sales down → you hold a Place → weather /
  civic / travel take a Place`; `competitor rising → you hold a Company → enrichment / social take
  it`.) **This is v1.**
- **Observation entities** (`WeatherReport`, `PriceSignal`) are terminal in v1 — almost nothing
  consumes them, so forward-chaining one into the next call has no targets. Forward data-flow
  (`pipes_to`) is deferred (§0a).

The grounding pass (2026-06-24) showed the ontology has the right *structure* but is too
coarse to carry this yet: the cross-domain bridges are dominated by an over-generic `Query`
entity, while the genuinely useful entities (`Place`, `Company`) are fragmented across
inconsistent names (`Location` / `Place` / `PostalAddress` / `GeoCoordinates`) or buried
under `Query`. **The bulk of the work is enriching the entity model so the bridges light up.**

---

## 0a. v1 scope & fixed decisions

`oasis_next` answers a different question than `oasis_find`: not "more APIs for this task" (find's
job) but "given what I just learned, what **cross-domain** capability can I now call to go deeper."
v1 delivers exactly that hop and defers the rest.

**Ships in v1:** the identity-lateral hop above, over the bridge set **{`Place`, `ProductCategory`,
`Company`, `Person`, `Domain`}** — the verified consume-side map
([01 §2.1a](./01_oasis-next-entity-model.md)). Matching is exact-identity + narrow absorption
(place family → `Place`, `Brand` → `Company`); **no broad compatibility root**.

**Deferred (not v1):**
- **Forward-on-observation** — chaining a produced observation (`WeatherReport`, `PriceSignal`)
  into the next call; observations have ~no consumers, so there are no targets.
- **Identity→identifier derivation** (`Company ⇒ Domain`, coin `⇒ WalletAddress`,
  [01 §4.4](./01_oasis-next-entity-model.md)) — the `CryptoAsset` / `WalletAddress` bridges wait on it.
- **Broad "research this `Company`" bridges** — the skill passes the name to `oasis_find`; not a
  lateral hop ([01 §3.4](./01_oasis-next-entity-model.md)). A narrow explicit `Company → Topic`
  edge is a v2 candidate.

**Fixed decisions (02–05 inherit these):**
- **Traversal scope = the 56 curated, entity-typed intents** (the set `oasis_find` routes over) —
  not the ~30k raw endpoints; only typed intents carry `consumes` / `produces` ports.
- **Deterministic build** — `entity-index.json` builds from pinned inputs (`scan:false`), so E1
  fixtures are stable run-to-run.

---

## 1. Architecture — what needs to be built

Three planes; six components (A–F).

```
  Interface plane   D. Skill (the investigate loop)      C. oasis_next tool (entity-aware)
        │                         │                                  │
  Logic plane                     └───────────► B. Traversal engine ◄┘
        │                                       (forward + lateral, ranked)
  Data plane                              A. Ontology entity model
                                   (consolidated vocab + subtype graph + re-typed I/O)
```

### A. Ontology entity model — the foundation (everything depends on this)
- **A1 — Canonical entity set.** Split **identity** entities (what the agent pivots on:
  `Place`, `Company`, `Person`, …) from **observation** entities (what a capability returns
  about an identity: `WeatherReport`, `PriceSignal`, …). Consolidate fragmented identities
  (`Place` ⊇ Location/PostalAddress/GeoCoordinates). Retire `StructuredRecord` and demote
  `Query`. Compatibility is **narrow absorption only** (place family → `Place`, `Brand` →
  `Company`) — **no abstract `NamedEntity`/`Org` root** ([01 §3.4](./01_oasis-next-entity-model.md)).
- **A2 — Entity compatibility graph.** **Narrow** subtype graph for port matching — place family
  → `Place`, `Brand` → `Company`, nothing broader. A port accepts a held entity only on **exact
  identity or a one-hop parent**; unrelated identities (a held `Company` vs a `Topic` port) do
  **not** match ([01 §3.2/§3.4](./01_oasis-next-entity-model.md)).
- **A3 — Re-typed consumes/produces.** Re-annotate the 56 intents to use the canonical set
  and replace generic `Query` with a typed entity wherever one truly applies. (Fan-out-able.)
- **A4 — Vocab + validation.** Update `spec/entity-vocab.json`, add the subtype model, and
  extend `validate-source` / `validate-binding` to accept and check it.

### B. Traversal engine — the logic
- **B1 — Entity-flow index.** Build produces→consumes adjacency (with subtype expansion)
  over the **56 typed intents** at build time (not the raw endpoint catalog).
- **B2 — Forward traversal.** From (capability, entities) → the data-flow next steps.
- **B3 — Lateral traversal.** Shared **identity** entity, cross-domain (biased *away* from the
  source domain) → investigative leads. Observations do **not** seed hops in v1 (forward-on-observation deferred, §0a).
- **B4 — Ranking & selection.** Entity specificity (typed > generic), cross-domain diversity,
  endpoint quality, dedup, and how many to surface.

### C. The tool — the interface
- **C1 — Input model.** `oasis_next` accepts the *finding/observation* and/or the *entities
  held* and/or the last intent — replacing the intent_id-only input.
- **C2 — Entity extraction.** Map the finding/context → the entities the agent holds.
  *(Key decision: heuristic vocab match vs. light LLM vs. require the agent to pass entities.)*
- **C3 — Output model.** Grouped follow-ups (forward / investigative), each with the
  capability, the **bridging entity** (the why-you-can-call-this), an example endpoint,
  price + rails.
- **C4 — Handler rewrite.** `mcp/tools.mjs` `oasisNext` → the entity-flow engine; retire the
  typed-link path.

### D. The skill — the behavioral layer
- **D1 — Skill file.** The `find → call → reflect → next → synthesize` loop, and how to pass
  entity context to `oasis_next`.
- **D2 — Packaging.** Ship with the MCP install / as an installable skill.

### E. Validation
- **E1 — Bridge validation.** Do the scenario entities light up the right cross-domain
  capabilities? (Runs on the **built, re-typed index** — Phase 1b — before building the engine; see §2a.)
- **E2 — Usefulness eval.** Investigation scenarios → does `oasis_next` surface useful,
  *callable* leads? (Judged — the proof the redesign is worth it.)
- **E3 — `oasis_find` regression/uplift.** The entity enrichment must not hurt `find` (and
  should improve resolve ranking).

### F. Ship
- **F1 — Build pipeline.** Bake the entity-flow graph into the index build; ship it.
- **F2 — Deploy + re-dogfood.**
- **F3 — Detailed docs.** Entity-model spec, engine spec, tool API, skill — linking back here.

---

## 2. Work breakdown & size

Size = T-shirt (S ≈ a focused half-day-ish unit, M ≈ 1–2, L ≈ 3+). "Sessions" = one
build-or-design + review loop. AI executes fast; **review + design-iteration + validation
runs are the real cost**, so estimates are loop-counts, not raw compute.

| ID | Component | Size | Sessions | Depends on | Async? |
|----|-----------|:----:|:--------:|------------|--------|
| A1 | Canonical entity set | **M** | 1–2 | — | the gating design |
| A2 | Subtype graph | M | (with A1) | A1 | — |
| A3 | Re-type 56 intents | M–L | 1 | A1, A2 | ✅ fan-out agents |
| A4 | Vocab + validation | S | ~0.5 | A1–A3 | — |
| B1–B4 | Traversal engine | M | 1–2 | A | — |
| C1 | Input model | S | ~0.5 | B | — |
| C2 | Entity extraction | S–M | 0.5–1 | A1 | partly |
| C3–C4 | Output + handler | M | 1 | B, C1–C2 | — |
| D1–D2 | Skill | **S** | ~0.5 | — | ✅ **start now** |
| E1 | Bridge validation | S | ~0.5 | A3 | gate 1b (post-A3) |
| E2 | Usefulness eval | M | 1–2 | C | — |
| E3 | find regression | S | ~0.5 | A | ✅ |
| F1–F3 | Ship + docs | S–M | 1 | E | docs ✅ |

**Rollup:** ~**6–9 focused sessions** of real work. Layer **A (entity model) is ~40% of it
and the gating design** — if A is right, B/C/D fall out quickly; if A is wrong, everything
downstream wobbles.

---

## 2a. Phase gates — what must PASS before the next phase starts

Every phase has a **hard gate**: a concrete test that must pass before the next phase begins.
Gates are ordered by **data-readiness** (cheapest, highest-signal first), which is *not* doc
order. The eval *design* lives in [05](./05_oasis-next-validation.md); this is the gate *sequence*.

| Phase | Gate — must pass to proceed | Test | Cost |
|---|---|---|---|
| **0 · Paper bridge audit** | each v1 identity has **≥2 cross-domain post-A3 consumers, no derivation** — kills dead-end identities before any code | [01 §2.1a](./01_oasis-next-entity-model.md) (done) | minutes |
| **1a · Vocab + compatibility (A1/A2)** | `oasis_validate` green on new vocab + subtypes; **no abstract marker reachable as a lateral match** (no hairball); `entity-index.json` builds deterministically (pinned index / `scan:false`) | unit + validate | fast |
| **1b · Re-typing (A3)** | all 56 intents pass `oasis_validate`, zero deprecated ports; **E1 passes on the BUILT index** — every v1 fixture (Place→weather/civic/…, Company→social) resolves ≥2 cross-domain leads | E1 (05 §1) | fast |
| **1c · find regression (E3)** | `oasis_find` resolve benchmark shows **no regression** from re-typing (ideally a small uplift) | E3 (05 §3) | fast |
| **2 · Engine (B)** | traversal unit tests pass on fixtures (forward + lateral); **over-firing bounded** — lateral precision ≥ target on a labeled relevant/noise set; no auto-typed expanded cap ever appears as a lateral lead | engine + precision (05 §2.3) | fast |
| **3 · Tool (C)** | entity-extraction emits only valid vocab entities; handler returns grouped output with a **bound endpoint per lead** (zero-endpoint leads suppressed); old + new output dual-emit behind a flag | tool tests (03) | fast |
| **4 · Usefulness (E2)** | **the core bet:** on an *author-blind* held-out set, the engine beats a **catalog-aware** agent+`oasis_find` baseline on useful-distinct-leads + a precision metric — not a self-confirming check | E2 (05 §2) — **gates ship** | judged |
| **5 · Ship (F)** | deploy → live `/health` + a live investigate-loop smoke test → re-dogfood confirms no regression | F2 | deploy |

**Two hard rules:**
- **No phase proceeds on a self-confirming test.** E1 must verify the *specific scenario* bridges exist on the built index — not merely that the engine agrees with its own matcher. Factor the matcher into `src/entity-match.ts`, imported by both E1 and the engine, so E1 exercises real logic without being circular.
- **The gate order follows data-readiness, not doc order.** Phase 0 and 1b are the real early gates — bridges exist only *after* A3 (1b).

---

## 3. Timeline

Calendar depends on cadence and review latency, not raw build time. At a steady cadence
(a couple of focused sessions per working day, with review between):

- **Phase 1 — Entity model (A) + early gates (E1, D):** ~2–4 days. The design-heavy part;
  expect 2–3 iterations on A1/A2. This is the swing factor for the whole timeline.
- **Phase 2 — Engine + tool (B, C):** ~2–3 days once A is frozen.
- **Phase 3 — Validate + ship (E2, E3, F):** ~1–2 days.

**Total: ~1 to 2 weeks of focused effort**, dominated by entity-model iterations. The skill
(D) and detailed docs can deliver value in **days 1–2**, in parallel.

*Risk multipliers:* if the entity-extraction (C2) needs an LLM step, +0.5–1 day; if E2 shows
the leads aren't useful, loop back to A (re-granularize) — that's the scenario worth gating
hard against early (hence E1 before building B).

---

## 4. Sequence & parallelization

Critical path: **A → B → C → E2 → F.** Three things run async off it.

```
Day 0 ─┬─► A1+A2  Canonical entity set + subtype graph   ◄── the gating decision
       │      │
       │      └─► A3  Re-type 56 intents  [∥ fan-out agents]  ─► A4  vocab+validation
       │             │
       │             └─► E1  Bridge validation on the BUILT index  ◄ EARLY GATE (Phase 1b)
       │                    └─ bridges don't light up → re-granularize A before building B
       │
   ∥   ├─► D   Skill file (the investigate loop) ──────────────► ships + testable NOW
   ∥   │        (independent of A/B/C — validates the *behavior* with today's tools)
   ∥   └─► detailed docs drafted off this blueprint
       │
   (A frozen)
       └─► B  Traversal engine ─► C  Tool (input + extraction + handler)
                                      │
                                      ├─► E2  Usefulness eval (the proof)
                                      ├─► E3  find regression  [∥]
                                      └─► F   build → deploy → re-dogfood + F3 docs
```

**What can happen asynchronously / right away:**
1. **D — the skill** ships the *behavior* immediately and tests the whole vision with the
   current `find` + basic `next`. **Highest-leverage parallel track** — it tells us if the
   investigative loop is even valuable before we finish the engine.
2. **E1 — bridge validation** runs on the **built, re-typed index** (Phase 1b), before B/C
   exist — the gate that catches wrong granularity early (cheapest place to fix it).
3. **A3 — re-typing the 56 intents** parallelizes across fan-out agents once A1/A2 are set.
4. **The detailed docs** draft in parallel off this spine.
5. **E3 — find regression** runs the moment A lands.

---

## 5. Key decisions & risks

- **Entity granularity (A1) is *the* risk.** Too coarse → `Query`-style hairball (no signal);
  too fine → dead-end entities (no bridges). Conflating identity with observation → lateral
  fires on payloads that cannot pivot. Mitigation: **E1 gates it before we build.**
- **Entity extraction (C2):** how `oasis_next` learns which entities the agent holds —
  heuristic vocab-match (cheap, deterministic), light LLM (flexible, costlier), or make the
  *skill* instruct the agent to pass entities explicitly (cheapest, leans on D). Leaning:
  start with skill-passes-entities + heuristic fallback; add LLM only if needed.
- **Lateral over-firing:** shared-entity links can sprawl (everything keyed on `Place`).
  Ranking (B4) + cross-domain diversity caps must keep it tight — same discipline that fixed
  `oasis_find` (concentration over sprawl).
- **Does it beat the agent reasoning alone?** The whole bet (re: the earlier worry). E2 is
  the honest test; D shipping first de-risks it.

---

## 6. Relationship to current state

- **`oasis_find`:** untouched by this. (It already shipped the gated arm + smart gate; it's
  done.) The entity enrichment (A) *helps* its resolve ranking — a bonus, not a dependency.
- **The live typed-link `oasis_next`:** superseded by this engine. Retired in C4.
- **`feat/oasis-next-quality` (unmerged):** its prunes/notes were polishing the *old* graph.
  Most of it is mooted by the entity-flow redesign — but the **prune list is useful input to
  A** (the bogus "alternatives" it found are exactly the bad bridges the entity model should
  not create). Decision: don't merge as-is; mine it for A.

---

## 7. Follow-up detailed docs (drafted — link back here)

1. [01_oasis-next-entity-model.md](./01_oasis-next-entity-model.md) — identity/observation split, compatibility graph, re-typing rules (spec for **A**).
2. [02_oasis-next-engine.md](./02_oasis-next-engine.md) — forward/lateral traversal + ranking (spec for **B**).
3. [03_oasis-next-tool-api.md](./03_oasis-next-tool-api.md) — input/output, entity extraction, handler rewrite, examples (spec for **C**).
4. [04_oasis-next-skill.md](./04_oasis-next-skill.md) — investigate-loop skill; shippable now, independent of engine (spec for **D**).
5. [05_oasis-next-validation.md](./05_oasis-next-validation.md) — bridge + usefulness + `oasis_find` regression eval (spec for **E**).
6. [06_oasis-next-migration.md](./06_oasis-next-migration.md) — cutover sequence, config-only rollback, artifacts + versioning (spec for **F**).
