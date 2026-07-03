# Taxonomy methodology — assigning an intent to a domain

This is the rule for **which `facets.domain` an intent gets**. It exists because the boundary
between adjacent domains — most sharply `finance` ↔ `blockchain`, and "should security be a
domain" — was left to intuition, which drifts between contributors. Apply this instead.

See also [concepts.md](concepts.md) for what domains/facets/links *are*; this doc is the
*decision procedure* for placing an intent.

## What `domain` actually is (and isn't)

`domain` is the intent's id prefix (`<domain>.<name>`), a token in its embedding text, and the
lens the explorer and contributors group by. It is a **soft, default-off secondary signal — not a
routing gate.** Binding and query routing are **semantic-primary** (embeddings over
label/description/aliases/entities); the serve-time domain penalty in `select-policy.ts` is
env-gated and off by default. So a "wrong" home is a *small* cost, and a typed link fully recovers
the cross-domain connection. **We optimize for a bright line a stranger can apply mechanically,
over a purist call an expert must adjudicate.**

## The governing principle

> **One intent, one home, chosen by the SUBJECT the agent holds — the identifier it supplies
> (`consumes.entity`) and the dominant noun in its real queries — not the verb it wants performed.**

Agents reliably name **what they have** — a ticker, a contract address, a URL, a package name, a
place — far more than the abstract action. That noun dominates the embedding neighborhood, so the
home that matches it routes best. **Subject is the default home.**

## The two axes (the mix is intentional)

- **Subject domains** — what a capability is *about*: `finance`, `blockchain`, `commerce`, `media`,
  `maps`, `travel`, `gov`, `science`, `realestate`, `social`, `identity`, `data`, `cloud`.
- **Task-type domains** — what you *do* to an arbitrary object, cross-cutting subjects:
  `ai`, `web`, `compute`, `utility`, `devtools`, `comms`, `agent`.

The domain slot is the **subject by default**; a task-type domain is the exception. The task-type
axis you *don't* file under is never a second domain — it lives in the `action` facet plus links.

### Task-type domain admission test (all three must hold)

1. **Free-variable object** — the subject varies arbitrarily per call and isn't predictable from
   the capability; members share **one generic substrate** (an LLM completion, any URL, arbitrary
   code, arbitrary numbers), not different strong subjects.
2. **Verb-first queries** — agents phrase the task by the action ("scrape this", "run this code",
   "translate this"), so the task token dominates the embedding.
3. **≥3 independent, substitutable, *horizontal* providers** — not subject-specialists.

`web` / `ai` / `compute` pass cleanly. The tell-tale of a **false** task-type domain is *unity of
verb, diversity of subject* — members whose nearest neighbors scatter across many subject domains
(see the security case below).

## The tie-breaker ladder (for could-be-either capabilities)

A capability that reads as `subject:S × task:T`? Apply in order and **stop at the first rung that
resolves** — same inputs always yield the same home:

1. **Identifier/subject beats verb.** Home in the domain of the entity the agent supplies at query
   time. If the subject is stable and predictable, S wins and T becomes the `action` facet. Only if
   the object is a genuine *free variable* do you fall to a task-type domain.
2. **You are what you return.** Two subject domains both fit? The *produced*-artifact substrate
   decides (`produces` is more stable than the messy input side).
3. **Data source.** Still tied? The domain of the data the provider must integrate — exchange feed
   vs RPC/indexer vs government registry.
4. **Provider density.** Still tied? The domain with more independent providers for this exact
   capability — keeps clusters dense and honors the ≥3 rule.
5. **Always link the runner-up** (below), whatever the outcome — the seam is never silent.

## Links carry the losing axis (never duplicate)

The single-home rule is only lossless because links exist. **Exactly one embedding home per intent;
links carry every secondary path** (inverses are auto-generated and power `next_steps`/`related`).

- Every intent placed by a tie-breaker rung > 1, or sitting on a subject×task seam, **must** carry
  at least one typed link to the runner-up domain, with a one-line boundary note naming *which axis
  differs*.
- Pick the type by the relationship: `sibling_of` (same family, differs by one axis) ·
  `alternative_of` (substitutable different approach to the same goal) · `pipes_to`/`fed_by` (data
  flow) · `broader_of`/`narrower_of` (generality).

### Reconstituting a cross-cutting family without a domain

When a *concern* genuinely spans subjects (security), don't force it into a domain. Reconstitute it
as: a **shared produced entity** (e.g. `Threat`/`SecurityScan`) + a **`concern:` facet tag** + a
reciprocal **`alternative_of` mesh**. An audit-minded agent still enumerates the whole family via
`next_steps`, and the explorer renders it as a **view/filter — not a home** — so no member's primary
embedding neighborhood is distorted.

## Ruling — `finance` vs `blockchain` (the asset-form rule)

This is a **subject/asset-form split**, and it is decided by the **intent**, not the underlying
asset: is the thing you are acting on a **crypto / token / on-chain asset → `blockchain`**, or a
**traditional financial instrument → `finance`**?

- **`blockchain`** — anything crypto / on-chain: token prices, crypto derivatives, stablecoins,
  NFTs, on-chain state, DeFi, and the chain itself. DeFi and NFTs are *sub-intents* under it
  (`blockchain.defi_analytics`, a future `blockchain.tokenized_assets`), not their own domains.
- **`finance`** — traditional finance only: stocks, forex, commodities, macro, company financials.

The elegant case is **tokenized assets**: a *tokenized* Apple stock trades on-chain, so "buy
tokenized AAPL" is a **blockchain** intent — even though the underlying is a stock. "Research AAPL
the stock" is a **finance** intent. Same "Apple," different intent, different home. You would never
put a token-price lookup under `finance`; it always traces back to the intent.

Intent-level overlap is fine (a tokenized stock relates to both stocks *and* blockchain) — the
**domain follows the primary intent**, and a typed link carries the other framing.

**Current placement under this rule** (verified against endpoint supply):

| Stays `finance` (traditional) | Moves to `blockchain` (crypto) |
|---|---|
| stock_quote · economic_data · exchange_rates (forex) · trader_positioning (COT, was market_data) · trading_signals · company_fundamentals | spot_price (was finance.crypto_spot_price, 171/212 eps crypto) · market_intel (was finance.crypto_market_intel) · stablecoin_monitor (78/90 crypto) · prediction_markets (Polymarket-dominant) · derivatives (new) · token_security (new) |

Naming: the moved crypto intents drop the redundant `crypto_` prefix under the `blockchain.` domain
(`blockchain.spot_price`, `blockchain.market_intel`, `blockchain.derivatives`). The new
`blockchain.derivatives` also *reclaims* the crypto perp/funding endpoints currently mis-bound to
`finance.exchange_rates` / `trader_positioning`, cleaning up finance as a byproduct.

**Why this over a pure market-vs-chain split:** OASIS is an x402 (crypto-payment-native) index where
crypto is the largest, most coherent vertical and providers cluster crypto capabilities together
(one provider ships token price *and* holders *and* NFT floor). In this ecosystem "is it a
crypto/on-chain asset?" is the brightest contributor line and matches the supply. Routing is
semantic, so the small cost — a token price and a stock price living in different domains — is
absorbed by a `sibling_of` link between `blockchain.spot_price` and `finance.stock_quote`.

## Ruling — there is **no** `security` domain

Security **fails the admission test** on (a) and (c): its members name four *different* strong
subjects (a contract, an LLM prompt, a software package, a host/IOC) and their providers (honeypot
detector, jailbreak classifier, CVE database, TLS scanner, IOC feed) are **not substitutable**.
Their nearest neighbors live in four different subject domains — *unity of verb, diversity of
subject* — so a `security` home would surround each scanner with strangers and **pull it away from
its true query neighborhood, hurting routing**. Agents never issue an abstract "security" query;
they name the object.

So scatter each scanner to its **subject** home by the identifier rule, and mesh them:

| Intent | Home | Why | Mesh link |
|---|---|---|---|
| `token_security` | blockchain | contract address | `alternative_of` cve_lookup; `sibling_of` onchain_analytics |
| `prompt_guard` | ai | LLM prompt (next to moderate_content) | `alternative_of` cve_lookup |
| `cve_lookup` | devtools | package / software | `alternative_of` token_security, threat_intel |
| `tls_inspect` | devtools | host / cert (next to whois/ip_lookup) | `alternative_of` threat_intel |
| `threat_intel` | devtools | IP / domain / hash IOC | `alternative_of` cve_lookup, tls_inspect |

`paid_api_preflight` (home `agent`) and `compliance_screen` (home `gov`) are security-adjacent and
join the mesh via links. The family is a **`concern: security` view**, not a domain.

## Contributor checklist

1. What identifier does a caller supply? → that entity's domain is the default home (rung 1).
2. Is the object a *free variable* across unrelated subjects, phrased verb-first, with ≥3
   substitutable horizontal providers? Only then → a task-type domain.
3. Two subjects still fit? → what you *return* (rung 2) → data source (rung 3) → provider density
   (rung 4).
4. Emit a typed link + boundary note to every runner-up domain (rung 5).
5. A new *domain* needs ≥3 independent providers **and** must pass the admission test if task-type.

## Governance — when to revisit

- **Traffic shifts task-first.** The subject-first bet weakens if agent queries move toward
  compositional/audit phrasing ("assess everything unsafe about this deployment"). If
  orchestration/planning queries come to dominate, revisit the security verdict — a first-class
  cluster would then give higher recall than the link mesh.
- A task-type concern **crosses the admission test** (gains a free-variable substrate + substitutable
  horizontal supply) → promote it to a domain.
- Provider counts change materially → re-check the ≥3 bar.

## Known judgment seams (recorded so they aren't silently re-litigated)

High-confidence and settled: the finance/blockchain split, the security scatter,
`token_security`→blockchain, `prompt_guard`→ai, `cve_lookup`→devtools, `crawl`→web,
`product_catalog`→commerce, `lodging`→travel, `directions`/`timezone`→maps.

Genuine judgment calls (defensible either way — don't reopen without new evidence):
`tls_inspect`/`threat_intel` devtools vs web/data · `code_execute` compute vs devtools ·
`compliance_screen` gov vs finance/regtech · `company_fundamentals` finance vs gov/identity (EDGAR
is gov-sourced; the `produces` rung kept it in finance) · `natural_hazards` data vs science ·
`country_lookup` data vs utility · `ip_registry` gov vs science/identity · `paid_api_preflight`
agent vs devtools.
