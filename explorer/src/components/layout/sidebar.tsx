"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Compass, CornerDownLeft, Layers3, PanelLeftClose, Search, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { domainMeta, domains } from "@/lib/ontology";
import { focusDomainAtom, showEntitiesAtom } from "@/stores/options";
import { inputAtom, matchesAtom, modeAtom, queryAtom } from "@/stores/query";
import { selectedIdAtom } from "@/stores/selection";
import { sidebarCollapsedAtom } from "@/stores/ui";
import type { Mode } from "@/types/graph";

const SAMPLES = [
  "Narrate an article as audio",
  "Convert USD to euros",
  "Screenshot a webpage",
  "Enrich a company by domain",
  "Image from a text prompt",
  "Send a transactional SMS",
  "7-day weather forecast",
  "Extract data from a PDF",
];

export function Sidebar() {
  const [mode, setMode] = useAtom(modeAtom);
  const setCollapsed = useSetAtom(sidebarCollapsedAtom);

  const onMode = (m: Mode) => setMode(m);

  return (
    <aside className="flex h-full min-h-0 flex-col bg-card/40">
      <div className="flex items-center gap-2 p-2.5">
        <div className="flex flex-1 items-center gap-0.5 rounded-lg border bg-background/60 p-0.5">
          <ModeTab icon={<Compass size={14} />} label="Explore" active={mode === "explore"} onClick={() => onMode("explore")} />
          <ModeTab icon={<Sparkles size={14} />} label="Ask" active={mode === "ask"} onClick={() => onMode("ask")} />
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Collapse panel" onClick={() => setCollapsed(true)}>
          <PanelLeftClose size={15} />
        </Button>
      </div>
      <Separator />
      {mode === "ask" ? <AskBody /> : <ExploreBody />}
    </aside>
  );
}

function ModeTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition",
        active ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */

function ExploreBody() {
  const [showEntities, setShowEntities] = useAtom(showEntitiesAtom);
  const [focusDomain, setFocusDomain] = useAtom(focusDomainAtom);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-4 p-3">
        <label className="flex items-center justify-between gap-2 rounded-lg border bg-secondary/40 px-3 py-2">
          <span className="flex items-center gap-2 text-[12.5px] font-medium">
            <Layers3 size={14} className="text-muted-foreground" /> Entity flow
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
              color="var(--muted-foreground)"
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

function AskBody() {
  const [input, setInput] = useAtom(inputAtom);
  const setQuery = useSetAtom(queryAtom);
  const query = useAtomValue(queryAtom);
  const matches = useAtomValue(matchesAtom);
  const [selectedId, setSelectedId] = useAtom(selectedIdAtom);

  const run = (q: string) => {
    setInput(q);
    setQuery(q);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2.5 p-3">
        <div className="flex items-center gap-1.5 rounded-lg border bg-secondary/40 pl-2.5">
          <Search size={15} className="shrink-0 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) run(input);
            }}
            placeholder="Describe a task…"
            className="h-9 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
        <Button size="sm" className="h-8 w-full gap-1.5" disabled={!input.trim()} onClick={() => run(input)}>
          Trace connections <CornerDownLeft size={13} />
        </Button>
        <div className="flex flex-wrap gap-1">
          {SAMPLES.map((q) => (
            <button
              key={q}
              onClick={() => run(q)}
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
          <div className="font-display px-3 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {matches.length} match{matches.length === 1 ? "" : "es"}
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1 p-2 pt-0">
              {matches.map((m, i) => {
                const meta = domainMeta(m.capability.domain);
                const sel = selectedId === m.capability.id;
                return (
                  <button
                    key={m.capability.id}
                    onClick={() => setSelectedId(m.capability.id)}
                    className={cn(
                      "w-full rounded-lg border px-2.5 py-2 text-left transition",
                      sel ? "border-primary/50 bg-accent" : "hover:bg-accent/50",
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
                        <div className="h-full rounded-full" style={{ width: `${Math.round(m.strength * 100)}%`, background: meta.color }} />
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
