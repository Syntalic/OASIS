# OASIS discovery benchmark (vs. a vector-search baseline)

A repeatable side-by-side: does the **#1** result from `oasis_find` actually perform a natural-language
task, vs. an independent control (a vector-search baseline's `search`). Measures #1-correctness match-rate, blind-judged,
with loss attribution. Results + analysis: [`docs/benchmarks/discovery-benchmark.md`](../../docs/benchmarks/discovery-benchmark.md).

## What's here
- `queries.json` — 240 blind queries (3 styles × 80 intents), LLM-generated from task definitions only.
  ⚠️ Generated from OASIS's *own* intents → home-turf bias (favours OASIS routing; the measured gap
  is a floor). The next iteration should use a **neutral** (non-OASIS-derived) query set.
- `calib.json` — 21 hand-labeled (query, endpoint, on_task) pairs to validate the judge.

## Harness (`scripts/benchmark/`)
All scripts read the working dir from `BENCH_DIR` and the repo from `OASIS_ROOT` (default `cwd`).
Run from the repo root with `GOOGLE_API_KEY` set.

```bash
export BENCH_DIR=/tmp/oasis-bench && mkdir -p $BENCH_DIR
cp eval/benchmark/queries.json eval/benchmark/calib.json $BENCH_DIR/
set -a; . ./.env; set +a            # GOOGLE_API_KEY

# 1. (optional) regenerate the query set from current intents
#    node -e '…extract dist capabilities → $BENCH_DIR/intents.json' ; node scripts/benchmark/gen-queries.mjs

# 2. OASIS arms (local oasis_find via handleTool) — gate off + scoped
RATE_LIMIT=0 node scripts/benchmark/oasis-arms.mjs $BENCH_DIR/oasis_off.json
RATE_LIMIT=0 OASIS_ACTION_PENALTY=30 OASIS_DOMAIN_PENALTY=10 OASIS_ENTITY_PENALTY=25 \
  OASIS_GATED_INTENTS="cloud.domains,travel.place_reviews" \
  node scripts/benchmark/oasis-arms.mjs $BENCH_DIR/oasis_scoped.json

# 3. Baseline arm — collect via a vector-search discovery MCP's `search` tool (sub-agents or an MCP client),
#    writing $BENCH_DIR/baseline.json = { "<qid>": [{url,summary,score}], ... }

# 4. validate the judge, then judge all arms (blind, deduped union of top-3)
node scripts/benchmark/judge.mjs --calibrate     # expect ~95% vs calib.json
node scripts/benchmark/judge.mjs                  # → judgments.json

# 5. score + attribute
node scripts/benchmark/score.mjs                  # P@1/P@3, head-to-head, gate contribution
RATE_LIMIT=0 node scripts/benchmark/attribute.mjs # loss buckets (routing / binding / ranking)
node scripts/benchmark/coverage.mjs               # split losses by whether the baseline's host is in OASIS's corpus
```

## Known limitations (see the report's caveats)
- Judge is gemini-3.5-flash, ~95% on 21 items (wide CI); its exclusion examples are tuned on observed
  OASIS failures (mild overfit).
- Attribution has **no usage-data bucket** — do not read it as "losses aren't usage-data"; a buried-but-
  present correct endpoint (the "ranking" bucket) is exactly what a usage/popularity prior would fix.
- `attribute.mjs` calls routing "ok" on a top-3 match while the headline is top-1 — under top-1, routing
  misses are ~7.5%, not 0%.
