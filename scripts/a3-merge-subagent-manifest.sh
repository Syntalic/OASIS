#!/usr/bin/env bash
# Merge per-cluster sub-agent JSON artifacts into spawn-manifest.json.
set -euo pipefail
SCRATCH="${1:?usage: a3-merge-subagent-manifest.sh <scratch-dir>}"
OUT_DIR="$SCRATCH/a3-subagents"
MANIFEST="$OUT_DIR/spawn-manifest.json"

node -e "
const fs=require('fs');
const path=require('path');
const dir='$OUT_DIR';
const clusters=fs.readdirSync(dir).filter(f=>f.startsWith('cluster-')&&f.endsWith('.json')&&!f.includes('manifest'));
const results=clusters.map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')));
const failed=results.filter(r=>!r.passed).length;
const manifest={
  generated_at:new Date().toISOString(),
  subagent_count:results.length,
  clusters_failed:failed,
  clusters:results
};
fs.writeFileSync('$MANIFEST', JSON.stringify(manifest,null,2));
console.log('spawn-manifest: '+results.length+' clusters, failed='+failed);
process.exit(failed);
"