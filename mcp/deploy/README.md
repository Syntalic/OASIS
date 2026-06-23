# Hosting the OASIS reference MCP server

**This folder is operational tooling, not part of the OASIS standard.** The standard is the
task ontology, the JSON schemas (`spec/`), and the published index (`dist/`). The MCP server
(`mcp/`) is a *reference implementation*, and this folder is simply **how the OASIS stewards
deploy a free public instance of it**.

You need none of this to use OASIS: download the index from Releases, or run the server
locally over stdio (`mcp/server.mjs`). Hosting is a stewardship convenience — anyone may
self-host this exact image, or host it some other way. The standard never depends on any
particular endpoint being up.

## Design — follows Fly's remote-MCP blueprint

Per Fly's [remote MCP blueprint](https://fly.io/docs/blueprints/remote-mcp-servers/), this is
the **multi-tenant** pattern (one shared app, many users) — the right fit for a **read-only
public index**: there's no per-user state or isolation, so the single-tenant / per-user-machine
pattern doesn't apply. It is a single **Streamable-HTTP endpoint** (`/mcp`) with optional
bearer-token auth — the blueprint's "MCP Server App."

We expose the **standard** MCP Streamable HTTP transport (`mcp/http-server.mjs`), so any
compliant client connects with just a URL + token — **no `fly mcp proxy` shim required**.
(That shim, and Fly's experimental `fly mcp wrap`, exist for clients that can't do
remote/authenticated HTTP; a fine fallback, but we don't require it for a public endpoint.)

## Files

- `Dockerfile` — Debian Node; installs runtime deps, bakes in the prebuilt `dist/` index,
  regenerates the LanceDB table + caches the embedding model in-image. **Build context is the
  repo root.**
- `fly.toml` — one `shared-cpu-1x` / 1 GB machine, kept warm, `/health` check.
- `.dockerignore` lives at the **repo root** (that's the build context).

## Deploy

From the **repo root**, with the index built (`pnpm install && pnpm build && pnpm embed`):

```bash
fly apps create oasis-mcp                                       # claim the app name (once)
fly secrets set OASIS_AUTH_TOKEN=$(openssl rand -hex 24) -a oasis-mcp   # optional bearer auth
fly deploy --config mcp/deploy/fly.toml                         # remote builder → linux/amd64
fly certs add mcp.oasisindex.org -a oasis-mcp                   # custom domain (optional)
```

- **Warm** (default, no cold start): `min_machines_running = 1` (~$5–8/mo for shared-cpu-1x / 1 GB).
- **Cheapest** (scale to zero): set `min_machines_running = 0` and `auto_stop_machines = "suspend"`
  in `fly.toml` — a few-second cold start to load the model + index on the first request after idle.

Client config once live:

```json
{ "mcpServers": { "oasis": { "url": "https://mcp.oasisindex.org/mcp",
    "headers": { "Authorization": "Bearer <token>" } } } }
```
