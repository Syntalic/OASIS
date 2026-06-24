# OASIS Next — Tool API Spec

> **Parent:** [00_oasis-next-blueprint.md](./00_oasis-next-blueprint.md) · **Component:** C (The tool)
>
> **Depends on:** [02_oasis-next-engine.md](./02_oasis-next-engine.md) (B), [01_oasis-next-entity-model.md](./01_oasis-next-entity-model.md) (A)
>
> **Status:** draft

---

## 0. Purpose

Define the agent-facing `oasis_next` MCP tool: input model, entity extraction, output shape, and handler rewrite in `mcp/tools.mjs`. This replaces the current intent_id/query → `relatedOptions` typed-link path.

**Current handler** (to be retired):

```186:217:mcp/tools.mjs
async function oasisNext({ query, intent_id, limit = 12 }) {
  // ... resolves intent from query or intent_id ...
  const options = relatedOptions(intent, bundle).slice(0, limit);
  // groups: next_steps, drill_down, generalize, alternatives, prior_steps
}
```

**New handler:** entity-aware `suggestFollowUps()` from the traversal engine.

---

## 1. C1 — Input model

### 1.1 JSON Schema (MCP `inputSchema`)

```json
{
  "type": "object",
  "properties": {
    "finding": {
      "type": "string",
      "description": "What the agent just learned or observed — a sentence or short paragraph. Used for entity extraction when entities are omitted."
    },
    "entities": {
      "type": "array",
      "description": "Typed entities the agent currently holds. Preferred over heuristic extraction.",
      "items": {
        "type": "object",
        "properties": {
          "entity": {
            "type": "string",
            "description": "Canonical entity from spec/entity-vocab.json — identity (Place, Company) or observation (WeatherReport, PriceSignal). Abstract types (NamedEntity, Org) are rejected."
          },
          "kind": {
            "type": "string",
            "enum": ["identity", "observation"],
            "description": "Optional. Identity entities seed investigative leads; observations are accepted but seed no leads in v1 (forward chaining is v2)."
          },
          "value": {
            "type": "string",
            "description": "Optional human-readable value (city name, company name, token symbol) — not used for matching, surfaced in why strings."
          },
          "source_intent_id": {
            "type": "string",
            "description": "Capability that produced this entity, if known."
          },
          "role": {
            "type": "string",
            "enum": ["identifier", "payload"],
            "description": "Port role, if known. Defaults to identifier for investigative matching."
          }
        },
        "required": ["entity"]
      }
    },
    "intent_id": {
      "type": "string",
      "description": "Last capability the agent invoked (anchors forward traversal and source domain for lateral bias)."
    },
    "query": {
      "type": "string",
      "description": "DEPRECATED — routes to an intent when intent_id omitted. Kept for backward compat one release; prefer finding + entities."
    },
    "exclude_intent_ids": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Capabilities already called in this investigation — suppress from results."
    },
    "limit": {
      "type": "number",
      "description": "Max investigative follow-ups (default 8). Forward follow-ups are v2 (always empty in v1)."
    }
  },
  "anyOf": [
    { "required": ["entities"] },
    { "required": ["finding"] },
    { "required": ["intent_id"] },
    { "required": ["query"] }
  ]
}
```

### 1.2 Input precedence

1. **`entities`** — if provided, use directly (canonicalize via the subtype map to parent entities).
2. **`finding`** — run entity extraction (C2) to populate entities (only identities seed v1 leads).
3. **`intent_id`** — sets `source_intent_id` (the source domain for the cross-domain lateral bias); if no entities, infer from the capability's identity `produces` ports.
4. **`query`** — legacy: route to the top intent, then behave as (3).

### 1.3 Minimum viable call (skill-driven)

The investigate skill should teach agents to call:

```json
{
  "finding": "LA store sales are down 12% YoY in Q1",
  "entities": [
    { "entity": "Place", "value": "Los Angeles, CA", "source_intent_id": "analyst.inflation_tracker" }
  ],
  "intent_id": "analyst.inflation_tracker",
  "exclude_intent_ids": ["analyst.inflation_tracker"]
}
```

---

## 2. C2 — Entity extraction

### 2.1 Strategy (phased)

| Phase | Method | When |
|-------|--------|------|
| **1** | Skill passes entities explicitly | Default — agent declares what it holds |
| **2** | Heuristic vocab match | Fallback when only `finding` provided |
| **3** | Light LLM extraction | Only if Phase 2 yields nothing AND `OASIS_ENTITY_EXTRACT=llm` |

**Blueprint lean:** start with Phase 1 + 2; add Phase 3 only if E2 shows too many empty entity sets.

### 2.2 Phase 2 — Heuristic extractor

New module: `src/entity-extract.ts`

**Signals (ordered):**

1. **Gazetteer / pattern tables** for the v1 bridge identities (`Place`, `Company`, `Person`, `ProductCategory`, `Domain`):
   - US city, state (`/\b[A-Z][a-z]+,\s*[A-Z]{2}\b/` → `Place`)
   - Domain (`/\b[a-z0-9.-]+\.[a-z]{2,}\b/` → `Domain`)
   - Company / Person / ProductCategory — capitalized proper-noun + context, or (most reliably) passed explicitly by the skill.
   - *Crypto/wallet shapes (`0x…`, tickers) are **not** extracted in v1 — those bridges need derivation and are deferred ([01 §4.4](./01_oasis-next-entity-model.md)).*
2. **Intent produces fallback:** if `intent_id` set, add the capability's **identity** `produces` entities (not observations).
3. **Never infer `Query`, abstract markers, or `StructuredRecord`** as held entities.
4. **Identities only** seed leads — observations are dropped for v1 traversal.

**Output:**

```typescript
interface ExtractionResult {
  entities: HeldEntity[];
  method: "explicit" | "heuristic" | "llm" | "intent_produces";
  confidence: "high" | "medium" | "low";
}
```

### 2.3 Response metadata

Include extraction provenance so the agent can correct mistakes:

```json
{
  "entity_context": {
    "method": "explicit",
    "held": [{ "entity": "Place", "value": "Los Angeles, CA" }]
  }
}
```

---

## 3. C3 — Output model

### 3.1 Response shape

```json
{
  "source": {
    "intent_id": "analyst.inflation_tracker",
    "label": "Track inflation trends by region"
  },
  "entity_context": {
    "method": "explicit",
    "held": [{ "entity": "Place", "value": "Los Angeles, CA" }]
  },
  "forward": [],
  "forward_note": "v2 — forward (process-output chaining) is always [] in v1",
  "investigative": [
    {
      "intent_id": "data.weather_forecast",
      "label": "Get current weather and forecasts",
      "bridging_entity": "Place",
      "match_kind": "exact",
      "why": "Get current weather and forecasts can investigate Place you hold (Los Angeles, CA)",
      "endpoint": {
        "method": "GET",
        "url": "https://example.com/weather",
        "price_usd": 0.01,
        "rails": ["x402", "mpp"]
      },
      "score": 0.91
    },
    {
      "intent_id": "data.gov_civic",
      "label": "Look up government and civic services",
      "bridging_entity": "Place",
      "match_kind": "exact",
      "why": "Look up government and civic services can investigate Place you hold (Los Angeles, CA)",
      "endpoint": { "method": "GET", "url": "https://example.com/civic", "price_usd": 0.01, "rails": ["x402"] },
      "score": 0.87
    }
  ],
  "deprecated": {
    "notice": "next_steps/drill_down/generalize/alternatives/prior_steps removed — use forward/investigative"
  }
}
```

### 3.2 Field rules

| Field | Required | Notes |
|-------|----------|-------|
| `bridging_entity` | ✅ | The consume port that matched — the callable proof |
| `why` | ✅ | One sentence, agent-readable |
| `endpoint` | ✅ | Best endpoint via `selectEndpointsForIntent(cap, endpoints, 1)`; **leads with no bound endpoint are suppressed**, not returned ([02 §7](./02_oasis-next-engine.md)) |
| `score` | ✅ | 0–1 composite from engine ranking |
| `match_kind` | ✅ | `exact` or `parent` |

### 3.3 Error responses

```json
{ "error": "no entities held — pass entities[] or a finding with extractable typed nouns" }
{ "error": "unknown intent_id: foo.bar" }
```

Empty results are not errors — return `{ "forward": [], "investigative": [], "entity_context": { ... } }`.

When `investigative` is empty but observations are held, include a hint: `"pass identity entities (e.g. Place) for cross-domain leads"`.

---

## 4. C4 — Handler rewrite

### 4.1 `mcp/tools.mjs` changes

```javascript
import { loadEntityFlow, suggestFollowUps } from "../dist/entity-flow-traverse.js";
import { extractEntities } from "../dist/entity-extract.js";

const entityFlow = loadEntityFlow(DIST);

async function oasisNext(args) {
  const {
    finding,
    entities: explicitEntities,
    intent_id,
    query,
    exclude_intent_ids = [],
    limit = 8,            // v1: investigative only
  } = args ?? {};

  let source_intent_id = intent_id;
  if (!source_intent_id && query) {
    // legacy route — deprecate
    const hits = await searchHybridWithFallback(query, bundle, lanceDir, 5);
    const top = hits.find((h) => h.kind === "capability");
    if (!top) return { error: "no capability matched the query" };
    source_intent_id = top.capability_id;
  }

  const extraction = await extractEntities({
    finding,
    explicitEntities,
    source_intent_id,
    bundle,
  });
  if (!extraction.entities.length) {
    return { error: "no entities held — pass entities[] or a finding with extractable typed nouns" };
  }

  const source = source_intent_id ? capById.get(source_intent_id) : undefined;
  const result = suggestFollowUps(
    {
      source_intent_id,
      entities: extraction.entities,
      exclude: exclude_intent_ids,
    },
    entityFlow,
    { limit, endpoints: bundle.endpoints, capabilities: bundle.capabilities },
  );

  return {
    source: source ? { intent_id: source.id, label: source.label } : undefined,
    entity_context: { method: extraction.method, held: extraction.entities },
    forward: result.forward.map(fmtFollowUp),        // [] in v1 — forward is v2
    investigative: result.investigative.map(fmtFollowUp),
  };
}
```

### 4.2 MCP tool description (updated)

```
Given what an agent just found (finding) and/or the typed entities it holds, return CALLABLE
cross-domain investigative follow-ups — other-domain capabilities that consume an identity the
agent holds, for second- and third-order questions. Each suggestion includes the bridging entity
proving the agent can invoke it. Prefer passing entities[] explicitly; finding alone uses heuristic
extraction. (Forward/process-output chaining is a v2 addition.)
```

### 4.3 Deprecations

| Removed output group | Replacement |
|---------------------|-------------|
| `next_steps` | `forward` |
| `drill_down`, `generalize` | out of scope — use `oasis_find` for capability discovery |
| `alternatives` | out of scope — use `oasis_resolve` `related[]` temporarily |
| `prior_steps` | out of scope |

Remove the `deprecated` block after one release cycle.

**Dual-emit for safe cutover:** behind `OASIS_NEXT_LEGACY=1` the handler also emits the old groups (`next_steps`/`drill_down`/…) alongside `investigative`, so a rollback is config-only. Default off; removed once E2 gates the cutover ([00 §2a](./00_oasis-next-blueprint.md) Phase 3).

---

## 5. Examples

### 5.1 Post-geo lookup (forward + lateral)

**Call:**

```json
{
  "intent_id": "maps.places",
  "entities": [
    { "entity": "Place", "value": "Blue Bottle Coffee, Austin", "role": "payload" }
  ],
  "exclude_intent_ids": ["maps.places"]
}
```

**Expected:** `investigative` includes `travel.place_reviews`, `data.weather_forecast`, `data.gov_civic` — each consumes the held `Place` from a domain other than `maps`. (`forward` is `[]` in v1.)

### 5.2 Competitor intel (lateral)

**Call:**

```json
{
  "finding": "Competitor Acme Corp gained 8% market share",
  "entities": [{ "entity": "Company", "value": "Acme Corp" }],
  "intent_id": "marketing.competitive_landscape"
}
```

**Expected:** `investigative` includes `data.company_enrich`, `media.social_data`.

### 5.3 Legacy compat

**Call:** `{ "query": "weather in Chicago" }`

**Behavior:** routes to `data.weather_forecast`, infers `Place` from query heuristic, returns investigative leads. Emits deprecation warning in `entity_context.method = "intent_produces"`.

### 5.4 Open question — the orchestration layer (not yet specced)

`oasis_find` and `oasis_next` answer two different questions; a real investigation often needs a
*controller* that decides which to call and when:

- Does **one** endpoint answer the task, or does it need several data points synthesized?
- Is the next step a *same-task alternative* (→ `oasis_find`) or a *cross-domain follow-up*
  (→ `oasis_next`)?
- When `oasis_next` returns N leads, which subset should the agent actually call, and how is their
  output **synthesized** into the answer?

In v1 this controller is the **skill** ([04](./04_oasis-next-skill.md)) — a prompted loop, not code.
Whether it should later become a tool (an `oasis_plan` that routes find vs. next vs. multi-call
synthesis) is **an open design question**, deferred until the skill shows where the loop actually
needs help. Flagged here so the tool surface stays open to it.

---

## 6. Acceptance criteria (C done)

- [ ] MCP schema updated in `MCP_TOOLS` / server registration; `limit` defaults to 8 investigative.
- [ ] Handler uses the entity-flow engine, not `relatedOptions`.
- [ ] Every result item has a non-null `bridging_entity`, `why`, **and bound `endpoint`** (endpoint-less leads suppressed).
- [ ] `forward` is `[]` in v1; investigative leads are all cross-domain.
- [ ] `exclude_intent_ids` suppresses listed capabilities.
- [ ] Old + new output dual-emit behind `OASIS_NEXT_LEGACY` for one release (§4.3); E2 gates the cutover.
- [ ] E2 usefulness eval passes (see [05_oasis-next-validation.md](./05_oasis-next-validation.md)).
- [ ] Probe harness (`mcp/probe.mjs` if present) updated with new examples.