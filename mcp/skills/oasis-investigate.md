---
name: oasis-investigate
description: >
  Multi-hop investigation loop using OASIS — find endpoints, execute paid APIs,
  declare typed identity entities, surface cross-domain follow-ups via oasis_next,
  synthesize findings. Use when digging deeper into a discovery, not for initial API search.
---

# OASIS Investigate Loop

## When to use

- User asks to investigate, dig deeper, or follow up on a finding.
- You called a paid API and need the **next cross-domain** capability — not another search for the same task.

Do **not** use for initial API discovery — use `oasis_find` alone.

## Loop

```
find → call → reflect → next → synthesize
```

| Step | Tool |
|------|------|
| find | `oasis_find` |
| call | HTTP + payment |
| reflect | declare identities held |
| next | `oasis_next` |
| synthesize | combine evidence |

## Controller: find vs next

1. **One endpoint answers the task?** → find → call → done.
2. **Same task, different provider?** → `oasis_find` again. **Not** `oasis_next`.
3. **Different data point to explain the finding?** → `oasis_next` on identities you hold.
4. **Several data points needed?** → call top-N investigative leads, then synthesize.

## Reflect (required before oasis_next)

```markdown
## Finding
[observation sentence]

## Identities held
- Place: "Los Angeles, CA"
- ProductCategory: "consumer electronics"
```

Pass identities to `oasis_next`:

```json
{
  "finding": "LA electronics sales down 12% YoY",
  "entities": [
    { "entity": "Place", "value": "Los Angeles, CA" },
    { "entity": "ProductCategory", "value": "consumer electronics" }
  ],
  "intent_id": "analyst.inflation_tracker",
  "exclude_intent_ids": ["analyst.inflation_tracker"]
}
```

Observations do **not** seed v1 leads — declare the underlying identity.

## v1 identity bridges (✅)

| Entity | Example |
|--------|---------|
| Place ✅ | "Austin, TX" |
| Company ✅ | "Acme Corp" |
| Person ✅ | "Jane Doe" |
| ProductCategory ✅ | "running shoes" |
| Domain ✅ | "example.com" |

CryptoAsset / WalletAddress — v2 only.

## Before engine ships

Pilot the **behavior** today: declare identities in reflect, use `oasis_find` for adjacent domains manually where `oasis_next` lacks cross-domain leads. The entity-flow tool drops in unchanged.