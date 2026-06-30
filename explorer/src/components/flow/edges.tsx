"use client";

import {
  BaseEdge,
  getBezierPath,
  Position,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
  type Node,
} from "@xyflow/react";
import { memo } from "react";

function centerOf(node: InternalNode<Node>) {
  return {
    x: node.internals.positionAbsolute.x + (node.measured?.width ?? 0) / 2,
    y: node.internals.positionAbsolute.y + (node.measured?.height ?? 0) / 2,
  };
}

/**
 * Floating edge that connects node centres, so it reads correctly under any
 * layout engine (clusters / layered / radial). Renders below the nodes, so the
 * segment under each card is hidden. Animates when it carries flow.
 */
export const RelationEdge = memo(function RelationEdge({
  id,
  source,
  target,
  markerEnd,
  data,
}: EdgeProps) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;

  const sc = centerOf(s);
  const tc = centerOf(t);
  const horizontal = Math.abs(tc.x - sc.x) >= Math.abs(tc.y - sc.y);
  const sourcePosition = horizontal
    ? tc.x >= sc.x
      ? Position.Right
      : Position.Left
    : tc.y >= sc.y
      ? Position.Bottom
      : Position.Top;
  const targetPosition = horizontal
    ? tc.x >= sc.x
      ? Position.Left
      : Position.Right
    : tc.y >= sc.y
      ? Position.Top
      : Position.Bottom;

  const [path] = getBezierPath({
    sourceX: sc.x,
    sourceY: sc.y,
    targetX: tc.x,
    targetY: tc.y,
    sourcePosition,
    targetPosition,
    curvature: 0.25,
  });

  const d = (data ?? {}) as { color?: string; flow?: boolean; faded?: boolean; traced?: boolean };
  // animate when this edge carries flow, or when it's part of a click trace
  const animate = (!!d.flow || !!d.traced) && !d.faded;

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      className={animate ? "oasis-flow" : undefined}
      style={{
        stroke: d.color ?? "var(--muted-foreground)",
        strokeWidth: d.traced ? 2.6 : d.flow ? 2 : 1.25,
        strokeOpacity: d.faded ? 0.06 : d.traced ? 1 : d.flow ? 0.9 : 0.34,
        transition: "stroke-opacity 0.25s ease, stroke-width 0.25s ease",
      }}
    />
  );
});

export const edgeTypes = { relation: RelationEdge };
