# Contributing

## Add a capability intent

1. Create `ontology/intents/<domain>.<name>.yaml`
2. Use a stable `id` in `domain.snake_case` form
3. Map to real endpoints via `satisfies[].origin|method|path`
4. Run `npm run build` and `npm test`
5. Open a PR

## Add ingestion sources

The reference indexer lives in `src/`. New sources should:

- Emit `EndpointRecord` objects matching `spec/endpoint-record.schema.json`
- Stay vendor-neutral (origin URLs, not brand names, as keys)
- Derive payment metadata from live specs where possible

## Validate before PR

```bash
npm run build
npm test
npx capindex validate
```