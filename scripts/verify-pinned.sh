#!/usr/bin/env bash
# OASIS Next v1 — sole verification entry (deterministic pinned + E3 full corpus).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="${SCRATCH:?SCRATCH env required}"
DIST="$ROOT/dist-pinned"
PAY_SKILLS="${PAY_SKILLS:-$ROOT/../../crush/api/pay-skills}"
MCP_REGISTRY="$HOME/.grok/projects/Users-azad/mcps/oasis/tools"
GATES_DIR="$HOME/.grok/projects/Users-azad/mcps/oasis/gates"
mkdir -p "$SCRATCH" "$GATES_DIR"

cd "$ROOT"

echo "=== build:ts ===" | tee "$SCRATCH/build-ts.log"
pnpm run build:ts 2>&1 | tee -a "$SCRATCH/build-ts.log"

echo "=== sync MCP registry ===" | tee "$SCRATCH/sync-mcp-registry.log"
node scripts/sync-mcp-registry.mjs 2>&1 | tee -a "$SCRATCH/sync-mcp-registry.log"

echo "=== A3 sub-agent gates (verify harness artifacts) ===" | tee "$SCRATCH/a3-gates.log"
SCRATCH="$SCRATCH" GATES_DIR="$GATES_DIR" bash "$ROOT/scripts/a3-subagent-gate.sh" --verify 2>&1 | tee -a "$SCRATCH/a3-gates.log"

echo "=== build 1 (pinned) ===" | tee "$SCRATCH/build-1.log"
node dist/cli.js build --pay-skills "$PAY_SKILLS" --no-x402scan --no-mppscan -o "$DIST" 2>&1 | tee -a "$SCRATCH/build-1.log"

echo "=== build 2 (pinned) ===" | tee "$SCRATCH/build-2.log"
node dist/cli.js build --pay-skills "$PAY_SKILLS" --no-x402scan --no-mppscan -o "$DIST" 2>&1 | tee -a "$SCRATCH/build-2.log"

node -e "
const fs=require('fs');
const idx=JSON.parse(fs.readFileSync('$DIST/entity-index.json','utf8'));
const flow=JSON.parse(fs.readFileSync('$DIST/entity-flow.json','utf8'));
if(idx.spec_version!=='0.3.0') throw new Error('entity-index spec_version '+idx.spec_version);
const bridges=new Set(idx.bridge_eligible||[]);
const want=['Place','ProductCategory','Company','Person','Domain'];
for(const b of want){if(!bridges.has(b)) throw new Error('missing bridge '+b);}
if(bridges.size!==5) throw new Error('bridge_eligible count '+bridges.size);
if(!flow.spec_version) throw new Error('entity-flow missing spec_version');
console.log('entity artifacts ok: spec_version=0.3.0 bridges='+[...bridges].join(','));
" 2>&1 | tee "$SCRATCH/entity-artifacts-check.log"

node dist/cli.js embed -d "$DIST" -o "$DIST/lance" --scope curated 2>&1 | tee "$SCRATCH/embed-pinned.log"
node dist/cli.js validate -d "$DIST" 2>&1 | tee "$SCRATCH/validate-pinned.log"
node dist/cli.js eval:bridges -d "$DIST" 2>&1 | tee "$SCRATCH/eval-bridges.log"
node dist/cli.js eval:usefulness -d "$DIST" --json 2>&1 | tee "$SCRATCH/eval-usefulness.json"

echo "=== stage pinned → dist/ (unit tests) ===" | tee "$SCRATCH/stage-pinned.log"
for f in index.json entity-index.json entity-flow.json; do
  cp "$DIST/$f" "$ROOT/dist/$f"
done
rm -rf "$ROOT/dist/lance"
cp -R "$DIST/lance" "$ROOT/dist/lance"

export OASIS_DIST_DIR="$DIST"

echo "=== unit tests (test:unit + entity modules + traverse) ===" | tee "$SCRATCH/pnpm-test.log"
pnpm run test:unit 2>&1 | tee -a "$SCRATCH/pnpm-test.log"
node --test dist/entity-match.test.js dist/entity-extract.test.js dist/entity-flow-traverse.test.js 2>&1 | tee -a "$SCRATCH/pnpm-test.log"

echo "=== E3 full operational build ===" | tee "$SCRATCH/build-full.log"
node dist/cli.js build --pay-skills "$PAY_SKILLS" -o "$ROOT/dist" 2>&1 | tee -a "$SCRATCH/build-full.log"

echo "=== E3 baseline capture ===" | tee "$SCRATCH/e3-regression.log"
cp "$ROOT/fixtures/baselines/find-pre-a3.json" "$SCRATCH/find-pre-a3.json"
node dist/cli.js eval:methods -d "$ROOT/dist" --out "$SCRATCH/find-post-a3-run1.json" 2>&1 | tee -a "$SCRATCH/e3-regression.log"
node dist/cli.js eval:methods -d "$ROOT/dist" --out "$SCRATCH/find-post-a3-run2.json" 2>&1 | tee -a "$SCRATCH/e3-regression.log"
cp "$SCRATCH/find-post-a3-run1.json" "$SCRATCH/find-post-a3.json"
node scripts/assert-e3-regression.mjs "$SCRATCH/find-pre-a3.json" "$SCRATCH/find-post-a3.json" 2>&1 | tee -a "$SCRATCH/e3-regression.log"
node dist/cli.js eval:methods -d "$ROOT/dist" 2>/dev/null | tee "$SCRATCH/eval-methods-full.log"

node dist/cli.js --help 2>&1 | tee "$SCRATCH/cli-help.log"
grep -q 'eval:bridges' "$SCRATCH/cli-help.log"
grep -q 'eval:usefulness' "$SCRATCH/cli-help.log"

echo "=== MCP oasis_next handler probe ===" | tee "$SCRATCH/oasis-next-launch.log"
node --input-type=module -e "
import('file://$ROOT/mcp/tools.mjs').then(async ({handleTool}) => {
  const args = {entities: [{entity: 'Place', value: 'Los Angeles, CA'}], intent_id: 'analyst.inflation_tracker', exclude_intent_ids: []};
  const r1 = await handleTool('oasis_next', args);
  const r2 = await handleTool('oasis_next', args);
  const check = (r) => {
    if (r.error) throw new Error(JSON.stringify(r.error));
    if (!Array.isArray(r.investigative) || r.investigative.length === 0) throw new Error('empty investigative');
    for (const item of r.investigative) {
      if (!item.bridging_entity) throw new Error('missing bridging_entity');
      if (!item.endpoint?.url) throw new Error('missing endpoint');
      if (!Array.isArray(item.forward) || item.forward.length !== 0) throw new Error('forward must be []');
    }
    if (!Array.isArray(r.forward) || r.forward.length !== 0) throw new Error('top forward must be []');
  };
  check(r1); check(r2);
  console.log('RUN1:', JSON.stringify(r1, null, 2));
  console.log('RUN2:', JSON.stringify(r2, null, 2));
  console.log('MCP probe ok: investigative='+r1.investigative.length);
});
" 2>&1 | tee -a "$SCRATCH/oasis-next-launch.log"

node --input-type=module -e "
import('file://$ROOT/mcp/tools.mjs').then(async ({handleTool}) => {
  const r = await handleTool('oasis_next', {finding: 'Investigate acme.com domain footprint in Austin, TX', intent_id: 'data.whois_lookup', exclude_intent_ids: []});
  console.log(JSON.stringify(r, null, 2));
});
" 2>&1 | tee "$SCRATCH/oasis-next-heuristic-probe.json"

# Hard assertions
grep -q '"entities"' "$MCP_REGISTRY/oasis_next.json"
grep -q '"finding"' "$MCP_REGISTRY/oasis_next.json"
grep -qi 'cross-domain\|investigative\|bridging' "$MCP_REGISTRY/oasis_next.json"
if grep -q 'drill_down\|next_steps' "$MCP_REGISTRY/oasis_next.json"; then
  echo "FAIL: oasis_next.json legacy schema" >&2
  exit 1
fi
grep -q 'E1 bridge validation: 9/9' "$SCRATCH/eval-bridges.log"
grep -q '"passed": true' "$SCRATCH/eval-usefulness.json"
grep -q 'E3 regression gate passed' "$SCRATCH/e3-regression.log"
tail -8 "$SCRATCH/pnpm-test.log" | grep -qE 'ℹ fail 0'

bash "$ROOT/scripts/generate-changed-files.sh" "$SCRATCH"

# Re-sync MCP registry after handler probes (harness may revert tracked files).
echo "=== re-sync MCP registry (post-probe) ===" | tee -a "$SCRATCH/sync-mcp-registry.log"
node scripts/sync-mcp-registry.mjs 2>&1 | tee -a "$SCRATCH/sync-mcp-registry.log"
grep -q '"entities"' "$MCP_REGISTRY/oasis_next.json"
grep -q '"finding"' "$MCP_REGISTRY/oasis_next.json"
! grep -q 'drill_down' "$MCP_REGISTRY/oasis_next.json"

echo "verify-pinned complete → $SCRATCH"