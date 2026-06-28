"use client";

import {
  Search,
  CornerDownLeft,
  PanelLeftClose,
  RotateCcw,
  Layers3,
  Sparkles,
  Compass,
  Crosshair,
} from "lucide-react";
import { domains, domainMeta, type MatchResult } from "@/lib/ontology";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type Mode = "explore" | "ask";

export const SAMPLE_QUESTIONS_SHORT = [
  "Narrate an article as audio",
  "Convert USD to euros",
  "Screenshot a webpage",
  "Enrich a company by domain",
  "Image from a text prompt",
  "Send a transactional SMS",
  "7-day weather forecast",
  "Extract data from a PDF",
];

interface ControlSidebarProps {
  mode: Mode;
  collapsed: boolean;
  onCollapse: () => void;
  onResetView: () => void;
  onAutoArrange: () => void;

  // explore
  showEntities: boolean;
  setShowEntities: (b: boolean) => void;
  focusDomain: string | null;
  setFocusDomain: (d: string | null) => void;

  // ask
  input: string;
  setInput: (s: string) => void;
  onSubmit: () => void;
  onPick: (s: string) => void;
  query: string;
  matches: MatchResult[];

  // shared
  selectedId: string | null;
  onSelectResult: (id: string) => void;
}

export function ControlSidebar(props: ControlSidebarProps) {
  const { mode, collapsed, onCollapse } = props;

  // When collapsed the sidebar takes zero width — the floating expand button
  // rendered over the canvas is the only affordance, so there's no dead rail.
  if (collapsed) return null;

  return (
    <aside className="flex w-[316px] shrink-0 flex-col overflow-hidden border-r border-border/70 bg-card/40">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="font-display flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {mode === "ask" ? <Sparkles size={13} /> : <Compass size={13} />}
          {mode === "ask" ? "Ask" : "Explore"}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCollapse} title="Collapse">
          <PanelLeftClose size={15} />
        </Button>
      </div>
      <Separator />

      {mode === "ask" ? <AskBody {...props} /> : <ExploreBody {...props} />}

      <Separator />
      <SidebarFooter mode={mode} onResetView={props.onResetView} onAutoArrange={props.onAutoArrange} />
    </aside>
  );
}

/* ------------------------------------------------------------------ */

function ExploreBody({
  showEntities,
  setShowEntities,
  focusDomain,
  setFocusDomain,
}: ControlSidebarProps) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-4 p-3">
        <label className="flex items-center justify-between gap-2 rounded-lg border bg-secondary/30 px-3 py-2">
          <span className="flex items-center gap-2 text-[12.5px] font-medium">
            <Layers3 size={14} className="text-muted-foreground" />
            Entity flow
          </span>
          <Switch checked={showEntities} onCheckedChange={setShowEntities} />
        </label>

        <div>
          <div className="font-display mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Domains
          </div>
          <div className="space-y-0.5">
            <DomainRow
              active={focusDomain === null}
              color="#e2e8f0"
              label="All domains"
              count={domains.reduce((s, d) => s + d.capabilities.length, 0)}
              onClick={() => setFocusDomain(null)}
            />
            {domains.map((d) => {
              const meta = domainMeta(d.id);
              return (
                <DomainRow
                  key={d.id}
                  active={focusDomain === d.id}
                  color={meta.color}
                  label={meta.label}
                  count={d.capabilities.length}
                  onClick={() => setFocusDomain(focusDomain === d.id ? null : d.id)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

function DomainRow({
  active,
  color,
  label,
  count,
  onClick,
}: {
  active: boolean;
  color: string;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="flex-1 truncate">{label}</span>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */

function AskBody({
  input,
  setInput,
  onSubmit,
  onPick,
  query,
  matches,
  selectedId,
  onSelectResult,
}: ControlSidebarProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2.5 p-3">
        <div className="flex items-center gap-1.5 rounded-lg border bg-secondary/30 pl-2.5">
          <Search size={15} className="shrink-0 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) onSubmit();
            }}
            placeholder="Describe a task…"
            className="h-9 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
        <Button size="sm" className="h-8 w-full gap-1.5" disabled={!input.trim()} onClick={onSubmit}>
          Trace connections
          <CornerDownLeft size={13} />
        </Button>
        <div className="flex flex-wrap gap-1">
          {SAMPLE_QUESTIONS_SHORT.map((q) => (
            <button
              key={q}
              onClick={() => onPick(q)}
              className="rounded-full border px-2 py-0.5 text-[10.5px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {query ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="font-display px-3 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {matches.length} match{matches.length === 1 ? "" : "es"}
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1 p-2 pt-0">
              {matches.map((m, i) => {
                const meta = domainMeta(m.capability.domain);
                const selected = selectedId === m.capability.id;
                return (
                  <button
                    key={m.capability.id}
                    onClick={() => onSelectResult(m.capability.id)}
                    className={cn(
                      "w-full rounded-lg border px-2.5 py-2 text-left transition",
                      selected ? "border-primary/50 bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold"
                        style={{ background: `color-mix(in oklab, ${meta.color} 22%, transparent)`, color: meta.color }}
                      >
                        {i + 1}
                      </span>
                      <span className="flex-1 truncate text-[12.5px] font-medium text-foreground">
                        {m.capability.label}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 pl-7">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.round(m.strength * 100)}%`, background: meta.color }}
                        />
                      </div>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                        {m.capability.endpointCount} APIs
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Ask a question to see the capabilities and paid endpoints it connects to.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SidebarFooter({
  mode,
  onResetView,
  onAutoArrange,
}: {
  mode: Mode;
  onResetView: () => void;
  onAutoArrange: () => void;
}) {
  const items =
    mode === "ask"
      ? [
          { c: "var(--primary)", l: "Question" },
          { c: "#a78bfa", l: "Capability" },
          { c: "#94a3b8", l: "Entity" },
          { c: "#34d399", l: "Paid endpoint" },
        ]
      : [
          { c: "#38bdf8", l: "Domain" },
          { c: "#a78bfa", l: "Capability" },
          { c: "#94a3b8", l: "Entity" },
        ];
  return (
    <div className="p-3">
      <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {items.map((it) => (
          <div key={it.l} className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: it.c }} />
            {it.l}
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" className="h-7 flex-1 gap-1.5 text-[11px]" onClick={onResetView}>
          <Crosshair size={12} />
          Fit view
        </Button>
        <Button variant="outline" size="sm" className="h-7 flex-1 gap-1.5 text-[11px]" onClick={onAutoArrange}>
          <RotateCcw size={12} />
          Auto-arrange
        </Button>
      </div>
      <p className="mt-2 text-center text-[10px] text-muted-foreground/70">
        Hover to trace · click for details · drag to move
      </p>
    </div>
  );
}
