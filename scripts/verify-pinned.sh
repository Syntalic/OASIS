#!/usr/bin/env bash
# OASIS Next — verification against the CURRENT production ingestion build.
#
# Builds the index exactly how we ship it — `cli.js ingest` (federated: CDP Bazaar +
# mpp.dev + pay.sh + x402scan) → `enrich-facets` (semantic bind @0.12 + entity-index/
# entity-flow emission) → `embed` — then verifies the oasis_next engine + find-quality
# on THAT index. The legacy `cli.js build` path is intentionally NOT exercised here.
#
#   GOOGLE_API_KEY=... bash scripts/verify-pinned.sh
#   SNAPSHOT=/path/merged.json bash scripts/verify-pinned.sh   # skip the crawl (fast/deterministic)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
DIST="$ROOT/dist"
SCRATCH="${SCRATCH:-/tmp/oasis-verify-$$}"; mkdir -p "$SCRATCH"
: "${GOOGLE_API_KEY:?GOOGLE_API_KEY required — production binding + embeddings use gemini}"
FAILED=0; pass(){ echo "  ✓ $1"; }; fail(){ echo "  ✗ $1"; FAILED=1; }

echo "=== build:ts ==="
pnpm run build:ts >"$SCRATCH/build-ts.log" 2>&1 && pass build:ts || { fail build:ts; tail -15 "$SCRATCH/build-ts.log"; exit 1; }

echo "=== ingest (production sources) ==="
if [ -n "${SNAPSHOT:-}" ]; then
  echo "  snapshot mode (no crawl): $SNAPSHOT"
  node dist/cli.js ingest --snapshot "$SNAPSHOT" -o "$DIST" >"$SCRATCH/ingest.log" 2>&1 || { fail ingest; tail -20 "$SCRATCH/ingest.log"; exit 1; }
else
  echo "  federated crawl: CDP Bazaar + mpp.dev + pay.sh + x402scan"
  node dist/cli.js ingest -o "$DIST" >"$SCRATCH/ingest.log" 2>&1 || { fail ingest; tail -20 "$SCRATCH/ingest.log"; exit 1; }
fi
grep -E "PASS|endpoints" "$SCRATCH/ingest.log" | tail -1 | sed 's/^/    /'; pass ingest

echo "=== enrich-facets (semantic bind @0.12 + entity emission) ==="
node dist/enrich-facets.js "$DIST" >"$SCRATCH/enrich.log" 2>&1 || { fail enrich; tail -20 "$SCRATCH/enrich.log"; exit 1; }
grep -E "hybrid binding|entity-flow" "$SCRATCH/enrich.log" | sed 's/^/    /'; pass enrich

echo "=== embed (curated lance, gemini) ==="
node dist/cli.js embed --scope curated -d "$DIST" -o "$DIST/lance" >"$SCRATCH/embed.log" 2>&1 && pass embed || { fail embed; tail -10 "$SCRATCH/embed.log"; }

echo "=== entity artifacts emitted by the production path? ==="
node -e "const fs=require('fs');const i=JSON.parse(fs.readFileSync('$DIST/entity-index.json'));JSON.parse(fs.readFileSync('$DIST/entity-flow.json'));const b=new Set(i.bridge_eligible||[]);process.exit(['Place','ProductCategory','Company','Person','Domain'].every(x=>b.has(x))&&i.spec_version==='0.3.0'?0:1)" \
  && pass "entity-index spec 0.3.0 + 5 bridges" || fail "entity artifacts"

echo "=== validate ==="
node dist/cli.js validate -d "$DIST" >"$SCRATCH/validate.log" 2>&1 && pass validate || { fail validate; tail -15 "$SCRATCH/validate.log"; }

echo "=== E1 eval:bridges ==="
node dist/cli.js eval:bridges -d "$DIST" >"$SCRATCH/e1.log" 2>&1 && pass "E1 bridges" || { fail E1; tail -6 "$SCRATCH/e1.log"; }

echo "=== E2 eval:usefulness ==="
node dist/cli.js eval:usefulness -d "$DIST" --json >"$SCRATCH/e2.json" 2>&1 && grep -q '"passed": true' "$SCRATCH/e2.json" && pass "E2 usefulness" || { fail E2; grep -E "passed|recall|beats" "$SCRATCH/e2.json" | head; }

echo "=== unit tests (test:unit + entity modules) ==="
pnpm run test:unit >"$SCRATCH/unit.log" 2>&1 && pass test:unit || { fail test:unit; tail -12 "$SCRATCH/unit.log"; }
OASIS_DIST_DIR="$DIST" node --test dist/entity-match.test.js dist/entity-extract.test.js dist/entity-flow-traverse.test.js >"$SCRATCH/entity.log" 2>&1 && pass "entity tests" || { fail "entity tests"; grep -E "✖|not ok" "$SCRATCH/entity.log" | head; }

echo "=== oasis_next probe (on the production index) ==="
OASIS_DIST_DIR="$DIST" node --input-type=module -e "
import('file://$ROOT/mcp/tools.mjs').then(async ({handleTool}) => {
  const r = await handleTool('oasis_next', {entities:[{entity:'Place',value:'Los Angeles, CA'},{entity:'ProductCategory',value:'consumer electronics'}], intent_id:'analyst.inflation_tracker', exclude_intent_ids:['analyst.inflation_tracker']});
  if (r.error || !(r.investigative||[]).length) { console.log('  ✗ oasis_next:', r.error?JSON.stringify(r.error):'no leads'); process.exit(1); }
  console.log('  ✓ oasis_next:', r.investigative.length, 'leads ('+r.investigative.map(i=>i.bridging_entity+'→'+i.intent_id).join(', ')+')');
}).catch(e=>{console.log('  ✗ threw:',e.message);process.exit(1);});
" || fail "oasis_next probe"

echo "=== eval:methods (find-quality on production corpus) ==="
node dist/cli.js eval:methods -d "$DIST" 2>&1 | tail -7

echo
[ "$FAILED" = 0 ] && echo "=== ✓ production-path verify GREEN ($SCRATCH) ===" || { echo "=== ✗ FAILURES above ($SCRATCH) ==="; exit 1; }
