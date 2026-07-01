# OASIS Ingestion & Discovery Overhaul — ✅ Shipped

**Status:** COMPLETE — shipped in [PR #8](https://github.com/Syntalic/OASIS/pull/8) (merged to `main`) and deployed to `oasis-mcp`. This is the completion record. Items marked **[x]** shipped as part of the overhaul; the remaining **[ ]** items are **deferred follow-ups** (future enhancements), cross-linked to their own proposals where one exists.

## Why
A Reddit-discovery failure root-caused to three nested problems:
1. Discovery failed → endpoints were **ingested but not bound** to intents (orphans), silently rescued by the endpoint-arm fallback.
2. They weren't bound → **production binding is the heuristic path** (`build.ts` `expandOntologyFromProviders`), *not* the semantic binder (`bind-endpoints.ts`, which is offline-only in `enrich-facets`).
3. The records were thin → **no ingestion quality bar** (28k endpoints, ~22% stubs), and OASIS captured only ~6 of the canonical discovery fields.

Decision: **fix the data foundation first** (ingestion + strict types + quality gate), then binding/ranking.

## The standard (north star)
x402 (Coinbase / AgentCash / Merit) and MPP (Tempo) are **one co-authored standard**: IETF `draft-payment-discovery-00` = **OpenAPI 3.1 + `x-payment-info(.offers)` + `x-service-info` + a required `402`**, served at `/openapi.json`. Appendix C/D are JSON Schemas (we validate against them via ajv); Appendix A defines registry crawl rules. pay.sh (Solana Fdn) uses it too; AFTA (`/.well-known/agent-fair-trade.json`) is a separate trust layer.

---

## DONE ✅

### Strict types + spec-validated parsing
- [x] `spec/x-payment-info.schema.json` + `spec/x-service-info.schema.json` (Appendix C/D, authoritative)
- [x] `src/payment-spec.ts` — ajv-validated offer parsing + USD/rails derivation
- [x] `src/money.ts` — amount→USD across all encodings (base-units, `amountHint`, explicit decimals, already-USD) + token-decimals
- [x] Extended `EndpointRecord` (offers, currency, service, responses, schema_missing) + `endpoint-record.schema.json`
- [x] Rewired `src/openapi-parser.ts` to parse `x-payment-info(.offers)` / `x-service-info` / 402 / schema_missing (legacy fallbacks kept)

### Sources (federated discovery → per-origin enrichment)
- [x] `src/ingest/bazaar.ts` — CDP Bazaar `/x402/discovery/resources` (paginate 23.5k; `accepts`→offers; description/tags)
- [x] `src/ingest/paysh.ts` — `pay.sh/api/catalog` providers → origins
- [x] mpp.dev/api/services (inline endpoints) + x402scan origins, in the orchestrator
- [x] **Decisions:** keep Bazaar + openapi-enrichment + x402scan (9.5% unique yield) + mpp.dev; **skip mppscan**; pay.sh replaces local PAY.md; Bazaar promoted from eval-only → ingestion

### Quality gate
- [x] `src/bind/quality-gate.ts` — **inclusion (pass/drop) separate from ranking**. DROP = junk (no real summary / stub / meta / **content-free boilerplate**) OR **thin (<5 fields)**. PASS = real + ≥5 fields. **Quarantine removed**; **free kept if fleshed**.
- [x] Per-record **completeness score (0–13)** + quality **flags**
- [x] **Content-free boilerplate drop** (`isContentFree`): a non-stub summary that conveys no capability (seed: `"Premium API Access"`, `"handler"`, bare price strings) **with no real description to fall back on**. Surfaced by the floor calibration — **one provider (`lowpaymentfee.com`) was 31.5% of the corpus**, 10,028× `"Premium API Access"` on templated numeric-id paths, and the dominant source of low-floor binding noise. Rule drops **10,082** (mostly lowpaymentfee); keeps informative-but-templated catalogs (tcgapi price-history ×1,227 untouched). **31,810 → 21,728** on the saved corpus.

### Run + artifacts
- [x] Orchestrator `scratchpad/run-ingest.mjs` (federate → dedup origins → enrich `/openapi.json` → gate → write)
- [x] Full run → **31,810 PASS** (every record ≥5 fields, avg 6.3/13); thin/junk dropped; free-but-fleshed kept
- [x] Well-known probe: **x402 45% · llms 42% · AFTA 11%** of endpoints
- [x] Ranking substrate on every record: `_completeness` + `_flags` + `_wellknown`
- [x] `full-run-all.json` (all 35,530 records) → **instant re-grade, no re-crawl**

### Validation
- [x] `tsc` clean; gate + money + unit tests pass; real-spec validation (tensorfeed); 5-per-source pipeline test; x402scan unique-yield analysis

---

## Productionization, landing & deferred follow-ups

> Everything below marked **[x]** shipped in PR #8. The **[ ]** items are deferred future
> work — they were never part of the core overhaul's scope.

### 1. Productionize ingestion
- [x] `cli.js ingest` command (`src/ingest/discover.ts`) — federated discovery + per-origin enrichment + gate → `dist/index.json` (+ endpoints.json)
- [x] **No-crawl rebuild** — `cli.js ingest --snapshot <merged.json>` re-gates a saved crawl + re-emits the bundle with **zero network** (the gate + binder are post-crawl transforms). Used to re-apply the gate/floor changes to the hour-old crawl without re-fetching.
- [ ] **x402scan origins**: currently bootstrapped from the prior index (records source-tagged `x402scan/...` so it self-sustains) — TODO live sitemap origin-discovery
- [ ] **Enrichment retry + per-origin fetch cache** — the full fix for *fresh-crawl* 523-vs-822 variance (`--snapshot` reuses a whole snapshot; this caches per-origin); honor Appendix A (re-crawl ≥24h, delist after 7 fails, 10s/64KB limits)
- [ ] **YAML-served OpenAPI specs are still dropped** (fetch + parser handle JSON only) — add YAML parsing

### 2. Productionize the binding phase — the **"A" decision**
- [x] **Wired the semantic binder into the build.** `pnpm build` = `tsc → cli.js ingest → enrich-facets` (semantic bind + materialize). `build:index` (heuristic) kept as fallback; Dockerfile updated (needs `GOOGLE_API_KEY` at build).
- [x] The drafted **normalize** (`endpoint-text.ts`) + **sparse-promotion** (`bind-endpoints.ts`) now run in the build (verified: 517 sparse-promotions on the ingested corpus, offline MiniLM)
- [x] **Calibrated `strongSparseFloor` → 0.12** on a full gemini run (31,810-corpus, 4-floor sweep 0.18/0.15/0.12/0.10). 0.12 is the knee that captures the founding **Apify reddit-scraper-lite** case (sparse **0.1364** → 0.15 strands it). Precision read on the 0.18→0.12 delta showed the noise was **49% concentrated in boilerplate providers** → fixed at the gate (above), not by raising the floor. On the cleaned 21,728 corpus: **bound 56.3%** (was 40.7% dirty), `media.social_data` preserved, **Apify binds correctly**.
- [x] **Rebuilt the shippable artifacts from the snapshot (no crawl, no re-embed).** `ingest --snapshot` → `dist/index.json` (21,728 PASS, 1,118 origins) → `enrich-facets` (bind @ 0.12, **warm gemini cache → 9.8s**, bound **12,270/21,728**) → `embed --scope curated` (56 capability vectors) → `build:endpoint-index`. Validated: `search "scrape reddit posts and comments"` → `media.social_data` → Reddit endpoints. **Not deployed.**
- [x] **`build:endpoint-index` now filters to live endpoints** — the content-addressed f32 cache outlives the corpus, so it carried vectors for gate-dropped junk. Now ships only vectors `index.json` references: **28,949 → 18,871 vectors, 88.9MB → 58MB** (harmless before — the arm only searches live endpoints — but dead weight).
- [x] **Deployed to oasis-mcp (Fly, sjc)** — `fly deploy --build-secret GOOGLE_API_KEY=…`, image v10. Live server loads the new index (`endpoint arm ready (21,679 endpoints)`), health passing, `/mcp` up. Verified: live `oasis_find("scrape reddit posts and comments")` → 6 relevant Reddit endpoints. **Caveat:** all results came `via: endpoint-arm` — the intent layer still isn't the path for this query (see below).

### 3. Capture gaps (discussed earlier, still open)
- [ ] **Typed request schema** (inputs are names-only — no types/descriptions/`required[]`) + **response 200/402 schemas** (only presence captured)
- [ ] **`info.x-guidance` text** (only the `guidance_available` boolean is stored)
- [ ] **Bazaar quality telemetry** (`l30DaysTotalCalls`, `uniquePayers`, `lastCalledAt`) — identified as a premium ranking signal, **not yet carried into records**
- [ ] **MCP-type Bazaar entries** (`type:"mcp"`) — currently skipped; decide handling
- [ ] **Token-decimals registry** — small USDC seed + default 6; refine for exotic tokens

### 4. Ranking + benchmark
- [ ] **Composite ranking score** from the substrate (completeness + flags + well-known + Bazaar telemetry) — tracked in [../ranking-signals.md](../ranking-signals.md) + [../onchain-usage-ranking.md](../onchain-usage-ranking.md)
- [x] **Before/after benchmark run** (`scratchpad/benchmark*.mjs`, golden `eval/queries.json`). On the 61 aligned+answerable queries: intent-coverage **77% → 82%** (floor-driven); golden-endpoint orphan rate **29.5% → 25.8%** (net **−12 recovered, 0 regressions**). New index strictly-not-worse + modestly better → safe to ship.
- [x] **Re-labeled the golden eval set to the 56-ontology.** `eval/queries.json` remapped (legacy 211-intent taxonomy → current 56): **402 remapped, 121 already-current, 121 out-of-scope** (documented capability gaps). Legacy labels preserved as `expect_intent_legacy`; mapping saved to `eval/intent-remap.json`. Usable in-scope queries **121 → 523**; aligned+answerable **61 → 268**. Re-run: coverage **55.6% → 56.7%** (+3, 0 regressions). The gate is now reliable.
- [ ] **Benchmark guard** — treat "answered only via `endpoint-arm`" as a soft failure + emit the orphan-count metric (the `via`-signal regression guard) — wire it in once the eval set is relabeled

### 5. Land it
- [x] Committed (`6202526` + docs `4a3e12e`), pushed, **[PR #8](https://github.com/Syntalic/OASIS/pull/8) merged to `main`** (CI green), deployed to `oasis-mcp` (image v10).

---

## Pointers
- **Artifacts** (`scratchpad/`): `full-run-index.json` (31,810 pass + substrate), `full-run-all.json` (all records), `wellknown.json`, `run-ingest.mjs`, `re-grade.mjs`, `wellknown-probe.mjs`
- **Memory:** `agentic-payments-discovery-standard`, `oasis-ingestion-overhaul`, `oasis-production-binding-is-heuristic`, `oasis-ingestion-quality-and-capture-gaps`, `oasis-endpoint-arm-masks-coverage-holes`
