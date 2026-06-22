# OASIS MCP server + agent probe

Out-of-tree local tooling (not part of the standard — the core repo keeps MCP out
of scope). Self-contained: installs its own SDKs via npm, imports the built OASIS
`../dist`.

```bash
cd mcp && npm install          # @modelcontextprotocol/sdk, @anthropic-ai/sdk
# (build the index first from the repo root: pnpm run build && pnpm run embed)
```

## MCP server (local, stdio)

Exposes two tools backed by the OASIS index:
- `oasis_search(query)` — hybrid discovery → ranked capability intents (+ a few endpoints)
- `oasis_resolve(intent_id, query)` — query-aware endpoints for that intent + typed related options

Wire it into an MCP client (e.g. Claude Desktop / Claude Code):

```json
{ "mcpServers": { "oasis": { "command": "node",
    "args": ["/absolute/path/OASIS/mcp/server.mjs"] } } }
```

## Agent probe (automated)

Drives an LLM through `search → resolve → pick` on real tasks and reports whether
OASIS leads it to the right capability. Needs `ANTHROPIC_API_KEY` (read from
`../.env`, gitignored):

```bash
npm run probe                 # node --env-file=../.env probe.mjs
```

Latest run (Sonnet 4.6, 18 tasks): discovery top-3 89%, resolved-right 94%,
chose-endpoint-of-right-capability 83% (2 of 3 "misses" were valid alternatives).
