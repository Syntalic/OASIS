# OASIS Ontology Explorer

An interactive, animated map of the [OASIS](https://github.com/Syntalic/OASIS) task
ontology — the vendor-neutral discovery layer for **paid** x402 / MPP HTTP APIs.

It turns the OASIS index into a living graph of **domains → capabilities → entities →
bound paid endpoints**, so you can *see* how a natural-language task threads through the
ontology to the real APIs that satisfy it.

Built with **Next.js (App Router)**, **shadcn/ui**, **Tailwind CSS v4**,
[**@xyflow/react**](https://reactflow.dev) for the canvas, and **d3-force** for a live,
self-organizing layout.

## Two ways to explore

### 🧭 Explore
The whole ontology at rest. Domains sit as colored hubs; their capabilities cluster
around them; typed **entities** (`Text`, `Image`, `Company`, …) connect capabilities by
data flow (one capability *produces* what another *consumes*). Filter to a single domain
or toggle the entity-flow layer on and off.

### ✨ Ask a question
Type a task in plain language — *"turn this article into narrated audio"* — and the graph
re-forms around it: a central **question** node, the **ranked capabilities** that match
(scored locally, no API key), the **entities** they share, and the **real paid endpoints**
OASIS bound to them. Animated "marching-ants" edges trace the flow from your words to the
APIs that can be paid and called.

Throughout: **hover** any node to trace its connections, **click** for a detail panel
(description, consumes/produces ports, aliases, providers, sample endpoints), and **drag**
to rearrange — the force layout gracefully relaxes around your changes.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Other scripts:

```bash
pnpm build        # production build
pnpm lint         # eslint (strict; 0 warnings)
pnpm data         # regenerate the dataset (see below)
```

## Data

The UI reads a single slim, denormalized graph at [`src/data/ontology.json`](src/data/ontology.json)
(~150 KB) distilled from the full OASIS index (`dist/index.json`, ~50 MB, gitignored). To
refresh it after rebuilding the index in the OASIS repo (`pnpm run build` there):

```bash
pnpm data                                   # auto-discovers ../dist/index.json
OASIS_INDEX=/path/to/dist/index.json pnpm data   # or point it explicitly
```

The dataset captures, per capability: facets (domain / action / modality / freshness),
consumed & produced entities, total bound-endpoint count, top providers, and a few sample
endpoints — plus entity producer/consumer adjacency and per-domain rollups.

> The question-matching in **Ask** is a transparent, fully client-side token scorer over
> labels, aliases, descriptions, facets and entities — a lightweight stand-in for the OASIS
> semantic binder, so the visualization reacts instantly and offline.
