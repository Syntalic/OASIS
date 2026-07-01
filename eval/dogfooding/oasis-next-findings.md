# OASIS Next — findings (durable)

The per-run dogfood chain log was **regenerated (full overwrite) on every dogfood run** (not kept in
git), so durable analysis lives here instead. Two threads: the `oasis_next` ranking work (done) and
the foundation issues under it (open).

## 1. `oasis_next` ranking — DONE (graph + topical relevance)

Shipped in `src/entity-flow-traverse.ts` + `mcp/tools.mjs` (uncommitted):
- **act-filter** — a bridge must *investigate* the held identity, not act on it. Drops consume-to-act
  intents (`cloud.domains`/register, `comms.send`). `ACT_ACTIONS = {send, provision, transform, execute}`.
- **topical ranking** — `score = structural(port-match) × topical(finding↔intent) + small domain/quality nudges`.
  Topical reuses `oasis_find`'s hybrid search on the finding; min-max'd across candidates, floored
  (`TOPIC_FLOOR=0.15`).
- **same-domain allowed** — removed the hard cross-domain gate; cross-domain is now a +0.05 nudge, not a gate.
- **relevance floor** — prunes tangential bridges (`RELEVANCE_FLOOR=0.3`); spread caps `PER_ENTITY=3`,
  `PER_DOMAIN=2`. All named constants.

Before → after (dogfood):

| scenario | before | after (topical) |
|---|---|---|
| Sales — "Acme is **hiring**" | realestate/geocode noise; `job_search` *excluded* (same-domain) | **`job_search` #1** |
| Recruiter — `Company=Stripe` | Stripe dropped entirely | **`job_search` #1** ("jobs at Stripe") |
| Financial 2nd-hop — Musk | `influencer_search` nonsense | **pruned by the floor** |
| Marketing — "prices down 12%" | `competitive_landscape` buried 4th | pricing bridges **top** |
| Traveler — Tokyo | generic civic/weather/geocode | **`weather` #1** |

## 2. Foundation binder — SHIPPED ✓ (verified: eval usefulness / resolve / bridges all pass)

**Shipped (uncommitted):** mirror-dedup (`src/dedup-endpoints.ts`, run in enrich) removed **2,510** mirror
endpoints; ephemeral-preview gate (`quality-gate.ts`) dropped **459**; a discrimination/margin gate in
`bind-endpoints.ts` (`denseMargin=0.02`) **orphaned 3,077 spills** instead of binding them. Enrich now
re-gates + de-mirrors before binding, so this applies without a re-crawl. Result: `satellite-tile`/
`timezone`/`building-permits`/`facebook.company_ads` no longer surface; real endpoints do
(`2s.io/geo/postal`, `flight-status`, `twitter-x-api`, place search). `eval:usefulness` passes
(`bad_rate@8=0`, beats baseline 2×); `eval:resolve` all-yes; `eval:bridges` 9/9. **Re-bind needed only**
**for production crawl path; the enrich re-gate covers iteration.**

Remaining (deferred): the within-intent *representative* still picks some off endpoints by neutral
quality (`job_search → gov/usajobs`, `realestate → property-tax`) — needs the relevance-aware
representative (rank an intent's `satisfies[]` by the finding) + possibly a floor bump for tangential
residuals (realestate on a pricing/hiring finding).

### Original diagnosis (kept for context)
Ranking picks the right *intent*; the *endpoint* it resolves to was junk, due to binder spill.
Evidence (`selectEndpointsForIntent` top-6):
- `maps.geocode` (50 satisfies) → all `satellite-tile` / `satellite-address` / `timezone-lookup` (+ mirrors).
  **No real geocoder in the 50.**
- `realestate.property_lookup` → all `building-permits` / `construction-permit` (+ mirrors). **No listing in the 50.**

Three compounding faults:
1. **Binding spill** — `agentutility.ai` off-label endpoints bind on a single shared token ("address");
   on gemini the dense floor (0.78) barely filters (cosine ~0.78–0.82 for everything) and there's **no
   margin gate**, so a weak arg-max binds instead of orphaning. And **no satellite/imagery/permit intent
   exists** to land in.
2. **Mirror duplication** — `x402.agentutility.ai` ↔ `x402-deployer.…workers.dev` host identical paths;
   ingest dedups by **origin**, so every junk binding appears twice.
3. **Cap + neutral rank** — `MAX_SATISFIES = 50`, query-blind, surfaces the flood as the representative.

Fix (needs a re-bind): margin/discrimination gate in `src/embed/bind-endpoints.ts` (orphan, don't spill) ·
mirror dedup in `src/ingest/discover.ts` · gate out vercel-preview/template hosts (the 402index-junk
classes) · coverage intents for real capabilities · uncap + relevance-aware representative in
`materialize-satisfies.ts` / `score-endpoint.ts`.

## 3. Ontology port-typing — SHIPPED ✓
- `social.influencer_search` `Person` → **`Topic`** — no longer bridges from a held person (`eval:bridges`
  confirms it's correctly absent from `person_social_lookup`).
- `maps.places`, `travel.aviation`, `data.holidays-lookup` `Query` → **`Place`** — Tokyo now gets genuinely
  trip-relevant leads: **flights** (`travel.aviation → flight-status`), **local places** (`maps.places`),
  **weather**. This was the worst scenario before; now it's the best.
- Remaining (follow-up typing pass): other `Query`-only consumers (9 warnings left) where a typed identity
  applies — e.g. `data.gov-records → Person`, `data.lei-lookup → Company`. Not dogfood-blocking.

## 4. Open follow-ups (confirmed by the fresh full-build dogfood)
The major fixes all hold on a fresh production build. Two minor, non-blocking residuals remain:
- **Within-intent representative ranking** (the highest-value one). The bridge resolves the right *intent*
  but `selectEndpointsForIntent` (`rankEndpointsNeutral`, query-blind) picks an off endpoint:
  `data.job_search → 2s.io/api/gov/usajobs` (gov, not corporate), `realestate.property_lookup →
  property-tax-assessment`, `shop.find_deals → kyb/winloss`. Fix: rank an intent's `satisfies[]` by
  relevance (to the finding / the intent's own label) so the surfaced endpoint is the good one.
- **Preview-host gate gap.** `quality-gate.ts` `PREVIEW_HOST` catches `*-git-<branch>-*.vercel.app` but
  NOT the deploy-hash form `*-<hash>-<team>.vercel.app` (e.g. `apify-dlfd68ww7-merit-systems.vercel.app`
  leaked into a find). Extend the regex to the hash form; re-bind to apply.
- **Optuna calibration was flat** (40 trials, all `good_recall@6=0.667 / bad_rate@8=0`): the floors don't
  move `eval:usefulness` (7-valued, too coarse), so the hand-set defaults incl. `denseMargin=0.02` are
  fine *for what this eval sees*. Real lever = a sharper held-out eval, then re-run `eval/optuna`.
