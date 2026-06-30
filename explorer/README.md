# OASIS Atlas

An interactive, themeable map of the [OASIS](https://github.com/Syntalic/OASIS) task
ontology — **domains → capabilities → entities → the paid x402/MPP endpoints** bound to
them — rendered as a React Flow graph.

Built with **Next.js (App Router)**, **React 19**, **@xyflow/react**, **shadcn/ui**,
**jotai**, **dagre**, **react-resizable-panels**, and **next-themes**. The architecture
follows [Repree](https://github.com/mitate-gengaku/Repree); the layout strategy is adapted
from [OpenMetadata's OntologyExplorer](https://github.com/open-metadata/OpenMetadata).

## Two modes

- **Explore** — the whole ontology. Domains are glowing hubs; capabilities cluster under
  them; the entity-flow layer shows how data passes between capabilities. Filter by domain.
- **Ask** — type a task ("narrate an article as audio"); a local scorer ranks the matching
  capabilities and the graph traces the question → capabilities → shared entities → real
  paid endpoints.

Click any node to **trace its connections** (everything connected lights up, the rest fades)
and open a detail panel. The view pans the selection clear of the panel.

## Ask — the real binder

The **Ask** results come from the actual OASIS binder, not a keyword guess. The browser POSTs
the question to a server route (`app/api/search/route.ts`), which calls `oasis_search` on an
OASIS MCP server and maps the ranked `intent_id`s onto the local dataset to build the graph.

- **MCP endpoint** is configurable via `OASIS_MCP_URL` (default `http://localhost:8899/mcp`).
- If the MCP is unreachable, Ask **falls back** to a local keyword scorer so it still works
  offline (rougher results — no semantics).

To run the real binder locally (so Ask mirrors your **local** index), start the OASIS MCP
over your local build — from the OASIS repo:

```bash
set -a; . ./.env; set +a        # GOOGLE_API_KEY — embeds each query at runtime
PORT=8899 node mcp/http-server.mjs
```

Then run the dashboard (`pnpm dev`); its `/api/search` route will reach it on `:8899`. In
production, point `OASIS_MCP_URL` at your deployed OASIS MCP instead.

## Layout engines

A switcher in the canvas toolbar (top-left) picks the layout for the current view:

- **Clusters** — domain-grouped grids (default for Explore).
- **Layered** — dagre hierarchical flow, left→right (default feel for Ask).
- **Radial** — concentric rings by graph distance from the focal node.

Nodes are sized by **canvas-measured label width** before layout, so the engines never
overlap them. Themes: **light / dark / system** (React Flow `colorMode` + next-themes).

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm build        # production build
pnpm lint         # eslint (strict; 0 warnings)
pnpm data         # regenerate the dataset from a built OASIS index
```

## Architecture

```
src/
  app/            layout (providers, fonts, theme), page, globals.css
  stores/         jotai atoms — the single source of truth
  types/          view-layer graph types
  lib/            ontology data, domain palette, matcher
  utils/          pure logic — text-measure, relation traversal, build-graph,
                  layout/{grouped,layered,radial}
  hooks/          use-graph (build+layout→atoms), use-flow (handlers+trace), use-theme-sync
  features/       theme (provider + toggle)
  components/
    layout/       header, sidebar, detail-panel, app-shell
    flow/         flow-canvas, nodes, edges, control-panel
    ui/           shadcn primitives
```

`useGraph` is the only orchestrator: it derives the graph from the input atoms, runs the
chosen layout, and writes positioned nodes/edges to the store. Everything else reads atoms.

## Data

The UI reads a slim graph at `src/data/ontology.json`, distilled from the full OASIS index
(`dist/index.json`). Refresh with `pnpm data` (auto-discovers `../dist/index.json`, or set
`OASIS_INDEX=/path/to/index.json`).
