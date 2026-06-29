import type { Edge, Node } from "@xyflow/react";

import type { LayoutEngine } from "@/types/graph";
import { groupedLayout } from "@/utils/layout/grouped";
import { layeredLayout } from "@/utils/layout/layered";
import { radialLayout } from "@/utils/layout/radial";

export interface LayoutOptions {
  rankdir?: "LR" | "TB";
  centerId?: string | null;
}

/** Run the chosen engine and return a new node array with positions applied. */
export function applyLayout(
  engine: LayoutEngine,
  nodes: Node[],
  edges: Edge[],
  opts: LayoutOptions = {},
): Node[] {
  let pos: Map<string, { x: number; y: number }>;
  switch (engine) {
    case "layered":
      pos = layeredLayout(nodes, edges, opts.rankdir ?? "LR");
      break;
    case "radial":
      pos = radialLayout(nodes, edges, opts.centerId);
      break;
    case "grouped":
    default:
      pos = groupedLayout(nodes);
      break;
  }
  return nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? { x: 0, y: 0 } }));
}

export const LAYOUT_LABELS: Record<LayoutEngine, string> = {
  grouped: "Clusters",
  layered: "Layered",
  radial: "Radial",
};
