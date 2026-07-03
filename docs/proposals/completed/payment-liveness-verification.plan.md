# Live payment verification — Implementation Plan

> **Execution:** implement task-by-task, TDD (failing test → watch fail → minimal code → watch pass →
> commit). Steps use `- [ ]`. Design spec: [payment-liveness-verification.md](payment-liveness-verification.md).

**Goal:** at ingest, probe each claimed-paid endpoint unpaid, verify a real x402/MPP challenge, drop
ONLY affirmative liars, store the live challenge — safety-first (SSRF-guarded, conservative drops,
circuit-breaker).

**Architecture:** small focused modules — `net-guard` (SSRF-safe fetch), `payment-verify` (pure
classifier + probe), a verdict cache, and a host-aware `verifyPayments` step wired into `runIngest`
before the gate; the gate drops the static `contradicted` verdict. Nothing drops unless a `2xx`
serves the paid content free.

**Tech Stack:** TypeScript ESM (`.js` specifiers), `node:test` + `node:assert/strict`, `undici`
(Node's fetch; custom `Agent` dispatcher for IP-pinning), `node:dns/promises`, `ajv` (already a dep,
for the output-schema discriminator).

## Global Constraints

- **Drop ONLY on an affirmative lie** — a `2xx` clearing the strict 4-leg discriminator. Every
  ambiguous response (`401/403/404/405/400/429/3xx/5xx/net`, and an unparsed `402`) → `unknown`
  (keep). A `402` is never a lie.
- **SSRF:** every outbound probe (and the retrofitted openapi enrich) goes through `safeFetch`
  (undici pinned-`lookup` dispatcher rejecting loopback/private/link-local/`169.254`/ULA; `redirect:
  "manual"`, ≤2 hops, per-hop re-check).
- **Never probe `DELETE`/`PUT`/`PATCH`** (stamp `unknown`); GET always, POST cautious empty body.
- **Circuit-breaker** over the catalog delta: trip if `newlyDropped/priorClaimedPaid > 0.15` or
  `newlyDropped > 500` → downgrade all to `unknown`, don't cache, non-zero exit.
- New record fields optional + snake_case + `additionalProperties:false`-safe.
- `payment_verified` values: `"verified" | "contradicted" | "unknown"`.
- Asymmetric TTL: verified 7d, contradicted 2d, unknown never cached; prune not-seen / >2×TTL.
- Crawl-path only — never in the `--snapshot` no-crawl branch.
- `SPEC_VERSION`/`INDEX_VERSION` → 0.4.0.
- Tests: `node:test`, no network (inject fetch / `Response`-like). Build `pnpm run build:ts`; run one
  file `node --test dist/<path>.test.js`; validate `node dist/cli.js validate`. (NEVER `pnpm run
  build` — it network-crawls.)

---

### Task 1: Data model (record fields + live-challenge types + spec schema)

**Files:** Modify `src/core/types.ts` (add types after `PaymentInfo` at `:41`; add fields to
`EndpointRecord` after the schema fields ~`:185`); Modify `spec/endpoint-record.schema.json`
(properties + `$defs`); Test `src/core/payment-verified-schema.test.ts` (new).

**Produces:** `LiveAccept`, `LiveChallenge`, `PaymentInfo.live_challenge?`,
`EndpointRecord.payment_verified?`, `EndpointRecord.payment_verified_at?`.

- [ ] **Step 1 — failing test** `src/core/payment-verified-schema.test.ts`: an Ajv validator over the
  record schema (use `new Ajv({ strict: false, validateSchema: false })` + `ajv-formats`, matching
  `src/ingest/payment-spec.ts:19`). Assert: a base record + `{ payment_verified: "contradicted",
  payment_verified_at: "2026-01-01T00:00:00.000Z" }` validates; a record with
  `payment.live_challenge: [{ protocol: "x402", accepts: [{ scheme:"exact", network:"base",
  payTo:"0x…", amount:"1000" }] }]` validates; `payment_verified: "bogus"` fails; a record without
  any of them still validates.
- [ ] **Step 2 — build + run → FAIL** (`additionalProperties:false` rejects the new keys).
- [ ] **Step 3 — types** in `src/core/types.ts`, after `PaymentInfo` (`:41`):

```ts
/** A live payment requirement captured from an unpaid probe's 402 (advisory — re-fetch before paying). */
export interface LiveAccept {
  scheme?: string; network?: string; asset?: string; payTo?: string;
  amount?: string; maxAmountRequired?: string; extra?: Record<string, unknown>;
}
export interface LiveChallenge {
  protocol: "x402" | "mpp";
  accepts?: LiveAccept[];          // x402: validated body accepts
  www_authenticate?: string;       // mpp: raw WWW-Authenticate header (bounded)
  method?: string; intent?: string; realm?: string; // mpp: parsed Payment-scheme params
}
```

Add `live_challenge?: LiveChallenge[];` to `PaymentInfo`. Add to `EndpointRecord` after
`schema_truncated?` (`:185`):

```ts
  /** Live-probe verdict: the endpoint actually issues (verified) / lies about (contradicted) /
   *  couldn't be confirmed (unknown) a payment challenge. Advisory; runtime 402 authoritative. */
  payment_verified?: "verified" | "contradicted" | "unknown";
  payment_verified_at?: string;
```

- [ ] **Step 4 — spec schema** `spec/endpoint-record.schema.json`: add to `properties`
  `"payment_verified": { "enum": ["verified","contradicted","unknown"] }`,
  `"payment_verified_at": { "type": "string", "format": "date-time" }`; add `live_challenge` to the
  `Payment`/`PaymentInfo` `$def`'s properties as an array of a new `LiveChallenge` `$def`
  (`protocol` enum `["x402","mpp"]`; `accepts` array of a `LiveAccept` object; `www_authenticate`,
  `method`, `intent`, `realm` strings). Match the existing `$defs` style.
- [ ] **Step 5 — build + run → PASS**; `node dist/cli.js validate` still passes.
- [ ] **Step 6 — commit** `feat(verify): record fields + live-challenge types for payment verification`.

---

### Task 2: SSRF-safe fetch (`net-guard.ts`)

**Files:** Create `src/ingest/net-guard.ts`; Test `src/ingest/net-guard.test.ts`.

**Produces:** `isPublicAddress(ip): boolean`; `assertPublicHost(hostname): Promise<void>`;
`safeFetch(url, opts?): Promise<Response>`.

**Interfaces consumed:** none (leaf module).

- [ ] **Step 1 — failing test**: `isPublicAddress` returns false for `127.0.0.1`, `10.0.0.5`,
  `172.16.0.1`, `192.168.1.1`, `169.254.169.254`, `::1`, `fc00::1`, `fe80::1`,
  `::ffff:169.254.169.254`, `::ffff:10.0.0.1`; true for `1.1.1.1`, `2606:4700::1`. A helper
  `assertPublicHost` given an injected resolver that returns `["1.2.3.4","10.0.0.1"]` (multi-A
  public+private) **rejects** (reject-if-any). Numeric-IP hosts (`2130706433`, `0x7f000001`,
  `017700000001`) resolve via the injected lookup to loopback → rejected.
- [ ] **Step 2 — build + run → FAIL** (module missing).
- [ ] **Step 3 — implement** `src/ingest/net-guard.ts`:

```ts
import { Agent } from "undici";
import { isIP } from "node:net";
import { lookup as dnsLookupCb } from "node:dns";

/** True only for globally-routable unicast addresses. Rejects loopback / private / link-local /
 *  cloud-metadata / ULA and their IPv4-mapped-IPv6 forms. */
export function isPublicAddress(ip: string): boolean {
  let a = ip;
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a); // IPv4-mapped IPv6
  if (m) a = m[1];
  const v = isIP(a);
  if (v === 4) {
    const p = a.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [x, y] = p;
    if (x === 10 || x === 127 || x === 0) return false;              // private / loopback / this-host
    if (x === 172 && y >= 16 && y <= 31) return false;               // 172.16/12
    if (x === 192 && y === 168) return false;                        // 192.168/16
    if (x === 169 && y === 254) return false;                        // link-local + metadata
    if (x === 100 && y >= 64 && y <= 127) return false;              // CGNAT 100.64/10
    if (x >= 224) return false;                                      // multicast / reserved
    return true;
  }
  if (v === 6) {
    const lc = a.toLowerCase();
    if (lc === "::1" || lc === "::") return false;
    if (lc.startsWith("fe80") || lc.startsWith("fc") || lc.startsWith("fd")) return false; // link-local / ULA
    if (lc.startsWith("ff")) return false;                           // multicast
    return true;
  }
  return false; // not an IP
}

type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = (host) =>
  new Promise((res, rej) => dnsLookupCb(host, { all: true }, (e, addrs) =>
    e ? rej(e) : res(addrs.map((x) => x.address))));

/** Reject the host unless EVERY resolved address is public (reject-if-any, anti-rebinding by pinning). */
export async function assertPublicHost(hostname: string, resolver: Resolver = defaultResolver): Promise<string[]> {
  const ips = isIP(hostname) ? [hostname] : await resolver(hostname);
  if (!ips.length) throw new Error(`net-guard: ${hostname} did not resolve`);
  for (const ip of ips) if (!isPublicAddress(ip)) throw new Error(`net-guard: ${hostname} → ${ip} is not public`);
  return ips;
}

/** fetch() that (1) allows only http/https, (2) resolves+vets the host and pins the vetted IP for
 *  the connection (TLS/SNI/Host preserved), (3) manual redirects, ≤2 hops, re-vetting each hop. */
export async function safeFetch(url: string, opts: RequestInit = {}, resolver: Resolver = defaultResolver): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= 2; hop++) {
    const u = new URL(current);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`net-guard: scheme ${u.protocol}`);
    const vetted = await assertPublicHost(u.hostname, resolver);
    const pinned = vetted[0];
    const agent = new Agent({
      connect: { lookup: (_h, _o, cb) => cb(null, pinned, isIP(pinned) as 4 | 6) },
    });
    const res = await fetch(current, { ...opts, redirect: "manual", dispatcher: agent } as RequestInit);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).toString();
      continue; // re-vet next hop
    }
    return res;
  }
  throw new Error("net-guard: too many redirects");
}
```

> Note: `dispatcher` on `RequestInit` is an undici extension — cast as shown. The pinned `lookup`
> makes undici connect to the vetted IP while keeping the original hostname's SNI + cert validation.

- [ ] **Step 4 — build + run → PASS.**
- [ ] **Step 5 — commit** `feat(verify): SSRF-safe fetch (undici pinned-lookup, reject private/metadata)`.

---

### Task 3: Probe-response classifier (`payment-verify.ts` — pure)

**Files:** Create `src/ingest/payment-verify.ts` (classifier + types only this task); Test
`src/ingest/payment-verify.test.ts`.

**Produces:**
```ts
export type Verdict = "verified" | "contradicted" | "unknown";
export interface VerifyResult { verdict: Verdict; reason: string; challenge?: LiveChallenge[] }
export interface ProbeResponse { status: number; headers: Record<string,string>; body: string; probedMethod: string }
export interface ProbeContext { declaredMethod: string; rails: ("x402"|"mpp")[]; priceDynamic: boolean; validateOutput?: (body: unknown) => boolean }
export function classifyProbe(r: ProbeResponse | { networkError: true; reason?: string }, ctx: ProbeContext): VerifyResult
```

**Consumes:** `LiveChallenge`/`LiveAccept` (Task 1). The `validateOutput` fn is injected (Task 6
resolves it from the schema store) so this stays pure.

Logic (spec §2 + the strict discriminator):
- network error / timeout → `{ unknown, reason }`.
- `402`: parse challenge. **x402** — `JSON.parse(body)`, `accepts` array where an entry has `scheme`
  **and** (`network`||`asset`) **and** `payTo` **and** (`amount`||`maxAmountRequired`) → `verified`
  (capture `LiveChallenge{protocol:"x402", accepts:[validated]}`). **MPP** — a `WWW-Authenticate`
  header whose first scheme token is `Payment` (case-insensitive) → `verified` (parse `id/realm/
  method/intent`). Neither parseable → `unknown` (reason `x402_malformed`/`mpp_no_header`) — a `402`
  is NEVER contradicted.
- `2xx`: `contradicted` ONLY if ALL: (a) `r.probedMethod === ctx.declaredMethod`; (b) body is not a
  structured error — not JSON with any of `error|message|code|detail` top-level keys, no
  `x402Version`, no `/payment required|unauthorized/i`; (c) `!ctx.priceDynamic`; (d)
  `ctx.validateOutput` is present AND returns true for the parsed body (schema-less → inconclusive →
  unknown). Else `unknown` (reason `served_2xx_ambiguous`).
- any other status (`3xx/4xx/5xx`) → `unknown` (reason `http_${status}`).

- [ ] **Step 1 — failing test** covering: x402 well-formed `402` → verified; `accepts:[{}]` → unknown;
  MPP `WWW-Authenticate: Payment id="a"` → verified (method/intent parsed); `402` no recognizable
  challenge → unknown; `200` structured-error `{"error":"pay"}` → unknown; `200` on a substituted
  method (`probedMethod:"GET"`, `declaredMethod:"POST"`) → unknown; `200` schema-matching body on
  declared method, non-dynamic → contradicted; `200` with `validateOutput`→false → unknown; `200`
  schema-less (no `validateOutput`) → unknown; `priceDynamic:true` `200` → unknown; `401/403/429/500`
  → unknown; networkError → unknown.
- [ ] **Step 2 — build + run → FAIL.**
- [ ] **Step 3 — implement** `classifyProbe` per the logic above (pure; a bounded `WWW-Authenticate`
  tokeniser, not a greedy regex; wrap `JSON.parse` in try/catch → treat as non-JSON).
- [ ] **Step 4 — build + run → PASS.**
- [ ] **Step 5 — commit** `feat(verify): conservative probe-response classifier (drop only affirmative lies)`.

---

### Task 4: Circuit-breaker (pure)

**Files:** Modify `src/ingest/payment-verify.ts` (add fn); Test append to `payment-verify.test.ts`.

**Produces:** `export function applyCircuitBreaker(verdicts: Map<string, Verdict>, priorIds: Set<string>, priorClaimedPaid: number, opts?: { maxFraction?: number; maxAbs?: number }): { tripped: boolean; newlyDropped: number }`

Logic: `newlyDropped` = count of ids whose verdict is `contradicted` AND ∈ `priorIds`. Trip if
`priorClaimedPaid > 0` AND (`newlyDropped/priorClaimedPaid > maxFraction(0.15)` OR `newlyDropped >
maxAbs(500)`). First crawl (`priorClaimedPaid === 0`) → never trips. **Does not mutate**; the caller
downgrades on `tripped`.

- [ ] Steps: failing test (below-threshold → not tripped, drops apply; above-fraction → tripped;
  above-abs → tripped; empty prior → not tripped) → FAIL → implement → PASS → commit
  `feat(verify): catalog-delta circuit-breaker for mass-drop protection`.

---

### Task 5: Verdict cache

**Files:** Create `src/ingest/verdict-cache.ts`; Test `src/ingest/verdict-cache.test.ts`.

**Produces:** `interface CachedVerdict { verdict: Verdict; reason: string; verified_at: string; challenge?: LiveChallenge[] }`; `loadVerdictCache(dir): Promise<Record<string,CachedVerdict>>` (fail-soft `{}`); `isFresh(v, nowMs, ttl): boolean`; `pruneCache(cache, seenIds, nowMs, maxAgeMs): Record<string,CachedVerdict>`; `saveVerdictCache(dir, cache): Promise<void>` (writes `payment-verdicts.json`).

TTL: `isFresh` uses `verdict==="verified"?7d : verdict==="contradicted"?2d : 0` (unknown never fresh).
`pruneCache` drops entries not in `seenIds` OR older than `maxAgeMs (=2×7d)`.

- [ ] Steps: failing test (verified fresh within 7d / stale after; contradicted fresh 2d / stale
  after; unknown never fresh; prune removes not-seen + very-old; round-trip write/read; missing file
  → `{}`) → FAIL → implement → PASS → commit `feat(verify): verdict cache with asymmetric TTL + pruning`.

---

### Task 6: Probe (`probePaymentLiveness`)

**Files:** Modify `src/ingest/payment-verify.ts` (add the probe); Test append (injected `safeFetch`).

**Produces:** `export async function probePaymentLiveness(ep: EndpointRecord, deps: { fetchImpl?: typeof safeFetch; resolveOutputValidator?: (ep: EndpointRecord) => ((b: unknown)=>boolean)|undefined; timeoutMs?: number; bodyMax?: number }): Promise<VerifyResult>`

Logic: **method policy** — if `ep.method` ∈ {`DELETE`,`PUT`,`PATCH`} → return `{unknown,
"unprobed_write_method"}` without fetching. Else `safeFetch(ep.origin+ep.path, { method: probeMethod,
headers: { Accept:"application/json", "User-Agent":"OASIS-Index-Probe/1.0 (+https://oasisindex.org/probe)",
"X-OASIS-Probe":"liveness" }, body: probeMethod==="POST"?"" :undefined, signal: AbortSignal.timeout(timeoutMs=10000) })`
inside try/catch (any throw → `{unknown, reason:"probe_error"}` — never propagate). Read body capped
at `bodyMax=256*1024`. Build `ProbeResponse`, resolve `validateOutput` via
`deps.resolveOutputValidator?.(ep)`, call `classifyProbe`. `probeMethod` = `ep.method` for GET/POST
(HEAD→GET). Guard-rejected host (safeFetch throws) → `{unknown, "guard_blocked"}`.

- [ ] Steps: failing test with an injected `fetchImpl` returning canned responses (write-method →
  unprobed without calling fetchImpl; x402 402 → verified; 2xx-served → contradicted with a
  `resolveOutputValidator` returning true; fetch throws → unknown; oversized body truncated) → FAIL →
  implement → PASS → commit `feat(verify): unpaid liveness probe (method policy + fail-soft + safeFetch)`.

---

### Task 7: `verifyPayments` ingest integration (`discover.ts`)

**Files:** Modify `src/ingest/discover.ts` (new `verifyPayments` + call at the crawl gate, currently
`:245`, NOT the snapshot branch); Test `src/ingest/verify-payments.test.ts`.

**Produces:** `export async function verifyPayments(merged: EndpointRecord[], prior: IndexBundle|null, outputDir: string, built: string, deps?): Promise<EndpointRecord[]>` — stamps `payment_verified`/`_at`/`live_challenge`, applies the breaker, returns `merged` (membership unchanged; the gate drops).

Steps in `verifyPayments`: (1) `INGEST_NO_VERIFY` → return as-is. (2) load cache (Task 5). (3)
**host-aware scheduler**: group probe-eligible (claimed-paid, non-write) endpoints by host; run with
global `PROBE_CONCURRENCY=16`, per-host cap `PROBE_PER_HOST=2`, per-host per-crawl budget, host
back-off on repeated 429/403; reuse fresh cache verdicts (skip probe). Write-method / non-paid →
stamp `unknown` (`unprobed_write_method`/`not_paid`) without probing. (4) stamp each record; refresh
+ prune the cache. (5) `applyCircuitBreaker` over prior ids (`new Set(prior?.endpoints.map(e=>e.id))`,
`priorClaimedPaid = prior?.endpoints.filter(claimed-paid).length ?? 0`); if tripped → downgrade all
`contradicted`→`unknown` (do NOT cache those), `console.error` the counts+histogram, and
`process.exitCode = 1`. (6) emit metrics (counts + reason histogram + newlyDropped delta).

Wire at `discover.ts:245` (before `gateAndWrite(merged,…)`): `merged = await verifyPayments(merged,
prior, opts.outputDir, built)`. **Do NOT** add it to the snapshot branch (`:97`). Bump
`SPEC_VERSION`/`INDEX_VERSION` to `"0.4.0"`.

- [ ] Steps: failing test — inject a fake probe (via `deps`) + a small `merged` + `prior`; assert
  stamping, cache reuse (fresh verdict not re-probed), write-method stamped unknown, breaker trip
  downgrades + sets `process.exitCode`, non-snapshot only. → FAIL → implement → PASS
  (`pnpm run build:ts && pnpm run test:unit && node dist/cli.js validate`) → commit
  `feat(verify): verifyPayments ingest step (host-aware, cached, circuit-broken); spec_version 0.4.0`.

---

### Task 8: Gate drop + flags (`quality-gate.ts`)

**Files:** Modify `src/bind/quality-gate.ts` (`gradeEndpoint`); Test `src/bind/quality-gate.test.ts`.

Add after the thin-check DROP (`:87`), before the PASS section:
```ts
  if (ep.payment_verified === "contradicted")
    return { verdict: "drop", reasons: ["failed live payment verification"], flags: [], completeness: comp };
```
In the PASS flags (`:89-100`): `if (ep.payment_verified === "verified") flags.push("payment-verified");
else if (ep.payment_verified === "unknown") flags.push("payment-unverified");`

- [ ] Steps: failing test (`contradicted`→drop; `verified`→pass+flag; `unknown`→pass+flag; absent→
  unchanged/backward-compat) → FAIL → implement → PASS → commit
  `feat(verify): gate drops contradicted, flags verified/unverified`.

---

### Task 9: SSRF retrofit of the OpenAPI enrich

**Files:** Modify `src/ingest/openapi-fetch.ts` + `src/ingest/discover.ts:173` (`enrichOne`) to route
their per-origin `fetch` through `safeFetch`.

- [ ] Step 1 — grep every `fetch(` that targets a per-origin/registry URL in `src/ingest/` and
  confirm the set (`openapi-fetch.ts`, `discover.ts:173`). Registry-catalog fetches to fixed trusted
  hosts (`api.cdp.coinbase.com`, `mpp.dev`) may stay, but per-origin hops MUST use `safeFetch`.
- [ ] Step 2 — replace those `fetch(url, {…})` with `safeFetch(url, {…})` (drop the now-redundant
  `redirect` option — `safeFetch` sets it). Keep `AbortSignal.timeout`.
- [ ] Step 3 — `pnpm run build:ts && pnpm run test:unit` green; add a test that `openapi-fetch`
  refuses a private-IP origin (inject resolver). Commit `fix(net): route per-origin OpenAPI enrich through SSRF-safe fetch`.

---

## Self-review

- **Spec coverage:** SSRF guard (T2, retrofit T9), classifier + strict 2xx discriminator (T3),
  circuit-breaker (T4), cache asymmetric-TTL+prune (T5), probe method-policy+fail-soft (T6),
  ingest host-aware+crawl-only+breaker+metrics+version (T7), gate (T8), data model+advisory (T1).
  MPP conservatism is in T3 (unrecognized 402→unknown). Live-challenge storage T1+T6.
- **Type consistency:** `Verdict`, `VerifyResult`, `ProbeResponse`, `ProbeContext`, `LiveChallenge`,
  `CachedVerdict`, `safeFetch`, `classifyProbe`, `applyCircuitBreaker`, `probePaymentLiveness`,
  `verifyPayments` used identically across tasks; `payment_verified` enum matches everywhere.
- **Build prerequisite:** before T3's MPP branch is trusted in production, capture 3–5 real MPP `402`
  fixtures (spec §challenge shapes) — the classifier is correct regardless (unrecognized→unknown),
  fixtures just confirm the header parse against reality.
- **Determinism:** crawl-path only (T7) preserves the `--snapshot` rebuild; `payment_verified`
  survives `cleanRecord` (strips only `_source/_completeness/_flags/_wellknown`) + the `gateAndWrite`
  spread — assert in T7/T8.
