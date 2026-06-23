# OASIS

**Open standard for discoverability of paid HTTP APIs in agentic commerce** (x402 / MPP) —
a unified, payment-aware endpoint index, a task ontology, JSON schemas, and reference
tooling that map a natural-language task to the right paid API. Not a hosted product, no
fees. See [GOVERNANCE.md](GOVERNANCE.md).

As paid endpoints multiply, agents face registry noise, keyword collisions, and no reliable
way to pick the right micropayment API. We could not find a high-quality, vendor-neutral
discovery mechanism — so we built OASIS and open-sourced it.

## Integrate it as one agent tool

Drop the reference MCP server into any agent. **`oasis_find` returns the right paid endpoint
for a task in a single call** — a flat, ranked list with price + payment rails inline. Works
with any LLM provider.

**👉 Just want to try it?** A free hosted instance is live — no clone, no key:

```bash
claude mcp add --transport http oasis https://mcp.oasisindex.org/mcp
```

(or any MCP client: `{ "mcpServers": { "oasis": { "url": "https://mcp.oasisindex.org/mcp" } } }`).
Open + per-IP rate-limited, operated by the stewards as a convenience — **not** part of the
standard; self-host the same image (see [`mcp/deploy/`](mcp/deploy/)) or run it locally:

```json
{ "mcpServers": { "oasis": { "command": "node",
    "args": ["/absolute/path/OASIS/mcp/server.mjs"] } } }
```

The server also exposes the lower-level `search` / `resolve` primitives and the
`oasis_taxonomy` / `oasis_validate` contribution tools. See [`mcp/`](mcp/).

## Why it holds up — cost, accuracy, scale

### 💸 Token cost — cheapest of every method tested

End-to-end (a live LLM picks a paid endpoint for 18 real tasks; a method-neutral judge
scores the pick), `oasis_find` finds *and* picks in one call at the lowest token cost of any
discovery method — every keyword baseline costs **6–95% more**:

Tokens/task is **input (prompt) + output (completion)**, summed across the agent's
round-trips — the full cost to find and pick (you pay for the re-sent prompt on every call,
so more tool-calls → more input tokens):

| discovery method | tokens/task (in + out) | avg tool-calls/task | vs `oasis_find` |
|---|---|---|---|
| **`oasis_find` (OASIS, one call)** | **2,562** (2,247 + 315) | 1.2 | — |
| keyword — all endpoints | 2,723 (2,462 + 261) | 1.9 | +6% |
| keyword — mpp slice | 3,116 (2,821 + 295) | 2.2 | +22% |
| keyword — x402scan slice | 3,166 (2,892 + 274) | 2.1 | +24% |
| keyword — pay-skills slice | 5,005 (4,651 + 354) | 3.3 | +95% |

**What each method is** — every "keyword" row is the *same* lexical search over raw endpoint
summaries (no ontology, no vectors), differing only in how much of the index it covers:

- **`oasis_find` (OASIS)** — the shipped method: **one** MCP call; server-side hybrid retrieval
  (capability vectors for recall + task-fit ranking) returns a tight, pre-ranked endpoint list
  with price/rails inline. Covers the whole index.
- **keyword — all endpoints** — the key baseline: plain keyword search over the **full
  ~30k-endpoint index**; the agent reads the raw hits and picks. Same corpus as `oasis_find`, so
  the gap is purely the ontology + ranking — *"OASIS's corpus minus its smarts."*
- **keyword — x402scan / mpp / pay-skills slice** — the same keyword search restricted to **one
  registry's** endpoints (x402scan; mppscan + mpp.dev; or the pay-skills providers). Lower
  coverage, so the agent searches more (pay-skills: 3.3 calls) and sometimes finds nothing (14/18).

Full analysis + reproduction: **[docs/eval_results.md](docs/eval_results.md)**.

### 🎯 Accuracy — the honest, generalizing number

On held-out queries phrased *away* from the capability labels (the realistic signal, never
tuned against): **72% discover@1 / 88% discover@3** — vs **41%** for keyword alone. The
curated set reads ~100% but is overfit to alias vocabulary; the held-out test is the truth.
End-to-end, a live LLM using OASIS reaches the right capability **~17/18**. Tables, splits,
and caveats: **[docs/eval_results.md](docs/eval_results.md)**.

### 📈 Scale — endpoint-atomic + distributed curation

The **endpoint is the atomic unit**; the capability ontology is a **server-side recall +
ranking aid** (paid in compute, not agent tokens), and the index is filled by **LLM-assisted,
contributor-funded curation** — each service owner curates their own endpoints. This is the
design that holds as the corpus grows 10–100× — where raw keyword degrades on collisions,
best-of-many ranking, and token growth. Thesis + evidence: **[docs/scaling.md](docs/scaling.md)**.

## What this is

| Artifact | Purpose |
|---|---|
| `ontology/intents/` | Curated task capabilities (what agents want to do) |
| `dist/index.json` (+ `endpoints` / `capabilities` / `providers`) | The unified paid-endpoint index |
| `spec/` | JSON schemas + [agent traversal protocol](spec/traversal.md) |
| `mcp/` | Reference MCP server + agent probe + A/B harness (any provider) |

## Quick start

```bash
git clone https://github.com/Syntalic/OASIS.git && cd OASIS && pnpm install
pnpm run build    # full ingest (~30k endpoints; needs network)
pnpm run embed    # hybrid vector index (47 curated intents)
pnpm test
```

Or download `dist/index.json` (and siblings) from
[Releases](https://github.com/Syntalic/OASIS/releases) — no build needed to search/resolve
against the prebuilt index. Build pipeline, ingestion sources, and payment-metadata
extraction: [ARCHITECTURE.md](ARCHITECTURE.md).

## CLI

```bash
pnpm exec capindex search "cheapest airpods pro" --hybrid   # keyword + vector
pnpm exec capindex resolve --intent shop.compare_price
pnpm exec capindex validate                                 # validate dist/index.json
pnpm exec capindex taxonomy --json                          # controlled vocab (to contribute)
pnpm exec capindex validate-source <intent.yaml>            # SAME check CI runs on a PR
pnpm exec capindex validate-binding [file]                  # authoritative endpoint→capability bindings
```

## Contributing a service

OASIS scales by **LLM-assisted, contributor-funded curation**: the service owner binds their
own endpoints into the taxonomy (their LLM, their cost) and opens a PR; CI runs an objective
validation gate (`validate-source`). Bind into existing capabilities where one fits; propose
new ones sparingly (flagged for review). Full guide:
**[docs/contributing-capabilities.md](docs/contributing-capabilities.md)**.

## Docs

- **[docs/OASIS-explainer.pdf](docs/OASIS-explainer.pdf)** — visual explainer deck (PDF overview of OASIS)
- **[docs/eval_results.md](docs/eval_results.md)** — full benchmarks: accuracy, token cost, generalization, the agent probe
- **[docs/scaling.md](docs/scaling.md)** — the endpoint-atomic direction, why it scales, the per-service binding artifact
- **[docs/contributing-capabilities.md](docs/contributing-capabilities.md)** — how to add a service
- **[docs/proposals/onchain-usage-ranking.md](docs/proposals/onchain-usage-ranking.md)** — proposed (**help wanted**): quality-aware ranking from on-chain usage (volume/trend/buyers)
- [ARCHITECTURE.md](ARCHITECTURE.md) · [GOVERNANCE.md](GOVERNANCE.md) · [spec/traversal.md](spec/traversal.md)

## Design principles

- **Discover, don't gate** — surface tasks + capable endpoints; selection is agent policy
- **Endpoint is the atomic unit** — capability = server-side recall/ranking overlay; service = facet
- **Origin-centric IDs** — `sha256(origin|method|path)`, no vendor special cases
- **Payment rails as facets** — x402 and MPP are siblings under `payment.rails[]`
- **OpenAPI is source of truth; ingest, don't own** — index holds summaries; pull from public catalogs, publish a neutral `dist/`

## License

MIT — see [LICENSE](LICENSE).
