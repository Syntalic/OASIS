#!/usr/bin/env bash
# A3 cluster validation artifact — one harness sub-agent invocation.
# Writes JSON + log under SCRATCH/a3-subagents/.
set -euo pipefail
CLUSTER="${1:?usage: a3-subagent-artifact.sh <cluster-id> <yaml...>}"
shift
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="${SCRATCH:?SCRATCH env required}"
AGENT_ID="${AGENT_ID:-local}"
OUT_DIR="$SCRATCH/a3-subagents"
mkdir -p "$OUT_DIR"
cd "$ROOT"

LOG="$OUT_DIR/cluster-${CLUSTER}.log"
JSON="$OUT_DIR/cluster-${CLUSTER}.json"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OK=0
FAIL=0
FILES_JSON="["

{
  echo "cluster=$CLUSTER"
  echo "agent_id=$AGENT_ID"
  echo "started_at=$STARTED"
  for f in "$@"; do
    echo "--- validate $f ---"
    if node dist/cli.js validate-source "$f"; then
      OK=$((OK+1))
      FILES_JSON+="{\"path\":\"$f\",\"valid\":true},"
    else
      FAIL=$((FAIL+1))
      FILES_JSON+="{\"path\":\"$f\",\"valid\":false},"
    fi
  done
  ENDED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "summary valid=$OK failed=$FAIL"
  echo "ended_at=$ENDED"
} >"$LOG" 2>&1

FILES_JSON="${FILES_JSON%,}]"
ENDED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat >"$JSON" <<EOF
{
  "cluster": "$CLUSTER",
  "agent_id": "$AGENT_ID",
  "started_at": "$STARTED",
  "ended_at": "$ENDED",
  "valid": $OK,
  "failed": $FAIL,
  "passed": $( [ "$FAIL" -eq 0 ] && echo true || echo false ),
  "log_path": "$LOG",
  "files": $FILES_JSON
}
EOF

exit "$FAIL"