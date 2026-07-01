"use client";

import { useReactFlow } from "@xyflow/react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  Info,
  Map as MapIcon,
  Maximize2,
  Minus,
  Network,
  PanelLeftOpen,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useMemo } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { nodesAtom } from "@/stores/graph";
import { layoutEngineAtom } from "@/stores/options";
import { modeAtom } from "@/stores/query";
import { legendOpenAtom, relayoutNonceAtom, showMinimapAtom, sidebarCollapsedAtom } from "@/stores/ui";
import type { LayoutEngine } from "@/types/graph";
import { LAYOUT_LABELS } from "@/utils/layout";

const ENGINES: LayoutEngine[] = ["grouped", "layered", "radial"];

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ControlPanel() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const [engine, setEngine] = useAtom(layoutEngineAtom);
  const [showMinimap, setShowMinimap] = useAtom(showMinimapAtom);
  const [legendOpen, setLegendOpen] = useAtom(legendOpenAtom);
  const setRelayout = useSetAtom(relayoutNonceAtom);
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom);
  const mode = useAtomValue(modeAtom);

  return (
    <div className="relative flex items-center gap-0.5 rounded-xl border bg-card/90 p-1 shadow-2xl backdrop-blur-md">
      {collapsed && (
        <>
          <ToolButton label="Show controls" onClick={() => setCollapsed(false)}>
            <PanelLeftOpen size={15} />
          </ToolButton>
          <Divider />
        </>
      )}

      <ToolButton label="Zoom in" onClick={() => zoomIn({ duration: 200 })}>
        <Plus size={15} />
      </ToolButton>
      <ToolButton label="Zoom out" onClick={() => zoomOut({ duration: 200 })}>
        <Minus size={15} />
      </ToolButton>
      <ToolButton label="Fit to view" onClick={() => fitView({ duration: 500, padding: 0.18 })}>
        <Maximize2 size={14} />
      </ToolButton>
      <ToolButton label="Auto-arrange" onClick={() => setRelayout((n) => n + 1)}>
        <RotateCcw size={14} />
      </ToolButton>

      <Divider />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              title="Layout"
              className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Network size={14} />
              <span className="text-[11px] font-medium">{LAYOUT_LABELS[engine]}</span>
            </button>
          }
        />
        <DropdownMenuContent align="start">
          {ENGINES.map((e) => (
            <DropdownMenuItem key={e} onClick={() => setEngine(e)}>
              {LAYOUT_LABELS[e]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Divider />

      <ToolButton label="Toggle minimap" active={showMinimap} onClick={() => setShowMinimap((s) => !s)}>
        <MapIcon size={14} />
      </ToolButton>
      <ToolButton label="Legend" active={legendOpen} onClick={() => setLegendOpen((s) => !s)}>
        <Info size={14} />
      </ToolButton>

      {legendOpen && <Legend isAsk={mode === "ask"} />}
    </div>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px bg-border" />;
}

function Legend({ isAsk }: { isAsk: boolean }) {
  const nodes = useAtomValue(nodesAtom);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of nodes) {
      const k = (n.data as { kind?: string }).kind ?? "";
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [nodes]);

  return (
    <div className="absolute top-[calc(100%+8px)] left-0 w-72 rounded-xl border bg-popover/95 p-3 shadow-2xl backdrop-blur-md">
      <div className="font-display mb-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Map key
      </div>

      <LegendGroup title="Nodes">
        {isAsk ? (
          <>
            <LegendRow glyph={<QueryGlyph />} label="Your question" meta={counts.query} />
            <LegendRow glyph={<CapGlyph />} label="Matched capability" meta={counts.capability} />
            <LegendRow glyph={<EntityGlyph />} label="Entity · shared data" meta={counts.entity} />
            <LegendRow glyph={<EndpointGlyph />} label="Paid endpoint" meta={counts.endpoint} />
          </>
        ) : (
          <>
            <LegendRow glyph={<DomainGlyph />} label="Domain · a family of capabilities" meta={counts.domain} />
            <LegendRow glyph={<CapGlyph />} label="Capability · a task you can ask for" meta={counts.capability} />
            <LegendRow glyph={<EntityGlyph />} label="Entity · typed data" meta={counts.entity} />
          </>
        )}
      </LegendGroup>

      <LegendGroup title="Connections">
        {isAsk ? (
          <>
            <LegendRow glyph={<EdgeGlyph color="rgb(var(--signal))" />} label="matches your question" />
            <LegendRow glyph={<EdgeGlyph color="#a78bfa" dashed />} label="produces · consumes (data flow)" />
            <LegendRow glyph={<EdgeGlyph color="#34d399" />} label="served by (paid endpoint)" />
          </>
        ) : (
          <>
            <LegendRow glyph={<EdgeGlyph color="#64748b" />} label="in domain (capability → domain)" />
            <LegendRow glyph={<EdgeGlyph color="#64748b" dashed />} label="produces · consumes (data flow)" />
          </>
        )}
      </LegendGroup>

      <LegendGroup title="How to read">
        {isAsk && <LegendRow glyph={<BarGlyph />} label="bar = match strength" />}
        <LegendRow glyph={<StarGlyph />} label="★ = bound paid endpoints" />
        {!isAsk && <LegendRow glyph={<DomainCountGlyph />} label="domain badge = capabilities · endpoints" />}
      </LegendGroup>

      <p className="mt-1 border-t pt-2 text-[10px] leading-relaxed text-muted-foreground">
        Click a node to trace its links · drag to rearrange.
      </p>
    </div>
  );
}

function LegendGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">{title}</div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function LegendRow({ glyph, label, meta }: { glyph: React.ReactNode; label: string; meta?: number }) {
  return (
    <div className="flex items-center gap-2 text-[11.5px]">
      <span className="flex w-6 shrink-0 justify-center">{glyph}</span>
      <span className="flex-1 text-foreground/90">{label}</span>
      {meta != null && (
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{meta}</span>
      )}
    </div>
  );
}

/* mini-glyphs that mirror the canvas */
function DomainGlyph() {
  return <span className="h-3.5 w-3.5 rounded-full border-2" style={{ borderColor: "#38bdf8", background: "color-mix(in oklab, #38bdf8 18%, transparent)" }} />;
}
function CapGlyph() {
  return (
    <span className="relative h-3 w-5 overflow-hidden rounded-[3px] border bg-card">
      <span className="absolute top-0 left-0 h-full w-1" style={{ background: "#a78bfa" }} />
    </span>
  );
}
function EntityGlyph() {
  return <span className="h-3 w-5 rounded-[3px] border border-dashed bg-secondary" />;
}
function QueryGlyph() {
  return <span className="h-3.5 w-3.5 rounded-full border-2 border-primary bg-primary/25" />;
}
function EndpointGlyph() {
  return (
    <span className="flex h-3 w-5 items-center rounded border bg-background px-1">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#34d399" }} />
    </span>
  );
}
function StarGlyph() {
  return <span className="font-mono text-[10px] text-muted-foreground">★</span>;
}
function BarGlyph() {
  return (
    <span className="block h-1.5 w-5 overflow-hidden rounded-full bg-muted">
      <span className="block h-full w-3/5 rounded-full" style={{ background: "#a78bfa" }} />
    </span>
  );
}
function DomainCountGlyph() {
  return <span className="font-mono text-[8px] text-muted-foreground">3·40</span>;
}
function EdgeGlyph({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-0.5">
      <span className="h-0 w-3.5 border-t-2" style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />
      <span className="text-[8px] leading-none" style={{ color }}>
        ▸
      </span>
    </span>
  );
}
