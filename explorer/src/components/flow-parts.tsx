"use client";

import {
  createContext,
  useContext,
  memo,
  type ReactNode,
} from "react";
import {
  Handle,
  Position,
  getBezierPath,
  BaseEdge,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import {
  Boxes,
  Sparkles,
  Layers,
  Search,
  Plug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  CapabilityNodeData,
  DomainNodeData,
  EntityNodeData,
  QueryNodeData,
  EndpointNodeData,
} from "@/lib/graph";

/* ------------------------------------------------------------------ */
/* Highlight context — hover/select a node to trace its connections     */
/* ------------------------------------------------------------------ */

interface HighlightValue {
  activeId: string | null;
  related: Set<string>;
  hoverId: string | null;
  setHover: (id: string | null) => void;
}

export const HighlightContext = createContext<HighlightValue>({
  activeId: null,
  related: new Set(),
  hoverId: null,
  setHover: () => {},
});

function useNodeHighlight(id: string) {
  const { activeId, related } = useContext(HighlightContext);
  const dimming = activeId !== null;
  const isActive = activeId === id;
  const isRelated = related.has(id);
  return {
    dim: dimming && !isActive && !isRelated,
    active: isActive,
    related: isRelated,
  };
}

const hiddenHandles = (
  <>
    <Handle type="target" position={Position.Top} isConnectable={false} />
    <Handle type="source" position={Position.Bottom} isConnectable={false} />
  </>
);

function Shell({
  children,
  dim,
  className,
  style,
}: {
  children: ReactNode;
  dim: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn(
        "transition-[opacity,transform,box-shadow] duration-300 ease-out",
        dim ? "opacity-25" : "opacity-100",
        className,
      )}
      style={style}
    >
      {hiddenHandles}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Domain node                                                          */
/* ------------------------------------------------------------------ */

export const DomainNode = memo(function DomainNode({ id, data }: NodeProps) {
  const d = data as unknown as DomainNodeData;
  const { dim, active, related } = useNodeHighlight(id);
  const lifted = active || related;
  return (
    <Shell dim={dim}>
      <div className="flex flex-col items-center gap-1.5">
        <div
          className={cn(
            "grid h-[92px] w-[92px] place-items-center rounded-full border-2 text-center transition-transform duration-300",
            lifted && "scale-110",
          )}
          style={{
            borderColor: d.color,
            background: `radial-gradient(circle at 50% 32%, color-mix(in oklab, ${d.color} 34%, var(--card)) 0%, color-mix(in oklab, ${d.color} 14%, var(--card)) 72%)`,
            // standing glow makes the hubs read as raised above the capability
            // cards; it intensifies on hover/trace
            boxShadow: `0 0 0 5px color-mix(in oklab, ${d.color} 10%, transparent), 0 12px 34px -6px color-mix(in oklab, ${d.color} ${lifted ? 75 : 50}%, transparent)${
              lifted ? `, 0 0 0 3px color-mix(in oklab, ${d.color} 55%, transparent)` : ""
            }`,
          }}
        >
          <div className="flex flex-col items-center gap-0.5 px-1.5">
            <Boxes size={18} style={{ color: d.color }} />
            <div className="font-display text-[11px] font-bold leading-[1.1] text-foreground">
              {d.label}
            </div>
          </div>
        </div>
        <div
          className="rounded-full border bg-card/85 px-2 py-0.5 font-mono text-[9px] font-medium backdrop-blur-sm"
          style={{ borderColor: `color-mix(in oklab, ${d.color} 40%, var(--border))`, color: d.color }}
        >
          {d.capCount} · {d.endpointCount.toLocaleString()}
        </div>
      </div>
    </Shell>
  );
});

/* ------------------------------------------------------------------ */
/* Capability node                                                      */
/* ------------------------------------------------------------------ */

export const CapabilityNode = memo(function CapabilityNode({ id, data, selected }: NodeProps) {
  const c = data as unknown as CapabilityNodeData;
  const { dim, active, related } = useNodeHighlight(id);
  const ranked = typeof c.rank === "number";
  return (
    <Shell dim={dim}>
      <div
        className={cn(
          "group relative w-[208px] rounded-xl border bg-card/90 px-3 py-2.5 shadow-lg backdrop-blur-sm",
          (active || selected) && "ring-2",
          (active || related || selected) && "scale-[1.03]",
        )}
        style={{
          borderColor: active || selected ? c.color : "var(--border)",
          boxShadow:
            active || selected
              ? `0 8px 30px -8px color-mix(in oklab, ${c.color} 60%, transparent)`
              : undefined,
        }}
      >
        <span
          className="absolute -left-px top-3 h-[calc(100%-1.5rem)] w-1 rounded-full"
          style={{ background: c.color }}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles size={12} style={{ color: c.color }} />
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide"
              style={{ background: `color-mix(in oklab, ${c.color} 18%, transparent)`, color: c.color }}
            >
              {c.action ?? "capability"}
            </span>
          </div>
          {ranked ? (
            <span className="rounded-full bg-primary/20 px-1.5 text-[10px] font-bold text-primary">
              #{c.rank}
            </span>
          ) : (
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {c.endpointCount}★
            </span>
          )}
        </div>
        <div className="mt-1.5 text-[12.5px] font-medium leading-snug text-foreground">
          {c.label}
        </div>
        {typeof c.strength === "number" && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.round(c.strength * 100)}%`, background: c.color }}
            />
          </div>
        )}
      </div>
    </Shell>
  );
});

/* ------------------------------------------------------------------ */
/* Entity node                                                          */
/* ------------------------------------------------------------------ */

export const EntityNode = memo(function EntityNode({ id, data }: NodeProps) {
  const e = data as unknown as EntityNodeData;
  const { dim, active, related } = useNodeHighlight(id);
  return (
    <Shell dim={dim}>
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-dashed bg-secondary/60 px-2.5 py-1.5 backdrop-blur-sm",
          (active || related) && "scale-105 border-solid",
        )}
        style={{
          borderColor: active || related ? "#e2e8f0" : "var(--border)",
        }}
      >
        <Layers size={11} className="text-slate-300" />
        <span className="text-[11px] font-medium text-slate-200">{e.name}</span>
        {e.degree > 1 && (
          <span className="text-[9px] text-muted-foreground">·{e.degree}</span>
        )}
      </div>
    </Shell>
  );
});

/* ------------------------------------------------------------------ */
/* Query node (question mode hub)                                       */
/* ------------------------------------------------------------------ */

export const QueryNode = memo(function QueryNode({ data }: NodeProps) {
  const q = data as unknown as QueryNodeData;
  return (
    <div className="relative">
      {hiddenHandles}
      <div className="w-[260px] rounded-2xl border-2 border-primary/70 bg-primary/10 px-4 py-3 shadow-2xl backdrop-blur [animation:oasis-pulse_3.4s_ease-in-out_infinite] motion-reduce:[animation:none]">
        <div className="flex items-center gap-2 text-primary">
          <Search size={15} />
          <span className="font-display text-[10px] font-semibold uppercase tracking-[0.18em]">Your question</span>
        </div>
        <div className="mt-1.5 text-sm font-medium leading-snug text-foreground">
          “{q.text}”
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {q.count} matching {q.count === 1 ? "capability" : "capabilities"}
        </div>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Endpoint node (real paid API)                                       */
/* ------------------------------------------------------------------ */

export const EndpointNode = memo(function EndpointNode({ id, data }: NodeProps) {
  const e = data as unknown as EndpointNodeData;
  const { dim, active, related } = useNodeHighlight(id);
  return (
    <Shell dim={dim}>
      <div
        className={cn(
          "flex max-w-[200px] items-center gap-1.5 rounded-lg border bg-background/80 px-2 py-1 font-mono backdrop-blur-sm",
          (active || related) && "scale-105",
        )}
        style={{ borderColor: `color-mix(in oklab, ${e.color} 45%, var(--border))` }}
      >
        <Plug size={11} style={{ color: e.color }} />
        <span
          className="rounded px-1 text-[8px] font-bold"
          style={{ background: `color-mix(in oklab, ${e.color} 22%, transparent)`, color: e.color }}
        >
          {e.method}
        </span>
        <span className="truncate text-[9.5px] text-slate-300" title={`${e.host}${e.path}`}>
          {e.host}
          <span className="text-muted-foreground">{e.path}</span>
        </span>
      </div>
    </Shell>
  );
});

export const nodeTypes = {
  domain: DomainNode,
  capability: CapabilityNode,
  entity: EntityNode,
  query: QueryNode,
  endpoint: EndpointNode,
};

/* ------------------------------------------------------------------ */
/* Custom edge — colored bezier that dims when another node is active   */
/* ------------------------------------------------------------------ */

export const FlowEdge = memo(function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  source,
  target,
  data,
  markerEnd,
}: EdgeProps) {
  const { activeId } = useContext(HighlightContext);
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.28,
  });
  const d = (data ?? {}) as { color?: string; flow?: boolean; strength?: number };
  const touches = activeId === source || activeId === target;
  const dim = activeId !== null && !touches;
  const baseOpacity = d.flow ? 0.9 : 0.32;
  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={{
        stroke: d.color ?? "#475569",
        strokeWidth: touches ? 2.6 : d.flow ? 2 : 1.25,
        strokeOpacity: dim ? 0.06 : touches ? 1 : baseOpacity,
        transition: "stroke-opacity 0.25s ease, stroke-width 0.25s ease",
      }}
    />
  );
});

export const edgeTypes = { flow: FlowEdge };
