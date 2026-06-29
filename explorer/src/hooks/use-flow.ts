"use client";

import {
  applyEdgeChanges,
  applyNodeChanges,
  type Node,
  type NodeMouseHandler,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

import { edgesAtom, nodesAtom } from "@/stores/graph";
import { selectedIdAtom } from "@/stores/selection";
import { colorModeAtom } from "@/stores/theme";
import { neighbors } from "@/utils/relation";

/**
 * React Flow interaction layer — change handlers plus the "trace connections"
 * relation feature (highlight everything connected to the clicked node, fade
 * the rest), à la Repree.
 */
export function useFlow() {
  const [nodes, setNodes] = useAtom(nodesAtom);
  const [edges, setEdges] = useAtom(edgesAtom);
  const setSelected = useSetAtom(selectedIdAtom);
  const colorMode = useAtomValue(colorModeAtom);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [setNodes],
  );
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [setEdges],
  );

  const onNodeClick: NodeMouseHandler<Node> = useCallback(
    (_, node) => {
      // direct neighbours light up, everything else fades (the graph is cyclic
      // through shared entities, so a one-hop trace reads far more clearly than
      // a full transitive one — which would reach almost every node)
      const nbrs = neighbors(node.id, edges);
      const active = new Set<string>([node.id, ...nbrs]);
      setSelected(node.id);
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: { ...n.data, highlight: active.has(n.id), faded: !active.has(n.id) },
        })),
      );
      setEdges((eds) =>
        eds.map((e) => {
          const touches = e.source === node.id || e.target === node.id;
          return { ...e, data: { ...e.data, traced: touches, faded: !touches } };
        }),
      );
    },
    [edges, setNodes, setEdges, setSelected],
  );

  const onPaneClick = useCallback(() => {
    setSelected(null);
    setNodes((nds) =>
      nds.map((n) => ({ ...n, data: { ...n.data, highlight: false, faded: false } })),
    );
    setEdges((eds) =>
      eds.map((e) => ({ ...e, data: { ...e.data, traced: false, faded: false } })),
    );
  }, [setNodes, setEdges, setSelected]);

  return {
    nodes,
    edges,
    colorMode,
    onNodesChange,
    onEdgesChange,
    onNodeClick,
    onPaneClick,
  };
}
