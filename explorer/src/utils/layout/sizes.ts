import type { Node } from "@xyflow/react";

import type { NodeKind } from "@/types/graph";

const DEFAULTS: Record<NodeKind, [number, number]> = {
  domain: [184, 104],
  capability: [224, 76],
  entity: [132, 44],
  query: [264, 96],
  endpoint: [216, 40],
};

/** Real footprint of a node — text-measured size from build-graph, else a per-kind default. */
export function getNodeSize(node: Node): [number, number] {
  const data = node.data as { size?: [number, number]; kind?: NodeKind };
  if (Array.isArray(data?.size) && data.size.length === 2) return data.size;
  return DEFAULTS[(data?.kind as NodeKind) ?? "capability"] ?? [200, 72];
}

/** Compress spacing as the graph grows (ported from OpenMetadata). */
export function adaptiveSpacing(base: number, count: number): number {
  if (count <= 50) return base;
  if (count <= 200) return Math.ceil(base * 0.75);
  if (count <= 1000) return Math.ceil(base * 0.5);
  return Math.ceil(base * 0.3);
}
