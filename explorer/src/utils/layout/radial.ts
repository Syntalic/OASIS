import type { Edge, Node } from "@xyflow/react";

import { buildAdjacency } from "@/utils/relation";
import { adaptiveSpacing, getNodeSize } from "@/utils/layout/sizes";

type Pos = { x: number; y: number };

/**
 * Concentric rings by graph distance from a focal node (the spirit of
 * OpenMetadata's computeAssetRingPositions): the focus sits at the centre and
 * each BFS layer forms a ring whose radius grows to fit its members.
 */
export function radialLayout(
  nodes: Node[],
  edges: Edge[],
  centerId?: string | null,
): Map<string, Pos> {
  const out = new Map<string, Pos>();
  if (nodes.length === 0) return out;

  const adj = buildAdjacency(edges);
  const degree = (id: string) => adj.get(id)?.size ?? 0;

  const center =
    (centerId && nodes.find((n) => n.id === centerId)?.id) ||
    [...nodes].sort((a, b) => degree(b.id) - degree(a.id))[0].id;

  // BFS distances from the focal node
  const dist = new Map<string, number>([[center, 0]]);
  let frontier = [center];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!dist.has(nb)) {
          dist.set(nb, dist.get(id)! + 1);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }

  // disconnected nodes go to an outer ring
  const maxDist = Math.max(0, ...dist.values());
  for (const n of nodes) if (!dist.has(n.id)) dist.set(n.id, maxDist + 1);

  const rings = new Map<number, Node[]>();
  for (const n of nodes) {
    const d = dist.get(n.id)!;
    if (!rings.has(d)) rings.set(d, []);
    rings.get(d)!.push(n);
  }

  const RING_GAP = adaptiveSpacing(220, nodes.length);

  for (const [d, ringNodes] of rings) {
    if (d === 0) {
      const [w, h] = getNodeSize(ringNodes[0]);
      out.set(ringNodes[0].id, { x: -w / 2, y: -h / 2 });
      continue;
    }
    const maxW = Math.max(...ringNodes.map((n) => getNodeSize(n)[0]));
    const arcSpacing = maxW + 44;
    const needed = (ringNodes.length * arcSpacing) / (2 * Math.PI);
    const radius = Math.max(d * RING_GAP, needed);
    ringNodes.forEach((n, i) => {
      const angle = (i / ringNodes.length) * 2 * Math.PI - Math.PI / 2;
      const [w, h] = getNodeSize(n);
      out.set(n.id, {
        x: radius * Math.cos(angle) - w / 2,
        y: radius * Math.sin(angle) - h / 2,
      });
    });
  }
  return out;
}
