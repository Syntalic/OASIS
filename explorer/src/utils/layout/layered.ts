import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

import { adaptiveSpacing, getNodeSize } from "@/utils/layout/sizes";

type Pos = { x: number; y: number };

/**
 * Hierarchical layered layout via dagre — fed exact node dimensions so nothing
 * overlaps. Left→right reads as a flow (question → capabilities → entities →
 * endpoints; or domain → capability → entity in Explore).
 */
export function layeredLayout(
  nodes: Node[],
  edges: Edge[],
  rankdir: "LR" | "TB" = "LR",
): Map<string, Pos> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir,
    nodesep: adaptiveSpacing(34, nodes.length),
    ranksep: adaptiveSpacing(96, nodes.length),
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    const [width, height] = getNodeSize(n);
    g.setNode(n.id, { width, height });
  }
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target)) g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const out = new Map<string, Pos>();
  for (const n of nodes) {
    const p = g.node(n.id);
    if (!p) continue;
    const [w, h] = getNodeSize(n);
    out.set(n.id, { x: p.x - w / 2, y: p.y - h / 2 });
  }
  return out;
}
