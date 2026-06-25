#!/usr/bin/env bash
# Comprehensive change manifest: OASIS repo porcelain (primary) + harness paths + scratch.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="${1:?usage: generate-changed-files.sh <scratch-dir>}"
OASIS_OUT="$SCRATCH/CHANGED_FILES_OASIS.txt"
MASTER_OUT="$SCRATCH/CHANGED_FILES"
GATES="$HOME/.grok/projects/Users-azad/mcps/oasis/gates"
MCP_TOOLS="$HOME/.grok/projects/Users-azad/mcps/oasis/tools"
mkdir -p "$SCRATCH"

cd "$ROOT"
git status --porcelain >"$OASIS_OUT"

{
  echo "# OASIS Next v1 — comprehensive change manifest"
  echo "# generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "## OASIS repository (git porcelain — $(wc -l <"$OASIS_OUT" | tr -d ' ') lines)"
  cat "$OASIS_OUT"
  echo ""
  echo "## Harness MCP tools (synced from mcp/tools.mjs via scripts/sync-mcp-registry.mjs)"
  for f in "$MCP_TOOLS"/*.json; do [ -f "$f" ] && echo "M $f"; done
  echo ""
  echo "## Harness A3 gates (Task sub-agents → scripts/a3-subagent-gate.sh)"
  for f in "$GATES"/a3-*.json; do [ -f "$f" ] && echo "A $f"; done
  echo ""
  echo "## Verification scratch artifacts"
  find "$SCRATCH" -maxdepth 2 -type f \( -name '*.log' -o -name '*.json' -o -name '*.md' -o -name '*.txt' \) \
    ! -name 'CHANGED_FILES' ! -name 'CHANGED_FILES_OASIS.txt' \
    | sort | while read -r f; do echo "A $f"; done
} >"$MASTER_OUT"

echo "wrote $OASIS_OUT ($(wc -l <"$OASIS_OUT" | tr -d ' ') lines)"
echo "wrote $MASTER_OUT ($(wc -l <"$MASTER_OUT" | tr -d ' ') lines)"