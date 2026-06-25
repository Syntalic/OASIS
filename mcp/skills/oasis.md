---
name: oasis
description: >
  Discover the right PAID HTTP API (x402 / MPP) for a task via the OASIS MCP. Call
  oasis_find first for any "find or use an API that does X" — it returns ranked endpoints
  with price and payment rails inline. Use oasis_next to follow a finding across domains.
---

# Using OASIS — paid-API discovery

OASIS maps a natural-language task to the right **paid** HTTP API. The hosted MCP exposes
seven tools; in practice you mostly need two — **`oasis_find`** and **`oasis_next`**.

## Which tool

| Need | Tool |
|------|------|
| "Find / use an API that does X" — the common case | **`oasis_find`** |
| More endpoints for one capability you've already picked | `oasis_resolve` (`intent_id` + `query`) |
| See which task *intents* a query matches | `oasis_search` |
| Follow a finding into an adjacent domain | **`oasis_next`** (see below) |
| Contribute a capability to the taxonomy | `oasis_taxonomy` + `oasis_validate` |

## oasis_find — start here

One call returns a ranked, de-duplicated list of paid endpoints, each with `method`, `url`,
`price_usd`, and `rails`:

```json
{ "query": "convert 100 USD to EUR", "limit": 8 }
```

- **Query in plain language** — the task a person would type ("what's bitcoin going for",
  "transcribe an audio file", "geocode an address").
- The list is pre-ranked; the top few are usually right. Pick by **fit + price + rails**.
- Then **pay and call the endpoint directly** (below) — OASIS does not proxy the call.

## Calling a paid endpoint

Each endpoint declares its payment rail(s):
- **`x402`** — pay-per-call via the `X-Payment` header (Coinbase x402).
- **`mpp`** — session via `X-MPP-Session` (Tempo MPP).

Use a payment-capable client (an x402/MPP wallet or SDK, or a paying fetch bridge) to satisfy
the `402` and get the response. Fetch the endpoint's own `/openapi.json` for its request schema.

## oasis_next — your next data point

After you act on a finding and **hold a typed identity** (a `Place`, `Company`, `Person`,
`ProductCategory`, or `Domain`), `oasis_next` surfaces the **next data point worth pulling** —
a cross-domain capability that takes that identity as input. Chain it to turn one observation
into compounding, higher-order insight. Go *deeper across domains* — don't re-search the same
task. The flow: **find → call → reflect → next → synthesize**.

**Reflect first** — name the identity you hold, then pass it:

```json
{
  "finding": "Acme Corp is hiring aggressively in Austin",
  "entities": [
    { "entity": "Company", "value": "Acme Corp" },
    { "entity": "Place", "value": "Austin, TX" }
  ],
  "intent_id": "data.job_search",
  "exclude_intent_ids": ["data.job_search"]
}
```

### Which way to branch
1. **One endpoint answered the task?** → done.
2. **Same task, different provider?** → `oasis_find` again — *not* `oasis_next`.
3. **A different data point to explain the finding?** → `oasis_next` on an identity you hold.
4. **Several angles needed?** → call the top leads, then synthesize.

Chain on a typed **identity** you hold (not an observation): `Place`, `Company`, `Person`,
`ProductCategory`, `Domain`. (CryptoAsset / WalletAddress aren't supported yet.)

## Tips
- Results are pre-ranked and deduped — read the top few; don't over-fetch.
- The hosted instance needs no key; it is rate-limited per IP.
- If `oasis_find` comes up thin, rephrase the **task**, not the vendor name
  ("compare retail prices for X", not "the BestBuy API").
