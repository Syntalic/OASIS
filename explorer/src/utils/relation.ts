import type { Edge, Node } from "@xyflow/react";

/** Undirected adjacency map for the current graph. */
export function buildAdjacency(edges: Edge[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!m.has(a)) m.set(a, new Set());
    m.get(a)!.add(b);
  };
  for (const e of edges) {
    add(e.source, e.target);
    add(e.target, e.source);
  }
  return m;
}

/**
 * Every node reachable from `startId` over the (undirected) graph — the
 * "show everything connected" relation feature (à la Repree). Undirected so a
 * capability traces to both its domain/inputs and its outputs/endpoints.
 */
export function traceConnected(startId: string, edges: Edge[]): Set<string> {
  const adj = buildAdjacency(edges);
  const seen = new Set<string>([startId]);
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const nb of adj.get(cur) ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        stack.push(nb);
      }
    }
  }
  return seen;
}

/** Direct neighbours of a node (one hop). */
export function neighbors(id: string, edges: Edge[]): Set<string> {
  return buildAdjacency(edges).get(id) ?? new Set();
}

/** Edges with both endpoints inside `ids`. */
export function chainEdges(ids: Set<string>, edges: Edge[]): Edge[] {
  return edges.filter((e) => ids.has(e.source) && ids.has(e.target));
}

export function nodeById(nodes: Node[], id: string): Node | undefined {
  return nodes.find((n) => n.id === id);
}
