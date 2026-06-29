"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Boxes, Layers, Plug, Search, Sparkles } from "lucide-react";
import { memo } from "react";

import { cn } from "@/lib/utils";
import type {
  CapabilityNodeData,
  DomainNodeData,
  EndpointNodeData,
  EntityNodeData,
  QueryNodeData,
} from "@/types/graph";

/** hidden handles on all sides so floating edges can attach anywhere */
function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

function fade(faded?: boolean) {
  return faded ? "opacity-25" : "opacity-100";
}

export const DomainNode = memo(function DomainNode({ data }: NodeProps) {
  const d = data as unknown as DomainNodeData;
  const lift = d.highlight;
  return (
    <div className={cn("flex flex-col items-center gap-1.5 transition-opacity duration-300", fade(d.faded))}>
      <Handles />
      <div
        className={cn(
          "grid h-[92px] w-[92px] place-items-center rounded-full border-2 text-center transition-transform duration-300",
          lift && "scale-110",
        )}
        style={{
          borderColor: d.color,
          background: `radial-gradient(circle at 50% 32%, color-mix(in oklab, ${d.color} 34%, var(--card)) 0%, color-mix(in oklab, ${d.color} 12%, var(--card)) 72%)`,
          boxShadow: `0 0 0 5px color-mix(in oklab, ${d.color} 9%, transparent), 0 12px 32px -8px color-mix(in oklab, ${d.color} ${lift ? 75 : 48}%, transparent)`,
        }}
      >
        <div className="flex flex-col items-center gap-0.5 px-1.5">
          <Boxes size={18} style={{ color: d.color }} />
          <div className="font-display text-[11px] font-bold leading-[1.1] text-foreground">{d.label}</div>
        </div>
      </div>
      <div
        className="rounded-full border bg-card/85 px-2 py-0.5 font-mono text-[9px] font-medium backdrop-blur-sm"
        style={{ borderColor: `color-mix(in oklab, ${d.color} 40%, var(--border))`, color: d.color }}
      >
        {d.capCount} · {d.endpointCount.toLocaleString()}
      </div>
    </div>
  );
});

export const CapabilityNode = memo(function CapabilityNode({ data, selected }: NodeProps) {
  const c = data as unknown as CapabilityNodeData;
  const active = c.highlight || selected;
  const ranked = typeof c.rank === "number";
  return (
    <div className={cn("transition-opacity duration-300", fade(c.faded))}>
      <Handles />
      <div
        className={cn(
          "relative w-[224px] rounded-xl border bg-card/95 px-3 py-2.5 shadow-lg backdrop-blur-sm transition-transform duration-200",
          active && "scale-[1.03] ring-2",
        )}
        style={{
          borderColor: active ? c.color : "var(--border)",
          boxShadow: active ? `0 10px 32px -10px color-mix(in oklab, ${c.color} 60%, transparent)` : undefined,
        }}
      >
        <span
          className="absolute top-3 -left-px h-[calc(100%-1.5rem)] w-1 rounded-full"
          style={{ background: c.color }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <Sparkles size={12} style={{ color: c.color }} />
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide"
              style={{ background: `color-mix(in oklab, ${c.color} 18%, transparent)`, color: c.color }}
            >
              {c.action ?? "capability"}
            </span>
          </span>
          {ranked ? (
            <span className="rounded-full bg-primary/20 px-1.5 text-[10px] font-bold text-primary">#{c.rank}</span>
          ) : (
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{c.endpointCount}★</span>
          )}
        </div>
        <div className="mt-1.5 text-[12.5px] font-medium leading-snug text-foreground">{c.label}</div>
        {typeof c.strength === "number" && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${Math.round(c.strength * 100)}%`, background: c.color }} />
          </div>
        )}
      </div>
    </div>
  );
});

export const EntityNode = memo(function EntityNode({ data }: NodeProps) {
  const e = data as unknown as EntityNodeData;
  return (
    <div className={cn("transition-opacity duration-300", fade(e.faded))}>
      <Handles />
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-dashed bg-secondary/70 px-2.5 py-1.5 backdrop-blur-sm transition-transform",
          e.highlight && "scale-105 border-solid border-foreground/40",
        )}
      >
        <Layers size={11} className="text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground">{e.name}</span>
        {e.degree > 1 && <span className="text-[9px] text-muted-foreground">·{e.degree}</span>}
      </div>
    </div>
  );
});

export const QueryNode = memo(function QueryNode({ data }: NodeProps) {
  const q = data as unknown as QueryNodeData;
  return (
    <div>
      <Handles />
      <div className="w-[264px] rounded-2xl border-2 border-primary/70 bg-primary/10 px-4 py-3 shadow-2xl backdrop-blur [animation:oasis-pulse_3.4s_ease-in-out_infinite] motion-reduce:[animation:none]">
        <div className="flex items-center gap-2 text-primary">
          <Search size={15} />
          <span className="font-display text-[10px] font-semibold uppercase tracking-[0.18em]">Your question</span>
        </div>
        <div className="mt-1.5 text-sm font-medium leading-snug text-foreground">“{q.text}”</div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {q.count} matching {q.count === 1 ? "capability" : "capabilities"}
        </div>
      </div>
    </div>
  );
});

export const EndpointNode = memo(function EndpointNode({ data }: NodeProps) {
  const e = data as unknown as EndpointNodeData;
  return (
    <div className={cn("transition-opacity duration-300", fade(e.faded))}>
      <Handles />
      <div
        className={cn(
          "flex w-[216px] items-center gap-1.5 rounded-lg border bg-background/85 px-2 py-1 font-mono backdrop-blur-sm transition-transform",
          e.highlight && "scale-105",
        )}
        style={{ borderColor: `color-mix(in oklab, ${e.color} 45%, var(--border))` }}
      >
        <Plug size={11} style={{ color: e.color }} />
        <span className="rounded px-1 text-[8px] font-bold" style={{ background: `color-mix(in oklab, ${e.color} 22%, transparent)`, color: e.color }}>
          {e.method}
        </span>
        <span className="truncate text-[9.5px] text-foreground/80" title={`${e.host}${e.path}`}>
          {e.host}
          <span className="text-muted-foreground">{e.path}</span>
        </span>
      </div>
    </div>
  );
});

export const nodeTypes = {
  domain: DomainNode,
  capability: CapabilityNode,
  entity: EntityNode,
  query: QueryNode,
  endpoint: EndpointNode,
};
