---
name: oasis
description: >
  Discover the right PAID HTTP API (x402 / MPP) for a task via the OASIS MCP. Call
  oasis_discover for any "find or use an API that does X" — it returns ranked paid
  endpoints AND a map of what to do next, in one call. On follow-up calls, pass
  `finding` (plain text of what you just learned) to chain across domains.
---

# Using OASIS — paid-API discovery

OASIS maps a natural-language task to the right **paid** HTTP API. One tool does the work —
**`oasis_discover`** — plus three utilities you'll rarely need.

## Which tool

| Need | Tool |
|------|------|
| "Find / use an API that does X" — **and** what to do next | **`oasis_discover`** (start here) |
| Just classify a query → task intents (no endpoint resolution) | `oasis_search` (utility) |
| Read the capability vocabulary, to contribute a service | `oasis_taxonomy` (utility) |
| Validate a contributed intent or binding | `oasis_validate` (utility) |

## oasis_discover — the one call

One call returns a ranked, host-deduped list of paid `endpoints` (each with `method`, `url`,
`price_usd`, `rails`) **plus `next_steps`** — adjacent and cross-domain capabilities to chain into:

```json
{ "query": "register the domain mycoolstartup.xyz" }
```
→ `endpoints`: [registrars…] · `next_steps`: [whois, hosting, company_enrich…] · `matched_capabilities`: [cloud.domains…]

- **Query in plain language** — the task a person would type.
- The list is pre-ranked; the top few are usually right. Pick by **fit + price + rails**.
- Then **pay and call the endpoint directly** (below) — OASIS does not proxy the call.

## The loop — chain a multi-step task

After you call an endpoint and hold a result, call `discover` **again** with `finding` set to plain
text of what you just learned — it extracts what you now hold and folds **cross-domain follow-ups**
into `next_steps`:

```json
{ "query": "research this company", "finding": "registered acme.com for Acme Corp in Austin, TX" }
```
→ `next_steps` now includes leads that consume the `Company` / `Place` you hold (job_search,
person_search, social_data…).

**The flow: discover → call → discover-with-`finding` → synthesize.** Only `query` is needed on the
first call; add `finding` on every follow-up. (Power path: pass typed `entities[]` instead of `finding`.)

### Which way to branch
1. **One endpoint answered the task?** → done.
2. **Same task, different provider?** → pick another endpoint from the same `endpoints` list.
3. **A different data point to explain the finding?** → `discover` again with `finding` = what you hold.
4. **Several angles needed?** → call the top `next_steps`, then synthesize.

## Calling a paid endpoint

Each endpoint declares its payment rail(s):
- **`x402`** — pay-per-call via the `X-Payment` header (Coinbase x402).
- **`mpp`** — session via `X-MPP-Session` (Tempo MPP).

Use a payment-capable client (an x402/MPP wallet or SDK, or a paying fetch bridge) to satisfy the
`402` and get the response. Fetch the endpoint's own `/openapi.json` for its request schema.

## Tips
- Results are pre-ranked and deduped — read the top few; don't over-fetch.
- The hosted instance needs no key; it is rate-limited per IP.
- If `oasis_discover` comes up thin, rephrase the **task**, not the vendor name
  ("compare retail prices for X", not "the BestBuy API").
- `oasis_find` / `oasis_next` / `oasis_resolve` still work as **deprecated aliases**, but prefer
  `oasis_discover` — it returns endpoints *and* next-steps in one call.
