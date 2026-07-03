# Workflows: contributed, ontology-resolved recipes over the intent vocabulary

**Status:** proposal / design · **Date:** 2026-07-03 · **Provenance:** `main` @ `9242e87`; index
= 113 curated intents / 19,456 endpoints (65.1% bound, 12,670 endpoints); discovery surface
`mcp/tools.mjs` (`oasis_discover` + `oasis_schema`); ontology `ontology/intents/*.yaml`; entity
ports `spec/*`; methodology `docs/taxonomy-methodology.md`.

> **De-risked before writing.** A feasibility probe against the live index (8 blind-proposed
> compound goals) returned **7/8 assemblable, 0 dead, 0 redundant, all sub-cent** — evidence, not
> hope. See [§ Evidence](#evidence-the-feasibility-probe). What is proven is *describability*;
> *runnability* (a live paid run — "Level 2") is the one check still open before build.

## TL;DR

A **workflow** is a small, community-contributed **YAML recipe** that names an **ordered (or
parallel) sequence of intent IDs** for a compound goal that no single endpoint serves. It is
**data, not code**, lives in its own directory, and — critically — is **resolved through the
ontology binding, not vector search**: the recipe fixes the *sequence*; the *endpoints* are filled
in fresh at serve time from whatever is currently bound to each intent (ranked, priced, live).

`oasis_discover` gains one field, `next`, that is **either** a matched workflow **or** the existing
`next_steps` — never both. Popular goals get workflows; ad-hoc questions keep `next_steps`. The
library grows by PR over time. **OASIS suggests the route; the agent drives** — it never executes,
pays, or pins an endpoint.

## Motivation

`next_steps` is 1-hop **entity-adjacency**: given the entities a query surfaced, it suggests
neighboring capabilities. That is right for open-ended exploration but has two limits for recurring
compound goals:

1. **It can drift off-goal.** Measured, for the query *"Austin companies hiring data engineers,
   reach a decision-maker"*: `next_steps` spent **4 of 6 slots** on `gov.civic` / `maps.places` /
   `realestate.property_lookup` — because the strongest entity it held was the *Place* (Austin), so
   it wandered location-ward. It never surfaced `email_validate` or `send_email` — the steps that
   actually complete the task.
2. **The graph cannot auto-derive the route.** In the probe, `port_links_to_next` was **false at
   most interior seams**: the entity ports do not encode these transitions. A plan is assemblable
   only because a planner bridges intents the `next_steps` graph does not link. So the sequence must
   be **authored**, not generated. (This is why the value is a well-populated **index + a recipe**,
   not a pre-wired traversal graph — and why a contributed workflow is *not* redundant with
   `next_steps`.)

A workflow answers the case `next_steps` can't: a **prescribed, goal-targeted, multi-step route**,
including terminal actions no amount of adjacency would surface.

## The line between an intent and a workflow

The test is objective: **can one paid API call satisfy it?**

- **Yes → intent.** A provider already encapsulated the work into one sellable endpoint (even
  compound-*feeling* ones — `ai.web_research` is a whole search→read→synthesize pipeline sold as one
  call, so it is an intent). Composition happens *inside the provider*.
- **No → workflow.** No one endpoint does it; the agent must call several and stitch them.
  Composition happens *across providers*, in the agent's orchestration.

The boundary is self-correcting: when a provider ships an endpoint that does a whole workflow in one
call, that goal **graduates from a workflow to an intent**. The workflow layer is the frontier of
not-yet-encapsulated compositions.

## Design

### 1. A `workflows/` directory of YAML (data, not code)

Mirrors `ontology/intents/`. Each file is one workflow. The build ingests, validates, embeds the
goal text, and materializes a `dist/workflows.json` sidecar (same shape as the schemas sidecar).

```yaml
id: workflow.b2b_outbound
goal: Find companies hiring for a role, reach a decision-maker, and send a pitch
shape: chain                      # chain (ordered) | fanout (parallel enrichment of one entity)
aliases: [cold outreach to hiring companies, lead-gen and email a decision maker]
steps:
  - intent: data.job_search        # references an INTENT ID — never an endpoint
    do: Find postings for the role → the hiring companies
  - intent: identity.company_enrich
    do: Enrich each company's firmographics + domain
  - intent: identity.person_search
    do: Find a decision-maker at the company
  - intent: utility.email_validate
    do: Confirm the contact's email is deliverable
  - intent: comms.send_email
    optional: false
    gate: require human confirmation before sending   # terminal action → the agent gates it
    do: Send the tailored pitch
produces: A validated, sent outbound pitch — a completed action, not a report
```

### 2. Reference intents, never endpoints — resolved by the ontology binding

The recipe holds only `intent` IDs. At serve time each step resolves to the endpoints **bound to
that intent** (the `capabilities` field produced by `enrich`), ranked and priced. This is a
deterministic `intent → endpoints` lookup — **no query embedding, no arm**. Consequences:

- **No rot / vendor-neutral.** Endpoints churn; intents are stable. A recipe authored today still
  runs in a year — it never named an endpoint — and each run resolves to the best current one.
- **Resilience.** Each step yields *many* candidates (e.g. `person_search` → 196), so a dead or
  pricey top pick falls to the next.
- **Tiny contribution surface.** An author needs only "which intents, in what order" — the stable
  vocabulary — not a survey of hundreds of endpoints.

> Matching (query → *which* workflow) uses vectors over the goal text, exactly like intent
> matching. Only the **content/fill-in** is ontology-resolved. That split — fuzzy match to a
> **deterministically-resolved** recipe — is the differentiator vs. a pure semantic planner.

### 3. Two levels of the plan

- **Abstract (in the YAML):** intents + entity-level flow (`produces Company → consumes Company`).
  Vendor-neutral, endpoint-free.
- **Concrete (at execution, by the agent):** once the agent picks a specific endpoint per step, it
  reads *that* endpoint's schema via **`oasis_schema`** (shipped, PR #25) and does the field-level
  wiring (`output.domain → input.company_domain`). Different endpoints for the same intent have
  different field names, so no author could hardcode this — the agent resolves it per chosen
  endpoint. The graph gives the entity flow; the schema gives the field shape; the agent wires.

### 4. The unified `next` slot in `oasis_discover`

`matched_capabilities` + `endpoints` (the direct answer) are unchanged. A single `next` field is
**either** a workflow **or** exploration — never both:

```jsonc
"next": { "mode": "workflow", "workflow_id": "...", "goal": "...", "match_score": 2.4,
          "source": "community · workflows/b2b-outbound.yaml", "total_price_usd": 0.0031,
          "steps": [ { "n": 1, "intent_id": "...", "endpoint": {…}, "gate": "…" }, … ],
          "produces": "…  (the AGENT synthesizes; OASIS does not run it)" }
// else:
"next": { "mode": "explore", "steps": [ …today's next_steps… ] }
```

Because it is a **replacement**, the full workflow is inlined at no size cost over the loose list it
displaces — no lightweight ref + second round-trip. A workflow wins only **above a match
threshold**; below it, `next` falls back to `explore`. (Empirically the two barely overlap — 2/5
intent overlap, ~0 endpoint overlap on the outbound query — so the swap is a real upgrade, not a
dedup.)

### 5. `validate-workflow` — an objective gate on subjective content

A CI check (same shape as `validate-source`):

- **Schema-valid** against `spec/workflow.schema.json`.
- **Referenced intents exist** (the drift-guard already asserts the intent allowlist).
- **Entity-flow consistency** — each step's `produces` (or a shared entity) feeds the next step's
  `consumes`, checked against the real ports. **WARN, not hard-reject**, on a port gap: the probe
  showed the ports are incomplete (planners bridge real, working seams), so a strict gate would
  reject valid recipes. The gate flags incoherent seams (the `partial` case — full coverage but a
  broken hand-off) for author review, not automatic rejection.

## Evidence: the feasibility probe

Against the live index, 4 agents proposed 8 compound goals **blind to endpoint supply** (no
cherry-picking); each was resolved deterministically against the binding.

| Metric | Result |
|---|---|
| Assemblable (all steps resolve, coherent, non-redundant) | **7 / 8** |
| Dead (a step with 0 endpoints) | **0** |
| Redundant (a single intent already does it) | **0** |
| Full-workflow floor price | **$0.003–0.005** |
| Steps' endpoint supply | 42–264 endpoints per intent |

Best example — the one true dependency chain ending in a real action:
`data.job_search(163) → identity.company_enrich(206) → identity.person_search(196) →
utility.email_validate(140) → comms.send_email(42)`, total **$0.0031**, 4 domains.

**What the probe also honestly surfaced (folded into the design above):**
- **Index + planner, not a pre-wired graph** — ports don't encode most seams → recipes are
  authored, and the contributed layer is essential (§ Motivation 2).
- **Coverage ≠ composability** — one `partial`: all 4 steps resolved (160–264 endpoints each) but
  the AML seam didn't consume the upstream token list → the `validate-workflow` WARN (§ Design 5).
- **Two shapes** — several "workflows" are parallel fan-outs, not chains → `shape` field (§ Design 1).
- **Selection bias** — 8 curated tasks; proves good workflows *exist*, not the naive-query hit rate
  (that's a matching-quality question → the eval below).

**Open (Level 2 — the one thing a static probe can't prove):** liveness (do endpoints return 200?),
settlement (does 402→pay→retry clear at the quoted price?), and **field-level** port compatibility
(do the JSON keys line up, not just the entity types?). Settled by one live read-only run via a
funded wallet before committing to the build.

## Non-goals / boundaries

- **OASIS never executes, pays, or gates.** It returns the plan; the agent drives (cartographer,
  not driver).
- **No endpoint pinning.** Recipes reference intents only. (Discouraged escape hatch: a genuinely
  niche step *could* pin a preferred endpoint — an anti-pattern that reintroduces rot/lock-in.)
- **Not vector-based content.** Matching is vector; fill-in is ontology binding — deterministic.
- **Not auto-generation.** The graph can't derive the sequence (probe); humans author it.

## Effort & phasing

Moderate — a real end-to-end data type, but ~80% reuse of the intent pipeline. Concentrated risk:
graph-consistency validation, the serve-time `next` toggle, and *when* a workflow should win.

- **Phase 0 (MVP, ~2–3 days):** `spec/workflow.schema.json` + 1 seed YAML + `validate-workflow` +
  serve one confidently-matched workflow end-to-end behind an `include_*`-style opt-in. Proves the
  `next`-mode toggle and serve-time resolution — the two riskiest bits.
- **Phase 1 (~1 week total):** generalize matching (embed workflow goals, threshold), the two
  shapes, `dist/workflows.json`, docs (`contributing-workflows.md`), CI.
- **Ongoing (the real long tail):** seed recipes + a contribution/quality model; a workflow-query
  **eval set** (like `eval:resolve`) to tune the match threshold; edge/port hygiene (a bad
  `produces` port → a bad plan; cf. the parked `tcg produces:Product` fix).

## Open questions

- **Match threshold** — when does `mode:workflow` beat `explore`? Needs the eval set, or workflows
  fire on queries that should stay exploratory.
- **Workflow sprawl / quality** — the graph gate filters *incoherent* recipes, not *low-value* ones.
  Same quality bar as intents; eventually a provenance/usage signal so good recipes rise.
- **Relation to the `concern` facet** — both this and the parked collectibles/security "views" want
  a cross-cutting surface; keep them distinct (a workflow is a *goal route*, a concern is a
  *theme filter*).

## Relation to existing proposals

Builds on `oasis-discover.md` (the one-tool surface; adds the `next` field) and the shipped endpoint
I/O schemas (field-level wiring at execution). Independent of the ranking proposals
(`onchain-usage-ranking.md`, `ranking-signals.md`), which improve *which endpoint* fills a step —
strictly additive to a workflow.
