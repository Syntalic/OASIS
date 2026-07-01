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
to a server route (`app/api/oasis/route.ts`), which calls the OASIS MCP with a single
**`oasis_discover`** call (the superset — capabilities + endpoints + `next_steps` in one) and
maps the results onto the local dataset to build the graph. `oasis_resolve` is used only for
the per-capability drill-down in the detail panel.

- **MCP endpoint** is set by `OASIS_MCP_URL` (default `http://localhost:8899/mcp`).
- If the MCP is unreachable (or `oasis_discover` returns no `matched_capabilities`), it **falls
  back** to a local keyword scorer so the dashboard still works offline (rougher — no semantics).
  Endpoints / resolve need the MCP.

## Running

```bash
pnpm install
pnpm dev:all      # dashboard + the local OASIS MCP together (recommended)
pnpm dev          # dashboard only (Ask falls back to the keyword scorer)
```

`pnpm dev:all` starts the dashboard **and** the local MCP (over the repo's `dist/index.json`)
so Ask mirrors your **local** index. The MCP needs `GOOGLE_API_KEY` in the OASIS repo's `.env`
(it embeds each query at runtime; the key stays in that process, never in the browser). This
assumes the dashboard lives at `<oasis-repo>/explorer` — `scripts/local-mcp.sh` walks up to
find `mcp/http-server.mjs` (override with `OASIS_DIR=/path/to/OASIS`).

## Deploy on Vercel

The dashboard is a standard Next app; nothing in it needs the OASIS toolchain at runtime.

1. **Root Directory** → `explorer` (the dashboard is a subdirectory of the OASIS repo).
2. **Environment variable** → `OASIS_MCP_URL=https://mcp.oasisindex.org/mcp` so Ask uses the
   **hosted, deployed** MCP (the local default is only for dev). See `.env.example`.
3. Build/install are auto-detected from the pnpm lockfile.

The hosted MCP is public and per-IP rate-limited; if a deployed dashboard ever gets heavy
traffic the binder calls may be throttled (Explore is unaffected — it's all static data).

## Layout engines

A switcher in the canvas toolbar (top-left) picks the layout for the current view:

- **Clusters** — domain-grouped grids (default for Explore).
- **Layered** — dagre hierarchical flow, left→right (default feel for Ask).
- **Radial** — concentric rings by graph distance from the focal node.

Nodes are sized by **canvas-measured label width** before layout, so the engines never
overlap them. Themes: **light / dark / system** (React Flow `colorMode` + next-themes).

## Other scripts

```bash
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
