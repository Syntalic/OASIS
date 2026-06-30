# `oasis_discover`: collapse the discovery surface to one tool

**Status:** implemented in `mcp/tools.mjs` (the 4-tool surface) · **Date:** 2026-06-30 · **Supersedes the surface half of:** [unified-find.md](./unified-find.md)

## TL;DR
The agent-facing API is too wide. `oasis_find` / `oasis_search` / `oasis_resolve` / `oasis_next` are
**one pipeline exposed at four depths**, and the search-vs-find distinction confuses even the authors.
Collapse the discovery flow into **one tool, `oasis_discover`** (a superset of `find` + `next`), keep a
reframed `search` as a classifier utility, and internalize `resolve`. The public surface drops from
**7 tools → 4** (1 core + 3 utilities):

| Public tool | For | Replaces |
|---|---|---|
| **`oasis_discover`** | agents: find endpoints + chain, in one call | `find`, `next`, `resolve` |
| `oasis_search` | utility: classify a query → capability intents (no endpoint resolution) | (reframed) |
| `oasis_taxonomy` | utility: read the controlled vocabulary | (unchanged) |
| `oasis_validate` | utility: validate a contribution (intent **or** binding) | `validate` + `validate_binding` |

## Why `resolve` is internalized but `search` stays (as a utility)
`oasis_search` returns capability **intents** (the task *type*); `discover` returns **endpoints** (the
callable URL). `find`/`discover` already runs the intent routing internally and resolves it, so `resolve`
(intent→endpoints) is purely an internal — removed from the public surface (the manual `search`→`resolve`
chain just reconstructs `discover`). `search` is **not** dropped: classifying a query to a capability with
**no endpoint resolution** is a real, distinct job (routing, analytics, introspection). The confusion was
never that it existed — it was that it sat next to `find` as a *second way to discover*. Reframed as a
clearly-scoped utility ("use `discover` to find endpoints; use this only for the classification"), the
overlap is gone. The routing signal is also surfaced inside `discover` as `matched_capabilities`, so the
common case needs no separate call.

## The agent loop (why there's no chicken-and-egg)
The held-entity path is **always a later-call enrichment**, never required up front:

```
1. discover({ query })                          → endpoints + next_steps          (call an endpoint)
2. <agent invokes one of the endpoints>         → holds a result in its context
3. discover({ query, finding: <that result> })  → endpoints + next_steps ENRICHED  (repeat)
```

- **Call 1** needs no entities. `next_steps` is built from entities extracted from the *query* (Place,
  Company, ProductCategory…), so the first call is complete on its own — identical to `find` today.
- **Call 2+**: the agent passes what it just learned. The low-friction path is **`finding`** (free text
  it already has — `discover` extracts the typed nouns); `entities[]` is the precise alternative. The
  agent always has its last result as text, so it can always supply this. Held entities only ever *add*
  investigative leads to `next_steps`; they're never a prerequisite.

## Signature
```ts
oasis_discover({
  query: string,            // the task, in natural language (required)
  finding?: string,         // OPTIONAL — what the agent just learned/did; typed nouns are extracted
                            //   from it to enrich next_steps with investigative leads. The easy path.
  entities?: Entity[],      // OPTIONAL — same enrichment, passed as structured typed entities. Power path.
  limit?: number,           // max endpoints (default 12)
})
```
`Entity = { entity: string, value?: string, kind?: "identity" | "observation", role?: "identifier" | "payload" }`

## Response
```ts
{
  endpoints: [                       // the callable answer — query→endpoint arm, host-deduped, ranked
    { method, url, summary, price_usd, rails }
  ],
  next_steps: [                      // ONE "what can you do next" list. Forward by default; when
    { intent_id, label, why,         //   finding/entities are given, investigative leads about what
      endpoint?, price_usd?,         //   you hold are folded into the SAME list, each explained by `why`
      bridging_entity? }             //   (present on investigative items: the entity that lets you invoke it)
  ],
  matched_capabilities?: [           // OPTIONAL routing signal — the ranked intents `oasis_search` used
    { intent_id, label }             //   to return. A field now, not a tool.
  ]
}
```

**One list, not two.** The agent sees a single `next_steps`; it does not have to distinguish "forward
cluster" from "investigative lead." Internally these come from two engines (the forward entity-flow
cluster vs. the held-identity investigative traversal); they are unioned, de-duped by `intent_id`, and
capped. `why` carries the human-readable relationship.

## Behavior (how each field is produced)
- **`endpoints`** — the endpoint-arm: embed `query`, cosine over all ~22k endpoint vectors, rerank,
  dedupe one-per-host. (Today's `find` endpoint path; unchanged.)
- **`next_steps`** — `buildNextSteps`: route `query` → top intent (hybrid + the homonym guard), extract
  **query** entities, and union (a) the forward entity-flow cluster with (b) authored ontology links.
  If `finding`/`entities` present, also run the **held-identity** traversal (`suggestFollowUps`,
  investigative shape) and fold its leads into the same list.
- **`matched_capabilities`** — the routed intent ranking (what `oasis_search` returned).

## The tool description is load-bearing
What makes an agent "just know" to run the find→act→find-with-`finding` loop is **`discover`'s own
description string** — not the host app's prompt. We assume an agentic model (anyone wiring this up has
one): the model reads the tool schema on every call, so the loop contract belongs **there**. A developer
who writes only *"use oasis_discover to find endpoints"* still gets correct chaining, because the tool
teaches it. The host prompt is the weakest lever; the description plus a self-guiding response (`why` on
every `next_steps` item, a callable `endpoint` where one exists) carry the behavior. Treat the
description as part of the contract — it ships in `MCP_TOOLS` and changes are reviewed like API changes.

**Canonical `oasis_discover` description string:**

> Find the paid HTTP API endpoints for a task — and what to do next — in ONE call. Returns `endpoints`
> (a ranked, host-deduped list: method, url, summary, price_usd, rails) plus `next_steps` — adjacent and
> cross-domain capabilities to chain into, each with a `why` and, where available, a callable endpoint.
> Start here whenever you're unsure which API to call.
>
> For a multi-step task, run a loop: (1) call `discover` with your task as `query`; (2) invoke one of the
> returned endpoints; (3) call `discover` again with `finding` set to a plain-text note of what you just
> learned (e.g. "registered acme.com for Acme Corp") — it extracts the entities you now hold and folds
> cross-domain follow-ups into `next_steps`. Only `query` is needed on the first call; add `finding` on
> every follow-up.

The `query` and `finding` param descriptions reinforce it: `query` = *"the task in natural language"*;
`finding` = *"what you just learned from the last endpoint you called — plain text; pass it on every
follow-up call to get cross-domain next steps about what you now hold."*

## What changed in code (`mcp/tools.mjs`) — done
- `oasisDiscover({ query, finding, entities, limit })` = `oasisFind`'s endpoint/caps logic + the
  held-entity branch of `oasisNext`, merged into the one `next_steps` list, plus `matched_capabilities`.
  `buildNextSteps(caps, query, held)` now folds investigative leads (from `held`) into the forward cluster.
- `oasis_validate` branches on input: `{ binding }` → `validateBinding`, else `validateSourceIntent`.
- The public surface (`TOOLS`, the source of `MCP_TOOLS` + the Anthropic/OpenAI exports) is exactly
  `oasis_discover`, `oasis_search`, `oasis_taxonomy`, `oasis_validate`. `oasisFind`/`oasisSearch`/
  `oasisResolve`/`oasisNext` stay as internal functions; `handleTool` still routes `oasis_find` /
  `oasis_next` / `oasis_resolve` / `oasis_validate_binding` as **deprecated aliases** (not advertised).

## Migration / compatibility
- Hosted MCP (`mcp.oasisindex.org`) is the main consumer; churn is low. The deprecated aliases forward to
  the internals for one release, then drop.
- **Remaining:** update the agent skill (`mcp/skills/oasis.md`), README, and CLAUDE.md to the
  `discover`-first flow — the docs still describe the old tools; the aliases keep them working meanwhile.

## Examples
```jsonc
// First call — just the task
oasis_discover({ "query": "register the domain mycoolstartup.xyz" })
// → { endpoints: [<registrars>], next_steps: [whois, hosting, company_enrich], matched_capabilities: [cloud.domains, …] }

// Later call — agent passes what it now holds, as free text
oasis_discover({ "query": "set up the new domain", "finding": "registered mycoolstartup.xyz for Acme Corp" })
// → { endpoints: [<hosting>], next_steps: [ …forward…, {intent_id:"data.company_enrich", why:"investigate Acme Corp you hold", bridging_entity:"Company"} ] }
```

## Decisions (resolved)
- **`matched_capabilities` in the default response** — **yes, included.** It's small, folds `search`'s
  signal in, and means the common routing-introspection case needs no separate call.
- **Keep `search`?** — **yes, as a clearly-scoped utility** (classify-only, no endpoint resolution), not a
  peer of `discover`. `resolve` is internalized instead.
- **`entities[]` vs `finding`** — **keep both;** `finding` (free text) is the documented agent path,
  `entities[]` is the structured power-path for programmatic callers.
- **Name** — **`oasis_discover`** (signals "the one tool"); `find` / `next` / `resolve` remain as
  deprecated aliases.
