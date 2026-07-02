# Contributing a service to OASIS (LLM-assisted curation)

OASIS scales by **distributed, contributor-funded curation**: the owner of a service
(who has the OpenAPI spec and domain knowledge) curates their own endpoints into the
OASIS taxonomy, using their own LLM, and opens a PR. The labor and cost live at the
edge; OASIS centrally keeps only a cheap, objective validation gate.

This guide is the "how" — the rules an agent (or a person) follows. The mechanics are
two tools, exposed both on the OASIS MCP server and as CLI commands:

- **`oasis_taxonomy`** (`capindex taxonomy --json`) — the controlled vocabulary to bind
  INTO: existing task capabilities (+aliases), facet enums, the closed entity vocab.
- **`oasis_validate`** (`capindex validate-source <file>`) — validates a proposed
  capability against that vocabulary. **This is the same check CI runs on your PR**, so
  if it passes locally it passes the gate.

## The flow

1. **Get the taxonomy.** Call `oasis_taxonomy` first. It tells you what already exists
   and the allowed facet/entity values — so you bind into the vocabulary instead of
   inventing near-duplicates.
2. **Read your OpenAPI spec, operation by operation, and identify the TASK each does**
   — "what would an agent be trying to accomplish by calling this?" (a forecast, a
   transcription, a price comparison), not the vendor's feature name.
3. **Bind into an existing capability whenever one fits.** This is the common case —
   most tasks already have a capability (`data.weather_forecast`, `ai.speech_to_text`,
   …). Your endpoints get matched to it at index build time.
4. **Propose a NEW capability only when nothing fits.** Author a new
   `ontology/intents/<id>.yaml` and **flag it in the PR for human review** — new
   clusters grow the taxonomy and a maintainer approves them (this keeps the ontology
   from fragmenting into 1,000 near-duplicate "weather" capabilities).
5. **Validate** with `oasis_validate` / `capindex validate-source`. Fix any errors.
6. **Open the PR.** CI re-runs the same validation; a review step (human + agent) checks
   it isn't gamed.

## The capability file format

`ontology/intents/<id>.yaml` — task-only; endpoint membership is materialized at build
time (you don't hand-write `satisfies`):

```yaml
id: ai.moderate_content              # domain.snake_case; domain ∈ the facet enum
label: Moderate content for safety and policy violations
description: >                       # for humans/discovery — NOT used for ranking
  Classify text or images for toxicity, hate, harassment, sexual, and self-harm
  categories, returning per-category scores/flags.
aliases:                             # real agent phrasings, not the label restated
  - content moderation
  - toxicity detection
  - flag harmful user content
consumes:                            # typed ports — entity from the CLOSED entity vocab
  - entity: Text
    role: payload                    # identifier | payload | constraint
produces:
  - entity: StructuredRecord
    role: payload
    format: json
facets:                              # all values from the facet enums (oasis_taxonomy)
  domain: ai
  action: analyze
  modality: [json]
links:                              # optional typed edges to EXISTING capability ids
  - type: sibling_of
    to: ai.web_research
```

## The rules (what the validator + review enforce)

- **Facets** must come from the enums (`domain` 20, `action` 12, `modality` 9,
  `freshness` 5 — the authoritative lists are the enums in `spec/capability.schema.json`).
  **`consumes`/`produces` entities** must be in the closed entity vocab
  (`spec/entity-vocab.json`) — this is what powers chaining and the type guard. **Link
  targets** must be existing capability ids.
- **Describe what the endpoint *does*, verifiable from the spec — not a sales pitch.**
  The `description`/`aliases` are for discovery; they do **not** drive ranking.
- **Ranking is by objective signals** (price, payment rails, schema completeness),
  never your self-description — so over-tagging or inflated copy buys nothing. OASIS
  surfaces everything ("discover, don't gate"); quality/anti-gaming lives in review +
  objective ranking, not in restricting who can list.
