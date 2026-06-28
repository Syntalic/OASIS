"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useReactFlow,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import type { GraphModel } from "@/lib/graph";
import { useForceLayout } from "@/lib/useForceLayout";
import {
  HighlightContext,
  nodeTypes,
  edgeTypes,
} from "@/components/flow-parts";

interface OntologyFlowProps {
  model: GraphModel;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** changes to this string trigger a fresh fitView (e.g. new question) */
  fitKey: string;
  /** bump to pan/zoom onto a specific node (e.g. clicking a result row) */
  focus?: { id: string; nonce: number } | null;
  /** bump to re-run fitView on demand */
  resetNonce?: number;
  /** bump to unpin everything and re-run the force layout */
  relayoutNonce?: number;
}

function FlowInner({ model, selectedId, onSelect, fitKey, focus, resetNonce, relayoutNonce }: OntologyFlowProps) {
  const { fitView, setCenter, getNode } = useReactFlow();
  const armFit = useRef(true);

  const handleSettle = useCallback(() => {
    if (!armFit.current) return;
    armFit.current = false;
    fitView({ duration: 600, padding: 0.18 });
  }, [fitView]);

  const {
    nodes,
    edges,
    onNodeDragStart,
    onNodeDrag,
    onNodeDragStop,
    reheat,
  } = useForceLayout(model, handleSettle);

  const [hoverId, setHoverId] = useState<string | null>(null);
  const lastFit = useRef<string>("");

  // adjacency for highlight tracing
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (!m.has(a)) m.set(a, new Set());
      m.get(a)!.add(b);
    };
    for (const e of model.edges) {
      add(e.source, e.target);
      add(e.target, e.source);
    }
    return m;
  }, [model]);

  const activeId = hoverId ?? selectedId;
  const related = useMemo(() => {
    if (!activeId) return new Set<string>();
    return adjacency.get(activeId) ?? new Set<string>();
  }, [activeId, adjacency]);

  // arm a one-shot refit whenever the visible topology changes; the actual
  // fitView fires from the force sim's "settle" callback (and an early pass so
  // the user isn't staring at an off-screen cluster while it relaxes).
  useEffect(() => {
    if (lastFit.current === fitKey) return;
    lastFit.current = fitKey;
    armFit.current = true;
    // fallback: if the sim takes too long to settle, fit anyway
    const t = setTimeout(() => {
      if (armFit.current) {
        armFit.current = false;
        fitView({ duration: 500, padding: 0.18 });
      }
    }, 1600);
    return () => clearTimeout(t);
  }, [fitKey, fitView]);

  // pan/zoom onto a node when requested from outside (result-row click)
  useEffect(() => {
    if (!focus) return;
    const n = getNode(focus.id);
    if (n) setCenter(n.position.x, n.position.y, { zoom: 1.15, duration: 600 });
  }, [focus, getNode, setCenter]);

  // on-demand fit
  useEffect(() => {
    if (resetNonce === undefined) return;
    fitView({ duration: 600, padding: 0.18 });
  }, [resetNonce, fitView]);

  // on-demand auto-arrange: unpin dragged nodes and re-run the simulation,
  // then refit once it settles
  useEffect(() => {
    if (relayoutNonce === undefined) return;
    armFit.current = true;
    reheat();
  }, [relayoutNonce, reheat]);

  // Re-fit when the canvas itself changes size (sidebar collapse/expand, window
  // resize). React Flow doesn't auto-fit on container resize, which otherwise
  // leaves the graph anchored to one side with dead space on the other.
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    let last = el.clientWidth;
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - last) < 6) return;
      last = el.clientWidth;
      clearTimeout(t);
      t = setTimeout(() => fitView({ duration: 300, padding: 0.18 }), 160);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [fitView]);

  const handleClick: NodeMouseHandler = useCallback(
    (_e, node) => onSelect(node.id),
    [onSelect],
  );
  const handleEnter: NodeMouseHandler = useCallback((_e, node) => setHoverId(node.id), []);
  const handleLeave = useCallback(() => setHoverId(null), []);

  const dragStart = useCallback(
    (_e: MouseEvent | TouchEvent, node: Node) => onNodeDragStart(node.id, node.position.x, node.position.y),
    [onNodeDragStart],
  );
  const drag = useCallback(
    (_e: MouseEvent | TouchEvent, node: Node) => onNodeDrag(node.id, node.position.x, node.position.y),
    [onNodeDrag],
  );
  const dragStop = useCallback(
    (_e: MouseEvent | TouchEvent, node: Node) => onNodeDragStop(node.id, node.position.x, node.position.y),
    [onNodeDragStop],
  );

  const minimapColor = useCallback((node: Node) => {
    const c = node.data as { color?: string; kind?: string };
    if (c.kind === "query") return "var(--primary)";
    if (c.kind === "entity") return "#64748b";
    return c.color ?? "#94a3b8";
  }, []);

  const ctx = useMemo(
    () => ({ activeId, related, hoverId, setHover: setHoverId }),
    [activeId, related, hoverId],
  );

  return (
    <HighlightContext.Provider value={ctx}>
      <div ref={wrapperRef} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleClick}
        onNodeMouseEnter={handleEnter}
        onNodeMouseLeave={handleLeave}
        onNodeDragStart={dragStart}
        onNodeDrag={drag}
        onNodeDragStop={dragStop}
        onPaneClick={() => onSelect(null)}
        minZoom={0.12}
        maxZoom={2.4}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "flow" }}
        nodesConnectable={false}
        elementsSelectable
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.2} color="rgba(148,163,184,0.13)" />
        <Controls showInteractive={false} position="bottom-left" />
        {nodes.length > 14 && (
          <MiniMap
            pannable
            zoomable
            nodeColor={minimapColor}
            nodeStrokeWidth={2}
            maskColor="rgba(8,10,18,0.78)"
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 10,
            }}
          />
        )}
      </ReactFlow>
      </div>
    </HighlightContext.Provider>
  );
}

export function OntologyFlow(props: OntologyFlowProps) {
  return (
    <ReactFlowProvider>
      <FlowInner {...props} />
    </ReactFlowProvider>
  );
}
