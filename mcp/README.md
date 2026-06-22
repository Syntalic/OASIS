# OASIS MCP server + agent probe

Out-of-tree local tooling (not part of the standard — the core repo keeps MCP out
of scope). Self-contained: installs its own SDKs via npm, imports the built OASIS
`../dist`.

```bash
cd mcp && npm install          # @modelcontextprotocol/sdk, @anthropic-ai/sdk, openai
# (build the index first from the repo root: pnpm run build && pnpm run embed)
```

## MCP server (local, stdio)

Exposes two tools backed by the OASIS index:
- `oasis_search(query)` — hybrid discovery → ranked capability intents (+ a few endpoints)
- `oasis_resolve(intent_id, query)` — query-aware endpoints for that intent + typed related options

The server is plain [MCP](https://modelcontextprotocol.io) over stdio — **any** MCP
client can use it (Claude Desktop, Claude Code, Cursor, or your own). No model
provider is involved in the server itself.

```json
{ "mcpServers": { "oasis": { "command": "node",
    "args": ["/absolute/path/OASIS/mcp/server.mjs"] } } }
```

## Agent probe (automated, any provider)

Drives an LLM through `search → resolve → pick` on 18 real tasks and reports whether
OASIS leads it to the right capability. The harness ([`llm.mjs`](llm.mjs)) is
**provider-agnostic** — two native paths, selected by `LLM_PROVIDER`:

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

The agent is told to always route through OASIS (find a tool, don't answer from its
own knowledge). Across runs: **discovery top-3 ~17/18 (94%)**, **agent resolved the
right capability ~17–18/18 (94–100%)** — the stable headline. The strict `CHOSEN`-line
parse reads lower (12–14/18) because it needs one exact line and several "misses" are
valid alternatives reached via the typed links. The one discovery miss moves between
runs (LLM first-search phrasing), so it is not a fixed index gap. Full write-up:
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
