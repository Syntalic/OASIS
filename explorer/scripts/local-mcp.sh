#!/usr/bin/env bash
# Launch the local OASIS MCP server (the real binder over the local
# dist/index.json) so the dashboard's Ask tab reflects the LOCAL index.
# Run automatically by `pnpm dev:all`. Needs GOOGLE_API_KEY in the OASIS repo's
# .env (the MCP embeds each query at runtime — the key stays in this process).
set -euo pipefail

# Locate the OASIS repo root (the dir that contains mcp/http-server.mjs). Once
# the dashboard lives at OASIS/explorer this is just two levels up; we walk up
# to stay robust to wherever it sits.
ROOT="${OASIS_DIR:-}"
if [ -z "$ROOT" ]; then
  d="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  while [ "$d" != "/" ]; do
    if [ -f "$d/mcp/http-server.mjs" ]; then ROOT="$d"; break; fi
    d="$(dirname "$d")"
  done
fi
if [ -z "${ROOT:-}" ] || [ ! -f "$ROOT/mcp/http-server.mjs" ]; then
  echo "[local-mcp] could not find the OASIS repo (mcp/http-server.mjs). Set OASIS_DIR=/path/to/OASIS." >&2
  exit 1
fi
cd "$ROOT"

[ -f dist/index.json ] || echo "[local-mcp] warning: $ROOT/dist/index.json missing — build the index first (pnpm run build)." >&2
grep -q GOOGLE_API_KEY .env 2>/dev/null || echo "[local-mcp] warning: GOOGLE_API_KEY not in $ROOT/.env — oasis_search/discover can't embed queries." >&2

set -a
[ -f .env ] && . ./.env
set +a

PORT_TO_USE="${OASIS_MCP_PORT:-8899}"
echo "[local-mcp] OASIS MCP → http://localhost:${PORT_TO_USE}/mcp   (index: $ROOT/dist/index.json)"
exec env PORT="$PORT_TO_USE" MCP_JSON_RESPONSE=1 node mcp/http-server.mjs
