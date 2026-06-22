# Contributing

OASIS is an open standard for paid API discoverability — not a commercial product.
The highest-impact contribution is **new agent task intents**. See [GOVERNANCE.md](GOVERNANCE.md).

## Add a capability intent

1. Create `ontology/intents/<domain>.<name>.yaml` with **task-only** fields: `id`, `label`, `description`, `aliases` (no vendor or product names in `id` — e.g. `ai.web_research` not `ai_ml.perplexity`; no `satisfies`)
2. Add a matcher in `src/intent-match.ts` so the index build can link endpoints API-agnostically
3. Add messy eval queries in `eval/messy-queries.json` with `expect_intent` (required). Optional `expect_endpoint` is a **select@k regression anchor only** — not a promoted winner; agents discover tasks and candidate APIs neutrally, then pick via `select-policy.ts`
4. Run `pnpm run build` and `pnpm test`
5. Open a PR

## Add ingestion sources

The reference indexer lives in `src/`. New sources should:

- Emit `EndpointRecord` objects matching `spec/endpoint-record.schema.json`
- Stay vendor-neutral (origin URLs, not brand names, as keys)
- Derive payment metadata from live specs where possible

## Validate before PR

```bash
pnpm run build
pnpm test
pnpm exec capindex validate
```