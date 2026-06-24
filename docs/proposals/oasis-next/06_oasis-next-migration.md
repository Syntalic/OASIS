# OASIS Next — Migration & Cutover (Ship Runbook)

> **Parent:** [00_oasis-next-blueprint.md](./00_oasis-next-blueprint.md) · **Component:** F (Ship)
>
> **Depends on:** A–E complete ([01](./01_oasis-next-entity-model.md)–[05](./05_oasis-next-validation.md))
>
> **Status:** draft

---

## 0. Scope

**Changes:**

- `oasis_next` handler: the typed-link `relatedOptions` path → the entity-flow engine ([02](./02_oasis-next-engine.md), [03](./03_oasis-next-tool-api.md)).
- Entity model: updated `entity-vocab.json`, new `entity-subtypes.json`, re-typed `consumes`/`produces` on the 56 intents ([01](./01_oasis-next-entity-model.md)).
- New build artifacts + three `eval:*` tracks ([05](./05_oasis-next-validation.md)).

**Unchanged:**

- **`oasis_find`** — untouched. The entity enrichment can only help its resolve ranking; it is not a dependency.
- **`oasis_resolve` `related[]`** — keeps `relatedOptions` (the typed-link path) until a later, separate cleanup. Only `oasis_next` stops using it (§4).

---

## 1. Cutover sequence

Gated by the phase gates ([00 §2a](./00_oasis-next-blueprint.md)); this is the ship-side view.

| Stage | Action | Gate before proceeding |
|-------|--------|------------------------|
| **1. Entity model** | Land A1–A4; build the new artifacts (§3) | E1 on the built index + E3 (find no-regression) green |
| **2. Engine** | Build B; engine + precision tests | lateral precision ≥ target; zero non-matching leads |
| **3. Tool** | Land C; new output is default, legacy reachable via `OASIS_NEXT_LEGACY` ([03 §4.3](./03_oasis-next-tool-api.md)) | E2 beats the **catalog-aware** baseline ([05 §2.5](./05_oasis-next-validation.md)) |
| **4. Deploy** | Ship the image; the entity-flow `oasis_next` goes live | live `/health` + an investigate-loop smoke test pass |
| **5. Transition** | Legacy callers migrate off the old output groups (the flag bridges them) | — |
| **6. Cleanup** | Remove the legacy branch + the `deprecated` block | one release cycle after deploy |

**Graceful degrade is the deploy safety net:** the engine returns legacy output (NOT_READY) if `entity-flow.json` is missing or unreadable — a bad build cannot 500 the tool. This is the same discipline as the shipped `oasis_find` endpoint arm.

---

## 2. Rollback

Rollback is **config-only — no redeploy:**

- **Bad results after deploy** → set `OASIS_NEXT_LEGACY` to serve the legacy output groups again (fly secret / env); effective on restart.
- **Broken or missing artifacts** → the engine auto-degrades to legacy output (NOT_READY), no action needed.
- **Worst case** → revert the `oasisNext` handler commit. The entity-model artifacts are **additive** — safe to leave in place; nothing in the existing index is rewritten, so there is no destructive data migration to undo.

---

## 3. Artifacts & versioning

New / changed `dist/` files, all built **deterministically** (`scan:false`, pinned inputs — [01 §5.4](./01_oasis-next-entity-model.md)):

| Artifact | Status | Source |
|----------|--------|--------|
| `entity-vocab.json` | updated (identity/observation split) | `spec/` |
| `entity-subtypes.json` | **new** (narrow subtype graph) | `spec/` |
| `entity-index.json` | **new** (subtype closures + `bridge_eligible` + consume/produce indices) | build |
| `entity-flow.json` | **new** (forward + lateral adjacency) | build |

**Versioning:** each artifact carries its **own** `spec_version`, bumped independently — they are not one global version. `entity-index.json` at `0.3.0` next to `entity-flow.json` at `0.1.0` is expected, not a mismatch; the loader validates each file against its own expected version.

**Runtime:** the semantic-fit re-rank ([02 §5.1](./02_oasis-next-engine.md)) reuses the **same runtime query-embedding path** `oasis_find` already uses (`gemini-embedding-001`) — no new secret, service, or model.

---

## 4. Typed-link disposition

The old path is retired **only** for `oasis_next`:

- `relatedOptions` (`src/related.ts`), `inferred-links.json`, and `intent.links` **stay** — `oasis_resolve` `related[]` still uses them.
- Their `validate.ts` lints (`pipes_to_flow`, inverse-link materialization) stay green; nothing is removed in this cutover.
- Migrating `related[]` onto the entity-flow index is a later, separate cleanup — out of scope here.

---

## 5. `feat/oasis-next-quality`

**Do not merge as-is.** Its prunes and notes polished the *old* typed-link graph, most of which the entity-flow redesign moots. But its **prune list is useful input to A**: the bogus "alternatives" it flagged are exactly the bad bridges the entity model must not recreate. Decision: mine it for A1/A3 fixtures, then close the branch.

---

## 6. Deploy mechanics

Same path as the shipped server (see [`mcp/deploy/`](../../../mcp/deploy/)):

- `fly deploy --config mcp/deploy/fly.toml --build-secret GOOGLE_API_KEY=$GOOGLE_API_KEY` from the repo root (build context = repo root).
- The Dockerfile builds the new artifacts and re-embeds the curated intents in-image; `.dockerignore` excludes `dist/cache`.
- Bump the boot grace period if engine load adds startup time (the arm boot already moved it to 45s).
- **Never** echo or hardcode `GOOGLE_API_KEY` — it is passed as a build-secret argv only.

Post-deploy: re-run the dogfooding battery against the deployed ref to confirm `oasis_find` is flat and `oasis_next` surfaces useful, callable leads.

---

## 7. Acceptance (cutover done)

- [ ] New artifacts build deterministically in CI; each validates against its own `spec_version`.
- [ ] `oasis_next` served by the entity-flow engine; legacy output reachable via `OASIS_NEXT_LEGACY`.
- [ ] Engine auto-degrades to legacy output when `entity-flow.json` is absent (verified).
- [ ] Rollback verified: toggling `OASIS_NEXT_LEGACY` restores old output with **no redeploy**.
- [ ] `oasis_find` + `oasis_resolve related[]` unchanged in behavior (E3 + a resolve smoke test).
- [ ] Re-dogfood after deploy shows no `oasis_find` regression.
- [ ] `feat/oasis-next-quality` mined and closed; `deprecated` block + legacy branch removed one release after deploy.
