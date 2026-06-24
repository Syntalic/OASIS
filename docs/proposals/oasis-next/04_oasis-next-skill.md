# OASIS Next — Investigate Loop Skill Spec

> **Parent:** [00_oasis-next-blueprint.md](./00_oasis-next-blueprint.md) · **Component:** D (The skill)
>
> **Status:** draft · **Can ship immediately** — independent of A/B/C engine work

---

## 0. Purpose

A portable agent skill that teaches the **investigate loop**: how to combine `oasis_find` (discover endpoints for a task) and `oasis_next` (cross-domain follow-ups from what you already hold) to dig into findings instead of re-searching from scratch. The skill is the v1 **controller** — hop by hop it decides whether one endpoint answers the task or whether more data points are needed and which tool finds them ([03 §5.4](./03_oasis-next-tool-api.md)).

This is the highest-leverage parallel track from the blueprint — it validates whether the investigative *behavior* is valuable before the engine ships.

**Deliverable:** `skills/oasis-investigate/SKILL.md` (or bundled in MCP install at `mcp/skills/oasis-investigate.md`).

---

## 1. When to trigger

Load this skill when:

- The user asks to investigate, dig deeper, follow up, or explore leads from a finding.
- The agent has just called a paid API and needs to decide what to call next.
- The agent is doing multi-hop research (competitive intel, local market analysis, on-chain forensics).
- The task is not a simple one-shot lookup — it benefits from chained capabilities.

Do **not** trigger for:

- Initial capability discovery ("find me an API for X") — use `oasis_find` alone.
- Single-endpoint execution with no follow-up intent.

---

## 2. The investigate loop

```
find → call → reflect → next → synthesize
  ↑                              │
  └──────── (repeat next) ───────┘
```

| Step | Action | Tool |
|------|--------|------|
| **find** | Discover the best endpoint for the initial task | `oasis_find` |
| **call** | Execute the endpoint (x402/mpp); parse the response | HTTP + payment client |
| **reflect** | State what was learned; declare typed entities now held | agent reasoning (no tool) |
| **next** | Surface callable **cross-domain investigative** follow-ups from the identities you hold | `oasis_next` |
| **synthesize** | Combine findings into an answer; stop when sufficient or budget exhausted | agent reasoning |

### 2.1 Stop conditions

Stop looping when:

- The user's question is answered with evidence.
- `oasis_next` returns no `investigative` leads.
- Spend cap / call budget reached (agent policy).
- Follow-ups are redundant (same `intent_id` already called — maintain `exclude_intent_ids`).

### 2.2 The controller decision (which tool, and is one call enough?)

At each hop the skill makes one routing decision — this is the v1 orchestration layer ([03 §5.4](./03_oasis-next-tool-api.md)):

1. **Does one endpoint answer the task?** A single lookup → `find` → `call` → done. No loop.
2. **Do I need the *same* task done differently** (another provider, cheaper, a fallback)? → `oasis_find` again (same-task alternatives). **Not** `oasis_next`.
3. **Do I need a *different, related* data point to explain or extend the finding?** → `oasis_next` on the identities I now hold (cross-domain). This is the second/third-order step.
4. **Does the answer require *several* data points combined?** Fan out: call the top-N `oasis_next` leads (different domains, §4.3), then **synthesize**. One lead rarely settles a "why".

Rule of thumb: **`find` = "get me an API for this task"; `next` = "given what I just learned, what else can I now ask."** If you're tempted to re-describe your finding as a fresh search query, that's the signal to use `next` — the entities are already in hand.

---

## 3. Reflect step — entity declaration (critical)

Before calling `oasis_next`, the agent MUST write an internal reflection:

```markdown
## Finding (observation)
LA consumer electronics sales down 12% YoY.

## Identities held (for investigative pivots)
- Place: "Los Angeles, CA"
- ProductCategory: "consumer electronics"

## Observations held (context — do not seed v1 leads)
- EconomicIndicator: "−12% YoY regional retail" (from analyst.inflation_tracker)
```

Pass **identities** to `oasis_next` — they seed the cross-domain leads. Observations can ride along as context but seed nothing in v1; to investigate around an observation, **declare the identity it's about** (the `Place`, `Company`, …):

```json
{
  "finding": "LA consumer electronics sales down 12% YoY",
  "entities": [
    { "entity": "Place", "value": "Los Angeles, CA", "source_intent_id": "analyst.inflation_tracker" },
    { "entity": "ProductCategory", "value": "consumer electronics" },
    { "entity": "EconomicIndicator", "value": "−12% YoY", "source_intent_id": "analyst.inflation_tracker" }
  ],
  "intent_id": "analyst.inflation_tracker",
  "exclude_intent_ids": ["analyst.inflation_tracker"]
}
```

If you only hold an observation (e.g. `WeatherReport`) but know the subject Place, **declare the Place** — investigation fires on identities, never observations.

**Why explicit entities matter:** even before the entity-flow engine ships, this habit ensures:

1. Callable follow-ups are justified (agent names what it holds).
2. Migration to the new `oasis_next` is seamless (C2 Phase 1).
3. The agent doesn't hallucinate follow-ups — it requests them from OASIS.

### 3.1 Entity cheat sheet (canonical vocab)

**Identities** — declare these for investigative `oasis_next` calls. The five marked ✅ are the v1 bridges (they have cross-domain consumers today); the rest are valid to declare but won't yield leads until a later version:

| When you have… | Entity | v1 leads? | Example value |
|----------------|--------|:---------:|---------------|
| A city, address, coordinates, region | `Place` | ✅ | "Austin, TX", "94107" |
| A company, brand, org name | `Company` | ✅ | "Acme Corp" |
| A person name or profile subject | `Person` | ✅ | "Jane Doe" |
| A market/category segment | `ProductCategory` | ✅ | "running shoes" |
| A domain / hostname | `Domain` | ✅ | "example.com" |
| A product SKU, URL, or name | `Product` | — | "AirPods Pro" |
| A token, coin, contract | `CryptoAsset` | v2 | "SOL" |
| A wallet or on-chain address | `WalletAddress` | v2 | "0xabc…" |

**Observations** — context only; they seed no v1 leads. Pair each with the identity it describes and declare *that*:

| When you have… | Entity | Declare instead |
|----------------|--------|-----------------|
| Weather / forecast data | `WeatherReport` | the `Place` |
| Price / competitive scan | `PriceSignal` | the `Product` or `ProductCategory` |
| Macro / regional trend | `EconomicIndicator` | the `Place` or `ProductCategory` |
| Search / research answer | `Answer` | the `Topic` or subject identity |
| Enriched org payload | `Company` | *(this is an identity — declare it)* |

Never use `StructuredRecord`. Never pass abstract types (`NamedEntity`, `Org`). Unstructured text only → pass `finding` and let heuristic extract identities.

---

## 4. Next step — calling `oasis_next`

### 4.1 Calling the entity-flow `oasis_next`

1. Always pass `entities[]` (the identities you hold) **+** `finding` for context.
2. Pass `intent_id` of the capability just invoked (sets the source domain for the cross-domain bias) and `exclude_intent_ids` for anything already called.
3. Each `investigative` lead carries a `bridging_entity` + `why` — read them before calling; if the bridging entity isn't one you actually hold, skip it.
4. Take the lead's bound `endpoint`, or re-run `oasis_find` if the suggested endpoint doesn't fit the sub-task.
5. `forward` is `[]` in v1 (process-output chaining is v2) — don't wait on it.

### 4.2 Piloting before the engine ships

The *behavior* (reflect → declare identities → investigate → synthesize) is testable today: where the current `oasis_next` lacks a clean cross-domain lead, the agent reasons about the identities it holds (§3) and calls `oasis_find` for the adjacent domain by hand. That manual gap is exactly what the entity-flow `oasis_next` closes — so piloting now validates the loop and de-risks the engine.

### 4.3 Selecting which follow-up to call

Rank by agent judgment on top of OASIS score:

1. **Relevance** to the user's actual question (not just high score).
2. **Cost** — prefer lower `price_usd` when equally relevant.
3. **Diversity** — for investigative loops, pick leads from different domains before repeating a domain.
4. **Novelty** — skip if it would repeat information already in the chain.

---

## 5. Synthesize step

After each hop (or at termination), produce:

```markdown
## Investigation summary

**Question:** [user's original ask]

**Chain:** intent_a → intent_b → intent_c

**Key findings:**
- [finding 1 + source endpoint]
- [finding 2 + source endpoint]

**Confidence:** [high/medium/low — note gaps]

**Suggested next steps for user:** [if stopped early]
```

---

## 6. Full walkthrough example

**User:** "Why are LA electronics sales down? Investigate."

### Turn 1 — find
```
oasis_find({ query: "regional retail sales trends electronics", limit: 5 })
```
→ pick endpoint via `analyst.inflation_tracker` or closest match.

### Turn 2 — call
Execute endpoint. Response mentions LA -12% YoY.

### Turn 3 — reflect + next
```json
oasis_next({
  "finding": "LA consumer electronics sales down 12% YoY",
  "entities": [
    { "entity": "Place", "value": "Los Angeles, CA" },
    { "entity": "ProductCategory", "value": "consumer electronics" }
  ],
  "intent_id": "analyst.inflation_tracker",
  "exclude_intent_ids": ["analyst.inflation_tracker"]
})
```

### Turn 4 — call investigative lead
Pick `data.weather_forecast` (unseasonable weather hypothesis) or `marketing.competitive_landscape` (competitive hypothesis) — state why in one line, then `oasis_find` + execute.

### Turn 5 — synthesize
Combine macro trend + weather + competitive data into a causal narrative.

---

## 7. D2 — Packaging

### 7.1 File layout

```
mcp/
  skills/
    oasis-investigate.md    # this skill (SKILL.md format)
```

### 7.2 MCP server install

Document in MCP server README:

```markdown
## Skills

Copy `mcp/skills/oasis-investigate.md` to your agent's skills directory, or reference it in your system prompt.
```

### 7.3 Skill frontmatter

```yaml
---
name: oasis-investigate
description: >
  Multi-hop investigation loop using OASIS — find endpoints, execute paid APIs,
  declare typed entities, surface follow-ups via oasis_next, synthesize findings.
  Use when digging deeper into a discovery, not for initial API search.
---
```

---

## 8. Acceptance criteria (D done)

- [ ] Skill file committed and referenced from MCP README.
- [ ] Skill teaches the **controller decision** (find vs. next vs. multi-call synthesis, §2.2) and explicit `entities[]` passing.
- [ ] Skill is pilotable **today** (find + current `oasis_next`) and drops into the entity-flow tool unchanged.
- [ ] Dogfood run: ≥3 investigation scenarios completed (see [05 §4](./05_oasis-next-validation.md)).
- [ ] Identity cheat sheet marks the v1 bridges; no skill guidance to declare crypto/wallet for v1 leads.