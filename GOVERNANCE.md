# Governance

OASIS is an **open standard for paid API discoverability** — not a hosted product.

## Why it exists

Agents that use x402 and MPP for agentic commerce need to find the right paid API for a
task — not guess URLs or drown in registry crawl. Existing options (keyword grep, provider
catalogs, facilitator search) did not meet that bar. OASIS is a curated task ontology plus
a unified index, published as open source for any agent runtime.

**North star:** discovery results better than all known alternatives on honest evals
(messy natural-language queries), embeddable from agent runtimes via the spec artifacts
and CLI.

## Scope

| In scope | Out of scope (for now) |
|----------|-------------------------|
| Ontology, index build, eval suite, traversal spec | MCP server |
| Reference CLI (`capindex`) | Hosted discovery service |
| Open GitHub repo + community intents | Monetization / paid tiers |

Agent runtimes consume `dist/index.json`, capabilities, and the traversal protocol — or
embed search/resolve logic directly.

## Principles

1. **Standard, not service** — Spec, schemas, ontology, and index artifacts are the product. Anyone can build, host, fork, or embed them without permission or fees.
2. **No monetization** — No charge for discovery, search, or resolve. No planned toll on the protocol.
3. **Neutral discovery** — Task intents describe what agents want to do. Multiple endpoints may satisfy the same intent. OASIS does not pick commercial winners at runtime.
4. **Contributor-friendly** — The main lever for improvement is **new task intents** (YAML + eval queries). Adding your endpoint to `satisfies` for an existing task is welcome when it genuinely fits.
5. **Reference CLI only** — `capindex` demonstrates the protocol. Production agents may use the library artifacts directly.

## Maintainer role

Repo maintainers review the PR queue. They:

- Merge intents and ingestion improvements that pass eval and schema validation
- Keep the index build reproducible and vendor-neutral
- Do **not** require any particular host, vendor, or infrastructure to use OASIS

## Conflict of interest

Maintainers' own endpoints may appear in `satisfies` when they satisfy a task, same as any
other provider. Maintainers must not:

- Block competing endpoints for the same task without cause
- Use `confidence: primary` as a runtime default (eval fixtures only)
- Introduce ranking that hardcodes maintainer or vendor preference in the open standard

## What we want contributors to add

| Priority | Contribution |
|----------|----------------|
| High | New **task intents** in `ontology/intents/` + messy eval queries |
| High | Additional `satisfies` refs for endpoints that already do the task |
| Medium | New ingestion sources (registries, catalogs) |
| Medium | Selection policies (price, doc quality, reputation) as **documented, pluggable** logic |
| Low | Agent runtime integrations — a local MCP server + probe live in `mcp/` (out-of-tree tooling, not part of the standard) |

## Decision process

- **Intents & ontology** — PR review; must resolve to indexed endpoints (`pnpm run eval:resolve`)
- **Spec changes** — PR with rationale; prefer backward-compatible `spec_version` bumps
- **Breaking index format** — Bump `index_version`; document in PR

## License

MIT. Fork freely.