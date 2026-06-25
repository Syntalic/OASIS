#!/usr/bin/env bash
# A3 cluster gate — validate intent YAMLs, write harness-tracked gate JSON.
# Invoked per-cluster by Task sub-agents (AGENT_ID + HARNESS_AGENT_ID required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GATES_DIR="${GATES_DIR:-$HOME/.grok/projects/Users-azad/mcps/oasis/gates}"
mkdir -p "$GATES_DIR"
cd "$ROOT"

validate_cluster() {
  local cluster="$1"
  shift
  local out="$GATES_DIR/a3-${cluster}.json"
  local agent_id="${HARNESS_AGENT_ID:-${AGENT_ID:-unknown}}"
  local log="${SCRATCH:-/tmp}/a3-gate-${cluster}.log"
  mkdir -p "$(dirname "$log")"
  local started ended
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local ok=0 fail=0
  local files_json="["

  {
    echo "cluster=$cluster harness_agent_id=$agent_id started_at=$started"
    echo "invoked_by=harness_task_subagent"
    for f in "$@"; do
      echo "--- validate $f ---"
      if node dist/cli.js validate-source "$f"; then
        ok=$((ok + 1))
        files_json+="{\"path\":\"$f\",\"valid\":true},"
      else
        fail=$((fail + 1))
        files_json+="{\"path\":\"$f\",\"valid\":false},"
      fi
    done
  } >"$log" 2>&1

  files_json="${files_json%,}]"
  ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local passed="false"
  [ "$fail" -eq 0 ] && passed="true"

  cat >"$out" <<EOF
{
  "cluster": "$cluster",
  "harness_agent_id": "$agent_id",
  "agent_id": "$agent_id",
  "invoked_by": "harness_task_subagent",
  "started_at": "$started",
  "ended_at": "$ended",
  "valid": $ok,
  "failed": $fail,
  "passed": $passed,
  "log_path": "$log",
  "files": $files_json
}
EOF

  echo "a3-gate $cluster → $out (harness_agent_id=$agent_id valid=$ok failed=$fail)"
  return "$fail"
}

if [ "${1:-}" = "--verify" ]; then
  fail=0
  for cluster in maps-travel-realestate shop-marketing-analyst finance-crypto-compute data ai-search-web comms-media-social agent-devtools-storage-cloud; do
    gate="$GATES_DIR/a3-${cluster}.json"
    if [ ! -f "$gate" ]; then
      echo "MISSING gate: $gate" >&2
      fail=$((fail + 1))
      continue
    fi
    if ! node -e "const j=JSON.parse(require('fs').readFileSync('$gate','utf8')); if(!j.passed) process.exit(1); if(j.invoked_by!=='harness_task_subagent') process.exit(2)"; then
      echo "FAILED gate: $gate" >&2
      fail=$((fail + 1))
    else
      echo "OK gate: $gate (harness_agent_id=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$gate','utf8')).harness_agent_id)"))"
    fi
  done
  exit "$fail"
fi

if [ "${1:-}" = "--all" ]; then
  echo "ERROR: --all is disabled; use harness Task sub-agents per cluster" >&2
  exit 1
fi

# Single cluster mode: a3-subagent-gate.sh <cluster-id> <yaml...>
CLUSTER="$1"
shift
validate_cluster "$CLUSTER" "$@"