"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { Edge, Node } from "@xyflow/react";
import type { GraphModel, OntNode } from "@/lib/graph";

interface SimNode extends SimulationNodeDatum {
  id: string;
  ref: OntNode;
}

interface SimLink {
  source: string | SimNode;
  target: string | SimNode;
  strength: number;
}

const NODE_BASE_RADIUS = 64;

/**
 * Runs a d3-force simulation over the abstract graph and exposes positioned
 * React Flow nodes/edges. Positions for nodes that persist across model changes
 * are carried over, so swapping the question (or toggling entities) makes the
 * graph *glide* into its new shape instead of snapping.
 */
export function useForceLayout(model: GraphModel, onSettle?: () => void) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const pinnedRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const rafRef = useRef<number | null>(null);
  const settleRef = useRef(onSettle);
  useEffect(() => {
    settleRef.current = onSettle;
  }, [onSettle]);

  // stable signature so we only rebuild when topology actually changes
  const signature = useMemo(() => {
    const n = model.nodes.map((x) => x.id).join("|");
    const e = model.edges.map((x) => x.id).join("|");
    return n + "::" + e;
  }, [model]);

  const buildEdges = useCallback((): Edge[] => {
    return model.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "flow",
      className: e.flow ? "oasis-flow" : undefined,
      data: { color: e.color, flow: e.flow, strength: e.strength, kind: e.kind },
      style: {
        stroke: e.color,
        strokeWidth: e.flow ? 2 : 1.25,
        strokeOpacity: e.flow ? 0.9 : 0.32,
      },
    }));
  }, [model]);

  useEffect(() => {
    simRef.current?.stop();

    const simNodes: SimNode[] = model.nodes.map((ref) => {
      const prev = pinnedRef.current.get(ref.id) ?? posRef.current.get(ref.id);
      return {
        id: ref.id,
        ref,
        x: prev?.x ?? ref.seed.x,
        y: prev?.y ?? ref.seed.y,
        fx: pinnedRef.current.get(ref.id)?.x ?? null,
        fy: pinnedRef.current.get(ref.id)?.y ?? null,
      };
    });
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: SimLink[] = model.edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, strength: e.strength }));

    const radius = (n: SimNode) => NODE_BASE_RADIUS * n.ref.weight;

    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((l) => 150 + (1 - l.strength) * 130)
          .strength((l) => 0.05 + l.strength * 0.35),
      )
      .force("charge", forceManyBody<SimNode>().strength((n) => -260 * n.ref.weight))
      .force("collide", forceCollide<SimNode>().radius(radius).strength(0.85))
      .force("x", forceX<SimNode>(0).strength(0.045))
      .force("y", forceY<SimNode>(0).strength(0.045))
      .force("center", forceCenter(0, 0).strength(0.05))
      .alpha(0.9)
      .alphaDecay(0.028);

    simRef.current = sim;

    // stack the hubs above the cards so their glow is never buried
    const zForKind: Record<string, number> = { query: 30, domain: 20, entity: 5 };
    const nodeTemplates: Node[] = model.nodes.map((ref) => ({
      id: ref.id,
      type: ref.kind,
      position: { x: 0, y: 0 },
      data: ref.data as unknown as Record<string, unknown>,
      draggable: true,
      zIndex: zForKind[ref.kind] ?? 10,
    }));

    const flush = () => {
      for (const sn of simNodes) {
        posRef.current.set(sn.id, { x: sn.x ?? 0, y: sn.y ?? 0 });
      }
      setNodes(
        nodeTemplates.map((t) => {
          const p = posRef.current.get(t.id)!;
          return { ...t, position: { x: p.x, y: p.y } };
        }),
      );
    };

    sim.on("tick", () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        flush();
      });
    });

    sim.on("end", () => {
      flush();
      settleRef.current?.();
    });

    // paint the first frame on the next tick so we're not calling setState
    // synchronously inside the effect body (the sim drives everything after)
    const initRaf = requestAnimationFrame(() => {
      setEdges(buildEdges());
      flush();
    });

    return () => {
      sim.stop();
      cancelAnimationFrame(initRaf);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const onNodeDragStart = useCallback((id: string, x: number, y: number) => {
    const sim = simRef.current;
    if (!sim) return;
    const n = sim.nodes().find((sn) => sn.id === id);
    if (n) {
      n.fx = x;
      n.fy = y;
    }
    sim.alphaTarget(0.2).restart();
  }, []);

  const onNodeDrag = useCallback((id: string, x: number, y: number) => {
    const sim = simRef.current;
    if (!sim) return;
    const n = sim.nodes().find((sn) => sn.id === id);
    if (n) {
      n.fx = x;
      n.fy = y;
    }
  }, []);

  const onNodeDragStop = useCallback((id: string, x: number, y: number) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.alphaTarget(0);
    pinnedRef.current.set(id, { x, y });
  }, []);

  const reheat = useCallback(() => {
    pinnedRef.current.clear();
    const sim = simRef.current;
    if (sim) {
      sim.nodes().forEach((n) => {
        n.fx = null;
        n.fy = null;
      });
      sim.alpha(0.9).restart();
    }
  }, []);

  return {
    nodes,
    edges,
    setNodes,
    onNodeDragStart,
    onNodeDrag,
    onNodeDragStop,
    reheat,
  };
}
