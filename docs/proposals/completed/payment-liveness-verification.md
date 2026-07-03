# Live payment verification: probe x402/MPP endpoints before listing

**Status:** proposal / design (v3 — two adversarial review rounds; all blocking findings addressed:
inverted-safe classification, undici pinned-lookup SSRF guard, strict `2xx`-lie discriminator,
catalog-delta circuit-breaker, crawl-path-only, host-aware scheduling)
**Date:** 2026-07-03
**Provenance:** ingest `src/ingest/discover.ts`; gate `src/bind/quality-gate.ts`; payment types
`src/core/types.ts`. Sibling of `endpoint-io-schemas.md` (spec 2 of 2 — the "claims x402, returns
empty `accepts`" data-quality gate that doc names at `:68`).

**Builds on spec 1** — MERGED to `main` (PR #22 → #25 `feat/endpoint-schemas-merge`, with Azad's
`cf7ba80` hardening). `main` is at `SPEC_VERSION 0.3.0`. This branch bases on current `main` and
bumps 0.3.0 → 0.4.0.

## TL;DR

An endpoint listed as paid (x402 or MPP) can be lying: called live, it serves free / never issues a
payment challenge. OASIS lists it anyway — `has402` is the provider's self-declaration, never probed.
This adds a **live verification** step at ingest: probe each claimed-paid endpoint **unpaid**, and
**store the live challenge** as ground-truth payment requirements. The gate is **conservative and
non-destructive by default**: we drop an endpoint ONLY on an *affirmative lie* (it serves real
content free, unpaid); every ambiguous response keeps the endpoint. A circuit-breaker aborts the
whole drop if too many endpoints would be delisted at once.

## Design principles (post-review)

Verification touches ~all ~19k listed endpoints and its drop is destructive + silent, so the design
is **safety-first**:

1. **Drop only on proof of a lie, never on absence of a recognized challenge.** A `402` is the
   *strongest* signal an endpoint is payment-gated — it is never a contradiction. Auth (`401`),
   bot-protection (`403`), rate-limit (`429`), wrong-guessed-method (`405`), body-validation
   (`400/422`), redirects, `5xx`, and network errors are all **`unknown` (keep)**, not lies.
2. **Never mutate a third party.** Probe only safe methods; never `DELETE`/`PUT`/`PATCH`.
3. **Never trust a URL from a registry.** SSRF-guard every probe target (attacker-influenceable).
4. **Fail-soft per endpoint.** A hostile/malformed response yields `unknown`, never a crawl abort.
5. **Guard the blast radius.** A circuit-breaker prevents a bad crawl from mass-delisting.
6. **Observe everything.** Per-crawl counts, reason histogram, and delta-vs-prior so a mass-drop is
   never silent.

## The two challenge shapes (grounded)

| Rail | Unpaid call returns | Valid-challenge signal |
|---|---|---|
| **x402** | `402` + JSON body `{ x402Version, accepts: PaymentRequirements[], error? }` | a **well-formed** non-empty `accepts[]` (each entry has `scheme` + `network`/`asset` + `payTo` + an amount field) in the **body** |
| **MPP** | `402` + `WWW-Authenticate: Payment id=…, realm=…, method=…, intent=…` (may add `application/problem+json` body) | a `WWW-Authenticate` **header** whose scheme token is `Payment` |

Sources: [mpp.dev/protocol/http-402](https://mpp.dev/protocol/http-402),
[tempoxyz/mpp-specs](https://github.com/tempoxyz/mpp-specs), the live CDP x402 registry. Rail
derivation: `src/ingest/payment-spec.ts:93-105` (method `x402`/`evm` → x402; else → mpp).

> **MPP grounding is a build prerequisite.** `WWW-Authenticate: Payment` is the IETF-draft shape;
> deployed endpoints may differ. Because of principle 1, a `402` from a declared-MPP endpoint whose
> header we don't recognize is `unknown` (kept), not dropped — so a shape mismatch **cannot** nuke
> the MPP catalog. Before implementing the MPP check, capture 3–5 real live MPP `402`s and pin them
> as test fixtures; the header presence *upgrades* `unknown`→`verified`, it is never the sole reason
> to drop.

## Scope

**In:** probe claimed-paid x402/MPP endpoints at ingest; classify; drop only affirmative liars; cache
verdicts; store the live challenge; circuit-breaker + metrics.

**Non-goals:** sending payment / purchasing; verifying free endpoints; on-chain settlement validation
of the advertised `accepts`; re-deriving `price_usd`/`rails` from the live challenge (stored
alongside as advisory ground truth).

## Design

### 1. SSRF-safe target guard (`src/ingest/net-guard.ts`, new — shared)

**Mechanism (the only correct one — a naive check is TOCTOU/rebinding-vulnerable, and rewriting the
URL to the IP breaks HTTPS SNI/cert validation):** a shared **`undici.Agent({ connect: { lookup } })`**
with a **custom pinned `lookup`**. The `lookup` resolves via `dns.lookup`/getaddrinfo (so
decimal/octal/`0x`/IPv4-mapped encodings are normalised to real addresses), and:
- **rejects if *any* resolved address** is loopback (`127/8`, `::1`), private (`10/8`, `172.16/12`,
  `192.168/16`, `fc00::/7`), link-local / cloud-metadata (`169.254/16` incl. `169.254.169.254`,
  `fe80::/10`), or IPv4-mapped-IPv6 equivalents (reject-if-any, never silently filter a multi-A host
  down to its public address);
- otherwise returns the vetted IP, so undici connects to **that exact address** while preserving the
  original hostname's SNI + `Host` header + certificate validation. This closes the DNS-rebinding
  TOCTOU (the vetting resolve IS the connect resolve) without breaking TLS, and re-fires on each
  redirect connection.

`safeFetch(url, opts)` = `fetch(url, { ...opts, dispatcher: guardedAgent, redirect: "manual" })`,
following ≤ 2 hops and **re-validating each `Location` host** through the same agent (blocks
public→private redirect). scheme allowlist (`http`/`https`) enforced before dispatch. Retrofit the
existing OpenAPI enrich (`discover.ts:173`, `openapi-fetch.ts`, and any other direct per-origin
`fetch`) onto `safeFetch` — same latent SSRF, fixed once. (Node `fetch` here is undici in Node 26;
the dispatcher option is available.)

### 2. Probe (`src/ingest/payment-verify.ts`, new)

`probePaymentLiveness(endpoint): Promise<VerifyResult>`:
- **Method policy:** probe `GET` and `HEAD`→`GET` fallbacks always; `POST` with an empty body only
  cautiously. **Never probe `DELETE`/`PUT`/`PATCH`** — those endpoints are returned `unknown`
  (unprobed) to avoid mutating a non-compliant server. A `POST` with a *guessed* method flag
  (Bazaar/MPP default) is probed but `405`→`unknown`.
- **Request:** `safeFetch(origin+path)`, **no** payment credential, `Accept: application/json`,
  `User-Agent: OASIS-Index-Probe/1.0 (+https://oasisindex.org/probe)`, `X-OASIS-Probe: liveness`
  (lets cooperating servers short-circuit), `AbortSignal.timeout(PROBE_TIMEOUT_MS=10000)`. The `402`
  body read is **byte-capped** (`PROBE_BODY_MAX=256KB`) before `JSON.parse`; the `WWW-Authenticate`
  parse is a bounded tokeniser, not a greedy regex.
- **Classify (conservative — drop only on an affirmative lie):**

| Verdict | Signal | Gate |
|---|---|---|
| **verified** | `402` + a **valid** challenge (x402: well-formed non-empty `accepts[]`; MPP: `WWW-Authenticate: Payment`) | PASS + `payment-verified` flag |
| **contradicted (DROP)** | a `2xx` that passes the **strict affirmative-lie discriminator** below (serves the real paid content free) | DROP |
| **unknown (KEEP)** | **everything else:** `401/403/404/405/406/415/429/400/4xx`, any `3xx`, any `5xx`, network/DNS/timeout, a guard-rejected target, **and a `402` whose challenge we couldn't parse** | PASS + `payment-unverified` flag |

- **Untrusted-input hardening:** every parse is fail-soft per endpoint (never throws up the stack);
  a malformed/oversized/hostile response → `unknown`. Mirrors the per-record try/catch Azad added to
  Bazaar capture (`cf7ba80`).
- `VerifyResult = { verdict; reason: string; challenge?: LiveChallenge[] }`. `reason` is a short code
  (`http_401`, `http_429`, `served_2xx`, `x402_ok`, `mpp_header`, `x402_malformed`, `mpp_no_header`,
  `timeout`, `dns_fail`, `guard_blocked`, …) for observability (§6), not a gate-affecting state.
- **x402 validity requires well-formed entries** (`scheme` + `network`/`asset` + `payTo` + amount) —
  a garbage `accepts:[{}]` is `unknown`, not `verified` (prevents a crafted challenge — esp. a
  crafted `payTo` — becoming stored "ground truth"; see §5).

**Strict affirmative-lie discriminator** (the `2xx`→`contradicted` gate — the ONLY destructive
trigger, so the bar is high; ALL must hold, else `unknown`):
1. The `2xx` is to the endpoint's **own declared method** — a `200` on a substituted probe method
   (e.g. a `GET` landing page when the paid op is `POST`) is `unknown`, never a lie (kills the
   "wrong-method `200` sibling" false-drop).
2. The body is **not a structured error** — no `error`/`message`/`code`/`detail` top-level keys, no
   `x402Version`, no payment/unauthorized wording (kills the `200 {"error":"payment required"}`
   false-drop).
3. When the endpoint has an `output_schema_ref` (spec 1), the body **plausibly validates** against
   that output schema — strong evidence it is actually serving the paid content free, not a health
   ping or metadata. No `output_schema_ref` → this leg is inconclusive → `unknown` (do not drop on a
   schema-less endpoint's `2xx`).
4. The endpoint does **not** declare a free tier / dynamic price (`payment.price_usd == null` or a
   free-tier marker) — a legitimately-free-on-empty-input endpoint is not a liar.
Only a `2xx` clearing all four is `contradicted`.

**Limitation (document, don't over-claim):** an identified probe (`User-Agent` + `X-OASIS-Probe`) is
a *good-faith liveness check*, evadable by an adversarial liar that detects the probe and returns a
fake `402` while serving free to real traffic. It catches **naive/accidental** mislistings (the
common case — dead endpoints, misconfig, empty `accepts`), not a deliberate deceiver. That is the
honest scope; we do not claim an adversarial audit.

### 3. Ingest integration (`src/ingest/discover.ts`)

New `verifyPayments(merged, prior, outputDir, built)` step in `runIngest`, inserted **only in the
crawl path** — after carry-forward, immediately before the crawl `gateAndWrite` (currently
`discover.ts:224`). It must **NOT** run in the no-crawl snapshot branch (`discover.ts:97`): a
`--snapshot` rebuild must stay deterministic (live probing would break `verify-pinned.sh` snapshot
mode + `dist-snapshot.lock.json`). The implementer reads live line numbers.

**Scheduler** — host-aware, not a naive global pool: a plain per-host semaphore over `mapPool`
head-of-line-blocks (16 workers can all draw from one mega-host). Use per-host queues (or
skip-a-host-at-cap and round-robin), a global `PROBE_CONCURRENCY=16`, a per-host cap
(`PROBE_PER_HOST=2`), a per-host per-crawl probe budget (a mega-host can't dominate crawl-1's
wall-clock), and host back-off after repeated `429`/`403`. The verdict cache amortises steady state,
not the first crawl.

Steps: (1) load `dist/payment-verdicts.json` (fail-soft `{}`). (2) For each **claimed-paid** endpoint
with a probe-safe method (GET / cautious POST): reuse a cached verdict within its TTL (§5), else
probe. Non-paid endpoints are skipped; **write-method endpoints (`DELETE`/`PUT`/`PATCH`) are stamped
`payment_verified: "unknown"`** (reason `unprobed_write_method`) — explicit, so the
`payment-unverified` flag fires and they aren't a silent blind spot. (3) Stamp `payment_verified` +
`payment_verified_at` (+ on `verified` the `live_challenge`); refresh the cache. (4) **Circuit-breaker
(§4)** decides whether drops apply this run. Return `merged`; the **gate** drops. Disable with
`INGEST_NO_VERIFY=1`.

### 4. Circuit-breaker (mandatory — the drop is irreversible within a crawl)

The breaker's denominator is the **catalog**, not the fresh-probe subset — a `contradicted/probed`
fraction is self-defeating (in steady state most verdicts are cached, so `probed` is tiny and a
single new liar trips it, and the feature then never drops anyone). Instead compute the **delta vs
the prior listing**:

- `newlyDropped` = endpoints that are `contradicted` this run (fresh **or** cache-stamped) **and**
  were present in the prior `index.json`.
- Trip if `newlyDropped / priorClaimedPaidCount > VERIFY_DROP_MAX_FRACTION` (default **0.15**) **or**
  `newlyDropped > VERIFY_DROP_MAX_ABS` (default **500**). (Dropping 1 of ~19k = 0.005% → applies
  normally; a mass event of thousands → trips.) First-ever crawl (no prior index) → breaker is
  inert (nothing to delta against); rely on the classifier's conservatism.

On a trip: **abort dropping this run** — downgrade every `contradicted` to `unknown`, keep the prior
listing, and **do NOT write those downgraded verdicts to the cache as `contradicted`** (treat as
`unknown` = not cached, so the next crawl re-probes cleanly instead of inheriting a poisoned cache).
**Fail loudly:** a large `console.error` with counts + reason histogram AND a **non-zero process
exit / CI annotation** (a mass anomaly must break the build, not just log) — plus a runbook line
("a trip means human review; the probe target list or OASIS's own egress IP may be WAF-blocked; do
not raise the threshold blindly"). Rationale: a network blip, a proxy `403`-ing all probes, OASIS's
IP getting WAF-blocked, or an MPP-shape mismatch could otherwise contradict thousands at once and
silently gut the index. The breaker turns a catastrophe into a caught anomaly. Tunable via env.

### 5. Verdict cache (`dist/payment-verdicts.json`) — load-bearing for correctness

Keyed by `endpoint_id` → `{ verdict, reason, verified_at, challenge? }`.
- **Asymmetric TTL:** `verified` reused **7d** (`VERIFY_TTL_VERIFIED_DAYS`); `contradicted` reused
  only **2d** (`VERIFY_TTL_CONTRADICTED_DAYS`) so a fixed / falsely-dropped endpoint re-lists fast;
  `unknown` **not** reused (re-probe next crawl).
- **Pruning:** drop entries not seen in the current probe set OR older than `2×TTL`, so the file
  can't grow unbounded as endpoints leave the registry.
- **Load-bearing note:** `contradicted` records are dropped by `gateAndWrite` *before* `index.json`
  is written (`discover.ts:54`), so they are never in `prior.endpoints` and cannot be carried
  forward. The mechanism that keeps a liar dropped across crawls is **this cache** (re-discovered
  from the registry each crawl → cache says `contradicted` within TTL → re-dropped), NOT
  carry-forward. The cache is therefore correctness-critical, not a mere optimization.

### 6. Observability

Emit to stderr / build log each crawl: `verified / contradicted / unknown` counts, the `reason`
histogram, and the **delta vs the prior `index.json`** (endpoints newly dropped). A silent mass-drop
must be impossible to miss in CI. The circuit-breaker (§4) reads these same counts.

### 7. Data model (`src/core/types.ts` + `spec/endpoint-record.schema.json`)

Optional, `additionalProperties:false`-safe: `payment_verified?: "verified"|"contradicted"|
"unknown"`, `payment_verified_at?` (ISO). On `PaymentInfo`, `payment.live_challenge?`:

```ts
interface LiveChallenge {
  protocol: "x402" | "mpp";
  accepts?: LiveAccept[];          // x402: validated body accepts (network/asset/amount/payTo/scheme)
  www_authenticate?: string;       // mpp: raw header value (bounded)
  method?: string; intent?: string; realm?: string; // mpp: parsed params
}
```

`LiveAccept` mirrors `BazaarAccept` (`bazaar.ts:16-25`); network notation normalized on store
(`eip155:8453`↔`base`). Bump `SPEC_VERSION`/`INDEX_VERSION` → 0.4.0. `cleanRecord` (`discover.ts:76`)
strips only `_source/_completeness/_flags/_wellknown`, so `payment_verified` survives the snapshot
rebuild (verify in a test).

### 8. Gate (`src/bind/quality-gate.ts`)

One DROP branch on the static field (gate stays network-free; runs identically at `discover.ts:54`
and `enrich-facets.ts:76`):

```ts
if (ep.payment_verified === "contradicted")
  return { verdict: "drop", reasons: ["failed live payment verification"], flags: [], completeness: comp };
```

`unknown` → `payment-unverified` ranking flag (never drops); `verified` → `payment-verified` flag.

### 9. Advisory boundary

The stored `live_challenge` (incl. `payTo`/amount) is **advisory** — proven present at
`payment_verified_at`, not guaranteed to settle on-chain or still be live at call time. **A consumer
about to pay MUST re-fetch the live `402` and use its `accepts`, never a stored `payTo`** (a stale or
poisoned `payTo` is a lost payment, not a rendering glitch). "The runtime 402 is authoritative"
(spec 1's posture), stated specifically for payment fields.

## Testing (TDD, `node:test`, no network — injected fetcher / `Response`-like objects)

1. **Classifier** — x402 `402`+well-formed `accepts` → verified; `402`+`accepts:[{}]` → unknown; MPP
   `402`+`WWW-Authenticate: Payment` → verified; `402`+unrecognized challenge → unknown (kept);
   `401/403/404/405/429/400/3xx/5xx/timeout/DNS` → unknown.
1b. **Strict `2xx` discriminator** — a `2xx` on the declared method with a schema-matching business
   body + no free-tier → contradicted; a `200 {"error":…}` (structured error) → unknown; a `200` on
   a *substituted* probe method → unknown; a free-tier/dynamic-price `200` → unknown; a `2xx` on a
   schema-less endpoint → unknown (inconclusive).
2. **SSRF guard** — the pinned `lookup` rejects `127.0.0.1`, `10.x`, `169.254.169.254`, `::1`,
   `fc00::`, `[::ffff:169.254.169.254]`, decimal/octal/`0x` IP encodings (`2130706433`, `0x7f000001`),
   and a multi-A host resolving to *both* public and private; non-http rejected; a public→private
   `3xx` redirect is blocked at the hop.
3. **Method policy** — `DELETE/PUT/PATCH` never probed → stamped `unknown` (flag fires, not silent).
4. **Circuit-breaker** — `newlyDropped(vs prior index)/priorClaimedPaid > 0.15` (or abs > 500) →
   downgrade all to unknown, don't cache them, non-zero exit; below threshold → drops apply; first
   crawl (no prior) → inert.
5. **Cache** — asymmetric TTL reuse (verified 7d, contradicted 2d, unknown never); pruning; round-trip.
6. **Gate** — drops `contradicted`, keeps+flags `unknown`/`verified`; a record without the field is
   unchanged (backward-compat); `payment_verified` survives `cleanRecord` + the snapshot rebuild.
7. **Record schema** — new fields validate; schema-less record still validates; `node dist/cli.js
   validate` passes.

## Rollout / cost / ethics

- New artifact `dist/payment-verdicts.json` (gitignored). First crawl probes claimed-paid endpoints
  once (bounded global+per-host conc, timeout); steady-state only new/expired (asymmetric TTL).
- Env knobs: `INGEST_NO_VERIFY`, `VERIFY_TTL_VERIFIED_DAYS`, `VERIFY_TTL_CONTRADICTED_DAYS`,
  `PROBE_CONCURRENCY`, `PROBE_TIMEOUT_MS`, `PROBE_BODY_MAX`, `VERIFY_DROP_MAX_FRACTION`,
  `VERIFY_DROP_MAX_ABS`.
- **Ethics/abuse:** an identified (`User-Agent` + `X-OASIS-Probe`), unpaid `402`-check with bounded
  per-host rate + back-off is a courteous liveness probe, not a scan. Honor `429`/`Retry-After`;
  a host denylist is supported.
- Gate/validate unchanged: `pnpm run build:ts && pnpm test && node dist/cli.js validate`.

## Open questions

None blocking. Deferred by intent: re-deriving `price_usd`/`rails` from the live challenge; MPP
`request`-token deep validation; on-chain settlement checks; a standalone re-verify CLI. **Build
prerequisite:** capture 3–5 real MPP `402` fixtures before wiring the MPP check (§challenge shapes).
