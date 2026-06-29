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

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
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
  const items = isAsk
    ? [
        { c: "var(--primary)", l: "Your question" },
        { c: "#a78bfa", l: "Capability" },
        { c: "#94a3b8", l: "Entity (data passed between capabilities)" },
        { c: "#34d399", l: "Paid endpoint" },
      ]
    : [
        { c: "#38bdf8", l: "Domain" },
        { c: "#a78bfa", l: "Capability" },
        { c: "#94a3b8", l: "Entity (data passed between capabilities)" },
      ];
  return (
    <div className="absolute top-[calc(100%+8px)] left-0 w-64 rounded-xl border bg-popover/95 p-3 shadow-2xl backdrop-blur-md">
      <div className="font-display mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Legend
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map((it) => (
          <div key={it.l} className="flex items-center gap-2 text-[12px] text-foreground/90">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: it.c }} />
            {it.l}
          </div>
        ))}
      </div>
      <p className="mt-2.5 border-t pt-2 text-[10.5px] leading-relaxed text-muted-foreground">
        Click a node to trace its connections and open details.
      </p>
    </div>
  );
}
