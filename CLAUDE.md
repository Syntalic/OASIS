# OASIS — agent & contributor guide

Vendor-neutral discovery layer for **paid** HTTP APIs (x402 / MPP): a task ontology, a
payment-aware endpoint index, JSON schemas, and a reference MCP server that maps a
natural-language task to the right paid endpoint. Not a hosted product. See
[README.md](README.md) for the overview and [ARCHITECTURE.md](ARCHITECTURE.md) for the design.

## Setup

- **Package manager: pnpm** (`pnpm@11.7`; `corepack enable`). Node ≥ 20. Don't use npm/yarn at the repo root.
- `pnpm install`

## Build & run

```bash
pnpm run build      # tsc → ingest (federated crawl) → enrich (semantic bind) → dist/index.json
pnpm run embed      # LanceDB vectors for the curated intents
pnpm test           # full suite (needs a built index)
pnpm run test:unit  # fast, index-free subset (what CI runs)
```

- **`GOOGLE_API_KEY` is required for a production build** — gemini powers the semantic binder + embeddings. Without it the build falls back to local MiniLM (dev/offline): fine for iterating, but the shipped index is gemini.
- **No build needed just to search/resolve** — download `dist/index.json` (+ siblings) from [Releases](https://github.com/Syntalic/OASIS/releases). `dist/` is gitignored (build output).
- `pnpm run build` crawls public registries (network; varies run-to-run). For a deterministic, no-network rebuild from a saved crawl: `node dist/cli.js ingest --snapshot <merged.json> && pnpm run enrich`.

## Reference MCP server

```bash
GOOGLE_API_KEY=... PORT=8899 node mcp/http-server.mjs   # Streamable HTTP at /mcp
```

Tools: **`oasis_find`** (start here), `oasis_next`, `oasis_search`, `oasis_resolve`,
`oasis_taxonomy`, `oasis_validate`. Hosted instance: `https://mcp.oasisindex.org/mcp`.
Drop-in agent skill: [`mcp/skills/oasis.md`](mcp/skills/oasis.md).

## Release & deploy (run LOCALLY — no CI workflow, no secrets in this public repo)

The index is a non-deterministic network crawl, so a snapshot is pinned **intentionally** (a
validated rebuild), not on every push. There is **no GitHub Action** for this and **no env keys
in the repo** — `GOOGLE_API_KEY` lives only in your local `.env` (gitignored; never commit it),
and Fly auth comes from your local `fly auth`. Load the key per shell with `set -a; . ./.env; set +a`.

```bash
# 1. Build the index (gemini — needs GOOGLE_API_KEY from .env)
set -a; . ./.env; set +a
pnpm run build                 # tsc → ingest (crawl) → enrich-facets (bind + host_breadth)
pnpm run embed                 # LanceDB curated-capability vectors
pnpm run build:endpoint-index  # quantized int8 endpoint-arm index

# 2. (optional) validate before shipping — CI gate + your eval harness

# 3. Pin the snapshot: GitHub Release + the in-git pointer, then commit it
scripts/snapshot/publish.sh    # creates Release oasis-index-<date>-<sha> + writes dist-snapshot.lock.json
git add dist-snapshot.lock.json && git commit -m "chore: pin index snapshot <tag>" && git push

# 4. Deploy that index to Fly (build context = repo root; ships the prebuilt dist)
fly deploy --config mcp/deploy/fly.toml --build-secret GOOGLE_API_KEY="$GOOGLE_API_KEY"
```

Reproduce a pinned index anywhere (worktree-deletion-proof): `scripts/snapshot/restore.sh`
(reads `dist-snapshot.lock.json` → downloads the Release asset → deterministic no-crawl rebuild).
Details: [docs/index-snapshots.md](docs/index-snapshots.md), [mcp/deploy/README.md](mcp/deploy/README.md).

## CLI

`pnpm exec capindex <search|resolve|validate|ingest|embed|build> …` (see README → CLI).
`capindex validate-source <intent.yaml>` is the exact gate CI runs on a contributed intent.

## Layout

| Dir | What |
|-----|------|
| `src/` | Indexer, CLI, search, embed, ingest, eval (TypeScript → `dist/`) |
| `ontology/intents/` | Curated task capabilities (YAML) — the controlled vocabulary |
| `spec/` | JSON schemas + entity vocab + traversal protocol |
| `mcp/` | Reference MCP server (`http-server.mjs`) + agent skills |
| `eval/` | Golden + messy query sets for the benchmarks |
| `dist/` | Build output — **gitignored, never commit** |
| `docs/` | Architecture, benchmarks, proposals (incl. `docs/proposals/`) |

## Conventions

- Match the surrounding style; keep changes minimal. Never commit `dist/` or `dist-pinned/` (gitignored build output).
- Publishing a paid API so OASIS can find it: [docs/authoring-openapi-specs.md](docs/authoring-openapi-specs.md). Binding endpoints into the ontology: [docs/contributing-capabilities.md](docs/contributing-capabilities.md).
- CI (`.github/workflows/ci.yml`): `build:ts` → `test:unit` → `validate-source` → `validate-binding` → an offline fixture build. Run those locally before a PR.
