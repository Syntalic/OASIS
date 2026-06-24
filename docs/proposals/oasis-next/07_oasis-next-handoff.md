# OASIS Next v1 — Implementation Handoff

> **Parent:** [00_oasis-next-blueprint.md](./00_oasis-next-blueprint.md) · **Ship runbook:** [06_oasis-next-migration.md](./06_oasis-next-migration.md)
>
> **Status:** implemented (v1), verification green on pinned harness
>
> **Date:** 2026-06-24

---

## 1. Executive summary

OASIS Next v1 replaces the hand-authored typed-link `oasis_next` path with an **entity-flow traversal engine** over the curated ontology. An agent that holds a typed identity (`Place`, `Company`, `Person`, `ProductCategory`, or `Domain`) can surface **cross-domain investigative leads** — capabilities that consume that same identity and are provably callable.

**What shipped:**

| Phase | Component | Outcome |
|-------|-----------|---------|
| A1–A4 | Entity model | `entity-vocab.json` v0.3.0, new `entity-subtypes.json`, ~18 intents re-typed, binding patch |
| B | Traversal engine | `entity-index.json` + `entity-flow.json` built deterministically; lateral matching (exact + one-hop parent) |
| C | `oasis_next` handler | Investigative output with `bridging_entity`, bound `endpoint`, `forward: []`; legacy behind `OASIS_NEXT_LEGACY=1` |
| D | Skill | `mcp/skills/oasis-investigate.md` — find → call → reflect → next loop |
| E1–E3 | Evals | Bridge validation (9/9), usefulness vs catalog-aware baseline, find regression gate |
| F | Ship tooling | `scripts/verify-pinned.sh` (sole verification entry), MCP registry sync, A3 cluster gates |

**What did not ship (v2):** forward chaining on observations, crypto bridges (`CryptoAsset` / `WalletAddress`), identity→identifier derivation, `oasis_resolve` `related[]` migration.

---

## 2. Architecture map

```
  Interface   D. Skill (oasis-investigate)     C. oasis_next (mcp/tools.mjs)
                    │                                    │
  Logic             └──────────────► B. entity-flow-traverse ◄┘
                                         │
  Data                                   A. entity-vocab + subtypes + re-typed intents
```

| Doc | Topic |
|-----|-------|
| [01](./01_oasis-next-entity-model.md) | Identity vs observation split, five v1 bridges, narrow subtype graph |
| [02](./02_oasis-next-engine.md) | Index build, lateral traversal, semantic re-rank |
| [03](./03_oasis-next-tool-api.md) | MCP input/output schema, handler contract |
| [04](./04_oasis-next-skill.md) | Investigate loop spec |
| [05](./05_oasis-next-validation.md) | E1/E2/E3 eval definitions |
| [06](./06_oasis-next-migration.md) | Cutover, rollback, artifact versioning |

---

## 3. v1 normative rules

These constraints are enforced in code and verified by `verify-pinned.sh`:

1. **Five identity bridges only:** `Place`, `ProductCategory`, `Company`, `Person`, `Domain`. `CryptoAsset` and `WalletAddress` are filtered at runtime.
2. **Matching:** exact entity type or one-hop parent from `entity-subtypes.json` — no broad compatibility root.
3. **`forward` always `[]`** in v1 output (top-level and per-item).
4. **Query and observation entities never seed lateral leads** — only declared identity entities do.
5. **`oasis_find` and `oasis_resolve` unchanged** — `related[]` still uses typed links.
6. **Rollback:** set `OASIS_NEXT_LEGACY=1` to serve legacy output groups (`next_steps`, `drill_down`, etc.).

---

## 4. Key files

Full change list (59 paths): see `CHANGED_FILES_OASIS.txt` in the verification scratch dir, or run `scripts/generate-changed-files.sh`.

### Data / ontology

| Path | Role |
|------|------|
| `spec/entity-vocab.json` | v0.3.0 — `kind`, `bridge_eligible` |
| `spec/entity-subtypes.json` | Narrow place/brand parent graph |
| `ontology/intents/*.yaml` | Re-typed `consumes` / `produces` on curated intents |
| `ontology/bindings/oasis-next-v1.yaml` | Semantic links for bridge intents missing bindings |

### Engine

| Path | Role |
|------|------|
| `src/entity-index.ts` | Build consume/produce indices + subtype closures |
| `src/entity-flow.ts` | Forward + lateral adjacency |
| `src/entity-flow-traverse.ts` | Runtime traversal + ranking |
| `src/entity-match.ts` | Port matching (exact + one-hop) |
| `src/entity-extract.ts` | Heuristic extraction from `finding` text |
| `src/build.ts` | Emits `entity-index.json`, `entity-flow.json` |

### Handler / MCP

| Path | Role |
|------|------|
| `mcp/tools.mjs` | `oasis_next` rewrite — `suggestFollowUps()`, investigative groups |
| `mcp/skills/oasis-investigate.md` | Agent skill for the investigate loop |
| `scripts/sync-mcp-registry.mjs` | Syncs `MCP_TOOLS` → `~/.grok/projects/.../mcps/oasis/tools/` |

### Evals / fixtures

| Path | Role |
|------|------|
| `src/eval/bridge-validation.ts` | E1 — lateral precision on bridge scenarios |
| `fixtures/bridge-scenarios.json` | E1 fixture (9 scenarios) |
| `src/eval/usefulness-eval.ts` | E2 — recall vs catalog-aware baseline |
| `fixtures/investigation-scenarios.json` | E2 fixture |
| `fixtures/baselines/find-pre-a3.json` | E3 pre-A3 baseline |
| `scripts/assert-e3-regression.mjs` | E3 regression assert |

### Verification / ship

| Path | Role |
|------|------|
| `scripts/verify-pinned.sh` | **Sole verification entry** — run this |
| `scripts/a3-subagent-gate.sh` | A3 cluster gate verify (`--verify` only) |
| `src/test-helpers.ts` | `OASIS_PINNED` skips for corpus benchmarks |
| `fixtures/dogfood-log.md` | Three manual investigate scenarios |

---

## 5. Build artifacts

Deterministic pinned build (`scan:false`, `--no-x402scan --no-mppscan`):

| Artifact | `spec_version` | Source |
|----------|----------------|--------|
| `entity-index.json` | 0.3.0 | `src/entity-index.ts` via `build` |
| `entity-flow.json` | 0.1.0 | `src/entity-flow.ts` via `build` |
| `entity-vocab.json` | 0.3.0 | copied from `spec/` |
| `entity-subtypes.json` | — | copied from `spec/` |

Pinned output directory: `dist-pinned/` (gitignored). Operational full build writes to `dist/`.

```bash
cd /Users/azad/dev/open-source/OASIS
pnpm run build:ts
node dist/cli.js build --pay-skills ../../crush/api/pay-skills --no-x402scan --no-mppscan -o dist-pinned
```

---

## 6. MCP runtime

### Input shape (`oasis_next`)

Preferred: explicit entities after a reflect step.

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

`finding` alone triggers heuristic extraction (`src/entity-extract.ts`). `query` is deprecated but still routes when `intent_id` is omitted.

### Output shape (v1)

```json
{
  "investigative": [
    {
      "intent_id": "data.weather-forecast",
      "why": "…",
      "bridging_entity": "Place",
      "endpoint": { "url": "…", "method": "…" },
      "forward": []
    }
  ],
  "suggestFollowUps": true,
  "forward": []
}
```

Legacy groups (`next_steps`, `drill_down`, `generalize`, `alternatives`, `prior_steps`) emit only when `OASIS_NEXT_LEGACY=1`.

### MCP registry sync

The Grok MCP descriptor at `~/.grok/projects/Users-azad/mcps/oasis/tools/oasis_next.json` is **not** the source of truth — it is generated from `mcp/tools.mjs`:

```bash
node scripts/sync-mcp-registry.mjs
```

Run sync after any handler change and at the end of verification (the harness can revert tracked registry files).

### Handler smoke probe

```bash
node --input-type=module -e "
import('./mcp/tools.mjs').then(async ({handleTool}) => {
  const r = await handleTool('oasis_next', {
    entities: [{entity: 'Place', value: 'Los Angeles, CA'}],
    intent_id: 'analyst.inflation_tracker',
    exclude_intent_ids: []
  });
  console.log(JSON.stringify(r, null, 2));
});
"
```

Expect: non-empty `investigative[]`, each item has `bridging_entity` + `endpoint.url`, all `forward` arrays empty.

---

## 7. Agent workflow

Load skill: `mcp/skills/oasis-investigate.md`

```
find → call → reflect → next → synthesize
```

| Step | Tool | Notes |
|------|------|-------|
| find | `oasis_find` | Initial API discovery |
| call | HTTP + payment | Execute the endpoint |
| reflect | (markdown) | Declare **identities held** — required before `oasis_next` |
| next | `oasis_next` | Cross-domain follow-ups on held identities |
| synthesize | (markdown) | Combine evidence |

**Controller rule:** same task, different provider → `oasis_find` again, not `oasis_next`. Different data point to explain the finding → `oasis_next`.

Dogfood scenarios: `fixtures/dogfood-log.md` (3 cases).

---

## 8. Verification

### One command

```bash
SCRATCH=/tmp/oasis-verify-$(date +%s) bash scripts/verify-pinned.sh
```

Requires: `SCRATCH` env var, `pay-skills` path (defaults to `../../crush/api/pay-skills` from repo root).

### Last successful run (2026-06-24)

**Scratch:** `/var/folders/j2/l80bqdwd2lx4s3df2m6flrxw0000gn/T/grok-goal-d14abf49a467/implementer`  
**Exit code:** 0

| Gate | Result | Evidence file |
|------|--------|---------------|
| Pinned build ×2 | `spec_version` 0.3.0, 5 `bridge_eligible` | `entity-artifacts-check.log` |
| E1 `eval:bridges` | **9/9** | `eval-bridges.log` |
| E2 `eval:usefulness` | passed; `good_recall@6=0.833`; `beats_baseline=true` | `eval-usefulness.json` |
| E3 regression | disc@1: 85.7% → 90.5%; disc@3: 87.3% → 95.2%; MRR: 0.872 → 0.930 | `e3-regression.log` |
| Unit tests | **26 pass, 0 fail** (12 `test:unit` + 14 entity/traverse) | `pnpm-test.log` |
| MCP probe | RUN1 ≡ RUN2; investigative + `bridging_entity` + `forward:[]` | `oasis-next-launch.log` |
| MCP registry | v1 schema (`finding`, `entities`; no `drill_down`) | post-probe re-sync |
| A3 sub-agents | 7 harness gates verified | `a3-gates.log`, `a3-subagents/spawn-evidence.json` |

Honest caveat: verify runs **26** targeted tests, not full `pnpm test` (38). Full corpus tests require an operational index build and are exercised in the E3 full-build step, not the pinned unit-test stage.

### Individual eval commands

```bash
# E1 — bridge lateral precision
node dist/cli.js eval:bridges -d dist-pinned

# E2 — investigative usefulness vs baseline
node dist/cli.js eval:usefulness -d dist-pinned --json

# E3 — find regression (needs full operational dist/)
node dist/cli.js eval:methods -d dist --out /tmp/find-post.json
node scripts/assert-e3-regression.mjs fixtures/baselines/find-pre-a3.json /tmp/find-post.json
```

### E2 metrics (last run)

| Metric | Value |
|--------|-------|
| `callable_precision` | 1.0 |
| `lateral_relevance_precision` | 1.0 |
| `identity_recall` | 1.0 |
| `good_recall_at_6` | 0.833 |
| `bad_rate_at_8` | 0 |
| Baseline `good_recall_at_6` | 0.333 |
| `beats_baseline` | true |

---

## 9. A3 cluster gates

Intent re-typing (A3) was validated per semantic cluster via harness Task sub-agents. Gate artifacts:

```
~/.grok/projects/Users-azad/mcps/oasis/gates/a3-*.json
```

Verify existing gates (does not re-run sub-agents):

```bash
SCRATCH=/tmp/a3-verify GATES_DIR=~/.grok/projects/Users-azad/mcps/oasis/gates \
  bash scripts/a3-subagent-gate.sh --verify
```

`--all` (local cluster re-validation) is **disabled** — use harness sub-agents for fresh A3 runs. Spawn evidence: `$SCRATCH/a3-subagents/spawn-evidence.json`.

---

## 10. Rollback and degrade

From [06_oasis-next-migration.md](./06_oasis-next-migration.md):

| Situation | Action |
|-----------|--------|
| Bad investigative results after deploy | Set `OASIS_NEXT_LEGACY=1` (fly secret / env); restart |
| Missing or corrupt `entity-flow.json` | Engine auto-degrades to legacy output (`NOT_READY`) — no 500 |
| Worst case | Revert `oasisNext` handler commit; entity-model artifacts are additive and safe to leave |

---

## 11. Deferred v2

- Forward chaining on observation entities (`WeatherReport`, `PriceSignal`, …)
- `CryptoAsset` / `WalletAddress` bridges + identity→identifier derivation
- Non-empty `forward[]` in output
- Migrate `oasis_resolve` `related[]` off typed links
- Remove `OASIS_NEXT_LEGACY` branch after one release cycle

---

## 12. Known limitations

1. **Pinned vs full corpus:** staging `dist-pinned` into `dist/` for unit tests breaks 8 corpus benchmark tests if the operational Lance index is missing. Verify intentionally uses `test:unit` + entity module tests only.
2. **MCP registry drift:** harness environments may revert `oasis_next.json` to legacy schema — always run `sync-mcp-registry.mjs` after handler work.
3. **E2 recall not 1.0:** `good_recall@6=0.833` passes the gate but leaves headroom; investigate failing scenarios in `fixtures/investigation-scenarios.json`.
4. **Not committed:** changes exist locally under `/Users/azad/dev/open-source/OASIS`; no git commit or CI wiring yet.
5. **No live deploy:** fly deploy / MCP server restart not performed in this implementation pass.

---

## 13. Evidence and session artifacts

| Artifact | Path |
|----------|------|
| Verification scratch | `/var/folders/j2/l80bqdwd2lx4s3df2m6flrxw0000gn/T/grok-goal-d14abf49a467/implementer/` |
| Results summary | `…/verification-plan-results.md` |
| Changed files list | `…/CHANGED_FILES_OASIS.txt` |
| Full session transcript | `/Users/azad/.grok/sessions/%2FUsers%2Fazad/019ef9e6-ce26-7182-9de3-40a272792557/updates.jsonl` |
| Implementation blueprint | `/Users/azad/.grok/sessions/%2FUsers%2Fazad/019ef9e6-ce26-7182-9de3-40a272792557/goal/plan.md` |

---

## 14. Suggested next steps

1. **Commit** — review `CHANGED_FILES_OASIS.txt`, exclude `dist-pinned/`, land on `feat/oasis-next-quality` (per [06 §5](./06_oasis-next-migration.md)).
2. **CI** — wire `SCRATCH=$RUNNER_TEMP bash scripts/verify-pinned.sh` as the merge gate.
3. **Deploy** — ship image; set fly secrets; smoke the investigate loop against live `/health`.
4. **Full test suite** — add CI job with operational build so all 38 tests run green.
5. **v2 planning** — forward chaining and crypto bridges per [00 §0a](./00_oasis-next-blueprint.md).

---

## 15. Quick reference

```bash
# Verify everything
SCRATCH=/tmp/oasis-verify bash scripts/verify-pinned.sh

# Sync MCP descriptors
node scripts/sync-mcp-registry.mjs

# Build pinned artifacts
pnpm run build:ts && node dist/cli.js build --pay-skills ../../crush/api/pay-skills \
  --no-x402scan --no-mppscan -o dist-pinned

# Legacy rollback (runtime)
export OASIS_NEXT_LEGACY=1
```