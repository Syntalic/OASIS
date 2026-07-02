
<img width="2752" height="1536" alt="OASIS_Discovery_Layer_for_AI" src="https://github.com/user-attachments/assets/f293aabc-074b-4f48-907d-8252f9a79c40" />


# OASIS

**Open standard for discoverability of paid HTTP APIs in agentic commerce** (x402 / MPP).
OASIS is a vendor-neutral discovery layer for **paid** HTTP APIs: a task ontology, a
payment-aware endpoint index, JSON schemas, and a reference MCP server that map a
natural-language task to the right paid endpoint — price and payment rails inline. Not a
hosted product, no fees. See [GOVERNANCE.md](GOVERNANCE.md).

As paid endpoints multiply, agents hit registry noise, keyword collisions, and no reliable
way to pick the right micropayment API. We could not find a high-quality, vendor-neutral
discovery mechanism — so we built OASIS and open-sourced it.

## What's in the repo

| Artifact | Purpose |
|---|---|
| `ontology/intents/` | Curated task capabilities — the controlled vocabulary agents route to (87 intents across 20 domains) |
| `dist/index.json` (+ `endpoints` / `capabilities`) | The unified, payment-aware paid-endpoint index (~19k gated endpoints) |
| `spec/` | JSON schemas + entity vocab + [agent traversal protocol](spec/traversal.md) |
| `mcp/` | Reference MCP server (`oasis_discover` + contribution tools) + drop-in agent skill |

**New here? Start with [docs/concepts.md](docs/concepts.md)** — the mental model and glossary
(taxonomy, ontology, capability, domain, facet, entity, link, endpoint, binding).

## Use it as one agent tool

Drop the reference MCP server into any agent. **`oasis_discover` returns the right paid
endpoint for a task — plus a `next_steps` map to chain follow-ups — in a single call**: a flat,
ranked endpoint list with price + payment rails inline. Works with any LLM provider.

A free hosted instance is live — no clone, no key:

```bash
claude mcp add --transport http oasis https://mcp.oasisindex.org/mcp
```

(or any MCP client: `{ "mcpServers": { "oasis": { "url": "https://mcp.oasisindex.org/mcp" } } }`).
Open + per-IP rate-limited, operated by the stewards as a convenience — **not** part of the
standard. To self-host the same image or run it locally over stdio, see [`mcp/`](mcp/) and
[`mcp/deploy/`](mcp/deploy/).

The server also exposes `oasis_search` (classify a query → task intents) and the
`oasis_taxonomy` / `oasis_validate` contribution tools. Teach your agent to call
`oasis_discover` first by dropping in [`mcp/skills/oasis.md`](mcp/skills/oasis.md) (Claude
Code: `~/.claude/skills/oasis/SKILL.md`).

## Quick start

No build needed to search or resolve — download `dist/index.json` (and siblings) from
[Releases](https://github.com/Syntalic/OASIS/releases). To build the index yourself:

```bash
git clone https://github.com/Syntalic/OASIS.git && cd OASIS && pnpm install
pnpm run build    # federated ingest → quality gate → semantic bind (needs network; GOOGLE_API_KEY for gemini binding)
pnpm run embed    # vector index (87 curated intents, gemini-embedding-001)
pnpm test
```

CLI (`capindex`):

```bash
pnpm exec capindex search "cheapest airpods pro"             # vector search over curated intents
pnpm exec capindex resolve --intent commerce.compare_price   # endpoints that satisfy a task
pnpm exec capindex validate                                  # validate dist/index.json
pnpm exec capindex taxonomy --json                           # controlled vocab (to contribute)
pnpm exec capindex validate-source <intent.yaml>             # SAME check CI runs on a PR
```

## Why it holds up

On a battery of **real, colloquial tasks**, `oasis_discover` finds *and* picks a paid endpoint
in one call at **71% precision** and the **lowest token cost of every method tested** (vs
keyword and the semantic-spec approach third-party registries use). On held-out queries phrased
away from the labels it routes at **95% discover@1 / 99% discover@3** (vs 41% for keyword). Full
numbers, the comparison to the largest live x402 layers, and reproduction:
**[docs/eval_results.md](docs/eval_results.md)**.

## Contributing a service

OASIS scales by **LLM-assisted, contributor-funded curation**: the service owner binds their
own endpoints into the taxonomy (their LLM, their cost) and opens a PR; CI runs an objective
validation gate (`validate-source`). See
**[docs/contributing-capabilities.md](docs/contributing-capabilities.md)** (bind endpoints into
the ontology) and **[docs/authoring-openapi-specs.md](docs/authoring-openapi-specs.md)** (author
a discoverable spec that passes the quality gate and ranks well).

## Documentation

- **[docs/concepts.md](docs/concepts.md)** — start here: the data model + glossary (taxonomy, ontology, capability, domain, facet, entity, link, endpoint, binding)
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — index-build pipeline, search/retrieval, ontology→endpoint wiring
- **[spec/traversal.md](spec/traversal.md)** — agent protocol: search → resolve → schema → execute
- **[docs/scaling.md](docs/scaling.md)** — the endpoint-atomic direction and why it scales
- **[docs/eval_results.md](docs/eval_results.md)** — full benchmarks: accuracy, token cost, generalization, the agent probe
- **[docs/contributing-capabilities.md](docs/contributing-capabilities.md)** — add a service (bind endpoints into the task ontology)
- **[docs/authoring-openapi-specs.md](docs/authoring-openapi-specs.md)** — author a discoverable OpenAPI spec (what the quality gate + ranker expect)
- **[docs/index-snapshots.md](docs/index-snapshots.md)** — reproduce a pinned index anywhere (snapshot lock + restore)
- **[GOVERNANCE.md](GOVERNANCE.md)** · **[CONTRIBUTING.md](CONTRIBUTING.md)** — what OASIS is (and isn't), and how to contribute
- **[docs/OASIS-explainer.pdf](docs/OASIS-explainer.pdf)** — visual explainer deck

## License

MIT — see [LICENSE](LICENSE).
