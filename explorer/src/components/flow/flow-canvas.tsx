"use client";

import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type Node,
} from "@xyflow/react";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import { ControlPanel } from "@/components/flow/control-panel";
import { edgeTypes } from "@/components/flow/edges";
import { nodeTypes } from "@/components/flow/nodes";
import { useFlow } from "@/hooks/use-flow";
import { graphKeyAtom } from "@/stores/graph";
import { selectedIdAtom } from "@/stores/selection";
import { showMinimapAtom } from "@/stores/ui";

/** width of the floating detail panel; selections pan clear of it */
const PANEL_W = 360;

export function FlowCanvas() {
  const { nodes, edges, colorMode, onNodesChange, onEdgesChange, onNodeClick, onPaneClick } =
    useFlow();
  const selectedId = useAtomValue(selectedIdAtom);
  const graphKey = useAtomValue(graphKeyAtom);
  const showMinimap = useAtomValue(showMinimapAtom);
  const { fitView, getNode, getZoom, setViewport } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // refit whenever the graph is rebuilt (new view / filter / layout)
  useEffect(() => {
    if (!graphKey) return;
    const t = setTimeout(() => fitView({ duration: 500, padding: 0.18 }), 60);
    return () => clearTimeout(t);
  }, [graphKey, fitView]);

  // pan the selected node into the area not covered by the detail panel
  const panToNode = useCallback(
    (id: string) => {
      const el = wrapperRef.current;
      const n = getNode(id);
      if (!el || !n?.measured?.width || !n.measured.height) return false;
      const zoom = getZoom();
      const cx = n.position.x + n.measured.width / 2;
      const cy = n.position.y + n.measured.height / 2;
      setViewport(
        { x: (el.clientWidth - PANEL_W) / 2 - cx * zoom, y: el.clientHeight / 2 - cy * zoom, zoom },
        { duration: 500 },
      );
      return true;
    },
    [getNode, getZoom, setViewport],
  );

  useEffect(() => {
    if (!selectedId) return;
    let tries = 0;
    let t: ReturnType<typeof setTimeout>;
    const attempt = () => {
      if (panToNode(selectedId) || tries++ > 12) return;
      t = setTimeout(attempt, 60);
    };
    t = setTimeout(attempt, 80);
    return () => clearTimeout(t);
  }, [selectedId, panToNode]);

  // recenter when the detail panel closes
  const prev = useRef<string | null>(selectedId);
  useEffect(() => {
    const was = prev.current;
    prev.current = selectedId;
    if (was && !selectedId) fitView({ duration: 450, padding: 0.18 });
  }, [selectedId, fitView]);

  // refit on container resize (sidebar collapse, window resize)
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

  const minimapColor = useCallback((n: Node) => {
    const c = n.data as { color?: string; kind?: string };
    if (c.kind === "query") return "var(--primary)";
    if (c.kind === "entity") return "var(--muted-foreground)";
    return c.color ?? "var(--muted-foreground)";
  }, []);

  return (
    <div ref={wrapperRef} className="oasis-atmosphere h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        colorMode={colorMode}
        minZoom={0.06}
        maxZoom={2.4}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elementsSelectable
        defaultEdgeOptions={{ type: "relation" }}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.2} />
        <Panel position="top-left">
          <ControlPanel />
        </Panel>
        {showMinimap && nodes.length > 14 && (
          <MiniMap
            position="top-right"
            pannable
            zoomable
            nodeColor={minimapColor}
            nodeStrokeWidth={2}
            style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}
          />
        )}
      </ReactFlow>
    </div>
  );
}
