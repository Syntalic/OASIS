# OASIS MCP server + agent probe

Out-of-tree local tooling (not part of the standard — the core repo keeps MCP out
of scope). Self-contained: installs its own SDKs via npm, imports the built OASIS
`../dist`.

```bash
cd mcp && npm install          # @modelcontextprotocol/sdk, @anthropic-ai/sdk, openai
# (build the index first from the repo root: pnpm run build && pnpm run embed && pnpm run build:endpoint-index)
```

## MCP server (local, stdio)

Exposes, backed by the OASIS index:

*Discovery (use a tool):*
- **`oasis_discover(query, finding?, entities?)`** — one call → ranked capabilities + endpoints
  (price/rails inline) + `next_steps`. The primary tool and a superset of the others: cheapest +
  most accurate (see the A/B below). Use this first. Pass `finding` / `entities` on a follow-up
  call to get cross-domain investigative leads from held identity entities.
- `oasis_search(query)` — lower-level classify-only utility → ranked capability intents

> `oasis_find` / `oasis_resolve` / `oasis_next` / `oasis_validate_binding` remain as **deprecated
> aliases** in the handler for back-compat but are **not advertised** as tools — `oasis_discover`
> supersedes `oasis_find` + `oasis_next`.

## Skills

Copy `mcp/skills/oasis.md` to your agent's skills directory — it teaches `oasis_discover` (discover → call → discover-with-`finding` → synthesize).

*Contribution (add a service):*
- `oasis_taxonomy()` — the controlled vocab to bind INTO (capabilities + facet/entity enums)
- `oasis_validate(intent)` — validate a proposed task-intent (same check CI runs on the PR)

The server is plain [MCP](https://modelcontextprotocol.io) over stdio — **any** MCP
client can use it (Claude Desktop, Claude Code, Cursor, or your own). No model
provider is involved in the server itself.

```json
{ "mcpServers": { "oasis": { "command": "node",
    "args": ["/absolute/path/OASIS/mcp/server.mjs"] } } }
```

## Remote hosting (Streamable HTTP)

`http-server.mjs` serves the **same tools** over MCP Streamable HTTP, for hosting the
reference endpoint. Stateless (a fresh server/transport per request; the index + model
load once at import and are shared), with optional bearer auth. Hosting a public endpoint
is a **stewardship convenience, not part of the standard** — anyone may self-host or skip
the server entirely (download the index).

```bash
npm run http                                   # http://127.0.0.1:8080/mcp  (GET /health)
OASIS_AUTH_TOKEN=secret PORT=8080 npm run http # require Authorization: Bearer secret
```

Env: `PORT` (8080), `MCP_PATH` (`/mcp`), `OASIS_AUTH_TOKEN` (if set, required as a bearer
token), `MCP_JSON_RESPONSE` (`1` = plain JSON, `0` = SSE). Client config once live:

```json
{ "mcpServers": { "oasis": { "url": "https://<app>.fly.dev/mcp",
    "headers": { "Authorization": "Bearer <token>" } } } }
```

### Deploy

The hosting setup — `Dockerfile`, `fly.toml`, and how the stewards run the free public
instance — lives in **[`deploy/`](deploy/)** (following Fly's
[remote-MCP blueprint](https://fly.io/docs/blueprints/remote-mcp-servers/), multi-tenant
pattern). See **[`deploy/README.md`](deploy/README.md)**. It is operational tooling, kept
out of the normative root; self-hosting is first-class.

## Agent probe (automated, any provider)

Drives an LLM through `oasis_find → pick` (the shipped one-hop method) on 18 real tasks
and reports whether OASIS leads it to an endpoint that does the task. The harness
([`llm.mjs`](llm.mjs)) is **provider-agnostic** — two native paths, selected by `LLM_PROVIDER`:

| `LLM_PROVIDER` | SDK | Use for |
|---|---|---|
| `anthropic` (default) | `@anthropic-ai/sdk` | Claude |
| `openai` | `openai` (OpenAI-compatible) | OpenAI, **Google Gemini**, OpenRouter, Together, Groq, Fireworks, and **local open-source models** via Ollama / LM Studio / vLLM |

The `openai` path talks to any OpenAI-compatible `/v1/chat/completions` endpoint, so
it works with essentially any hosted or self-hosted model — **the only requirement
is that the model supports tool / function calling** (the probe is driven by tool
calls). Most current instruct models do (Llama 3.1+, Qwen2.5, Mistral, Gemini 2.x,
GPT-4o, …); very small or older models that lack tool-calling won't.

```bash
# Claude (default — reads ANTHROPIC_API_KEY from ../.env, gitignored)
npm run probe

# OpenAI
LLM_PROVIDER=openai LLM_API_KEY=sk-... LLM_MODEL=gpt-4o-mini node probe.mjs

# Google Gemini (its OpenAI-compatible endpoint)
LLM_PROVIDER=openai \
  LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/ \
  LLM_API_KEY=$GEMINI_API_KEY LLM_MODEL=gemini-2.0-flash node probe.mjs

# OpenRouter (hundreds of hosted open + closed models)
LLM_PROVIDER=openai LLM_BASE_URL=https://openrouter.ai/api/v1 \
  LLM_API_KEY=$OPENROUTER_KEY LLM_MODEL=meta-llama/llama-3.1-70b-instruct node probe.mjs

# Local open-source model (Ollama — no key needed)
LLM_PROVIDER=openai LLM_BASE_URL=http://localhost:11434/v1 \
  LLM_API_KEY=ollama LLM_MODEL=llama3.1 node probe.mjs
```

Config env vars (all optional, sensible defaults): `LLM_PROVIDER`, `LLM_MODEL`,
`LLM_BASE_URL`, `LLM_API_KEY` (the `openai` path also honors `OPENAI_*`).

### Latest result (Claude Sonnet 4.6, 18 tasks)

The agent is told to route through OASIS (find a tool, don't answer from its own
knowledge). Using `oasis_find`, it **chose an endpoint of the right capability 16/18
(89%)** (±1 run-to-run; the misses are usually an adjacent-capability pick — e.g. a
place-reviews API for "find restaurants near my hotel"). Token cost and the full
per-method comparison (`oasis_find` vs the keyword baselines) are in
[`../docs/eval_results.md`](../docs/eval_results.md).

## Head-to-head: OASIS vs raw keyword (`compare.mjs`)

Runs the SAME agent over the SAME tasks, swapping ONLY the discovery tool: OASIS
(`oasis_search → oasis_resolve`) vs a single keyword `search_endpoints` tool over the
raw index (what an agent does *without* OASIS), sliced like the offline eval. Scored
by a **method-neutral LLM judge** ("does the chosen endpoint actually do the task?"),
so baselines get credit for any working endpoint they find — not just OASIS-curated
ones.

```bash
npm run compare                 # node --env-file=../.env compare.mjs  (any provider)
```

Latest (Sonnet 4.6, 18 tasks): **OASIS 18/18, keyword-all 18/18** — parity on common
high-coverage tasks; OASIS beats single-registry keyword (72–94%) on coverage. This
test surfaced and the resolve-precision fix corrected a real bug (OASIS was 16/18,
mis-picking weather→geocoding / stock→chart-patterns). Honest analysis +
where-OASIS-should-win in [`../docs/eval_results.md`](../docs/eval_results.md).
