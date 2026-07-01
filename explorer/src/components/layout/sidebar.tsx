"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  ChevronDown,
  Compass,
  CornerDownLeft,
  Layers3,
  Loader2,
  PanelLeftClose,
  Search,
  Sparkles,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { domainMeta, domains } from "@/lib/ontology";
import { findAtom } from "@/stores/ask";
import { focusDomainAtom, showEntitiesAtom } from "@/stores/options";
import { inputAtom, matchesAtom, modeAtom, queryAtom, searchingAtom } from "@/stores/query";
import { selectedIdAtom } from "@/stores/selection";
import { sidebarCollapsedAtom } from "@/stores/ui";
import type { FindEndpoint, Mode, NextStep } from "@/types/graph";

const SAMPLES = [
  // AI / media
  "Narrate an article as audio",
  "Transcribe audio to text",
  "Image from a text prompt",
  "Generate text embeddings",
  "Complete a chat prompt with an LLM",
  // data / reference
  "Enrich a company by domain",
  "Find a person's public profile",
  "Latest news headlines",
  "Live sports scores",
  "Look up NFT metadata",
  "Look up WHOIS for a domain",
  "Find a job listing",
  // validation
  "Validate an email address",
  "Validate a VAT number",
  "Check an IBAN bank account",
  // finance / compute
  "Convert USD to euros",
  "Real-time stock quotes",
  "Convert units & measurements",
  // web / search
  "Screenshot a webpage",
  "Search the web with citations",
  "Solve a CAPTCHA",
  // comms
  "Send a transactional SMS",
  "Place an AI phone call",
  "Send an email",
  // maps / misc
  "7-day weather forecast",
  "Geocode an address",
  "Translate text to Spanish",
  "Extract data from a PDF",
  "Find public holidays by country",
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

const SAMPLE_PREVIEW = 7;

function AskBody() {
  const [input, setInput] = useAtom(inputAtom);
  const setQuery = useSetAtom(queryAtom);
  const query = useAtomValue(queryAtom);
  const matches = useAtomValue(matchesAtom);
  const searching = useAtomValue(searchingAtom);
  const find = useAtomValue(findAtom);
  const [selectedId, setSelectedId] = useAtom(selectedIdAtom);
  const [showAllSamples, setShowAllSamples] = useState(false);

  const visibleSamples = showAllSamples ? SAMPLES : SAMPLES.slice(0, SAMPLE_PREVIEW);
  const hiddenCount = SAMPLES.length - SAMPLE_PREVIEW;

  const run = (q: string) => {
    setInput(q);
    setQuery(q);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2.5 p-3">
        <div className="flex items-center gap-1.5">
          <div className="flex flex-1 items-center gap-1.5 rounded-lg border bg-secondary/40 pl-2.5">
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
          <Button
            size="sm"
            className="h-9 w-9 shrink-0 p-0"
            disabled={!input.trim()}
            onClick={() => run(input)}
            aria-label="Search"
            title="Search"
          >
            <CornerDownLeft size={15} />
          </Button>
        </div>
        <div
          className={cn(
            "flex flex-wrap gap-1",
            showAllSamples && "max-h-[176px] overflow-y-auto pr-1",
          )}
        >
          {visibleSamples.map((q) => (
            <button
              key={q}
              onClick={() => run(q)}
              className="rounded-full border px-2 py-0.5 text-[10.5px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              {q}
            </button>
          ))}
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowAllSamples((s) => !s)}
              className="flex items-center gap-0.5 rounded-full border border-primary/40 px-2 py-0.5 text-[10.5px] font-medium text-primary transition hover:bg-primary/10"
            >
              {showAllSamples ? "Show less" : `+${hiddenCount} more`}
              <ChevronDown
                size={11}
                className={cn("transition-transform", showAllSamples && "rotate-180")}
              />
            </button>
          )}
        </div>
      </div>
      <Separator />
      {query ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="font-display flex items-center gap-1.5 px-3 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {searching ? (
              <>
                <Loader2 size={11} className="animate-spin" /> Binding…
              </>
            ) : (
              `${matches.length} ${matches.length === 1 ? "capability" : "capabilities"}`
            )}
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 p-2 pt-0">
              <div className="space-y-1">
                <CapabilityResults matches={matches} selectedId={selectedId} onSelect={setSelectedId} />
              </div>
              {find && find.endpoints.length > 0 && (
                <div className="space-y-1">
                  <SectionLabel>{find.endpoints.length} paid endpoints</SectionLabel>
                  <EndpointList endpoints={find.endpoints} />
                </div>
              )}
              {find && find.nextSteps.length > 0 && (
                <div className="space-y-1">
                  <SectionLabel>Next steps</SectionLabel>
                  <NextStepList steps={find.nextSteps} selectedId={selectedId} onSelect={setSelectedId} />
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Ask a question to see the capabilities it connects to.
          </p>
        </div>
      )}
    </div>
  );
}

/** Shared "+N more / Show less" expander used by the sidebar lists. */
function ExpandToggle({ open, hidden, onClick }: { open: boolean; hidden: number; onClick: () => void }) {
  if (hidden <= 0) return null;
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center gap-0.5 rounded-md px-2 py-1 text-[10.5px] font-medium text-primary transition hover:bg-primary/10"
    >
      {open ? "Show less" : `+${hidden} more`}
      <ChevronDown size={11} className={cn("transition-transform", open && "rotate-180")} />
    </button>
  );
}

function CapabilityResults({
  matches,
  selectedId,
  onSelect,
}: {
  matches: import("@/lib/ontology").MatchResult[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const PREVIEW = 6;
  const list = open ? matches : matches.slice(0, PREVIEW);
  return (
    <>
      {list.map((m, i) => {
        const meta = domainMeta(m.capability.domain);
        const sel = selectedId === m.capability.id;
        return (
          <button
            key={m.capability.id}
            onClick={() => onSelect(m.capability.id)}
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
              <span className="flex-1 truncate text-[12.5px] font-medium text-foreground">{m.capability.label}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 pl-7 font-mono text-[10px] tabular-nums text-muted-foreground">
              <span style={{ color: meta.color }}>{Math.round(m.strength * 100)}% match</span>
              <span className="text-border">·</span>
              <span>{m.capability.endpointCount} endpoints</span>
            </div>
          </button>
        );
      })}
      <ExpandToggle open={open} hidden={matches.length - PREVIEW} onClick={() => setOpen((s) => !s)} />
    </>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-display px-1 pt-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
      {children}
    </div>
  );
}

function hostOf(u: string) {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
function pathOf(u: string) {
  try {
    return new URL(u).pathname;
  } catch {
    return "";
  }
}

/** Real paid endpoints from oasis_discover — flat (via:"arm", no per-capability grouping). */
function EndpointList({ endpoints }: { endpoints: FindEndpoint[] }) {
  const [open, setOpen] = useState(false);
  const PREVIEW = 6;
  const list = open ? endpoints : endpoints.slice(0, PREVIEW);
  return (
    <>
      {list.map((ep, i) => {
        const host = hostOf(ep.url);
        const path = pathOf(ep.url);
        return (
          <div key={`${host}${path}:${i}`} className="rounded-lg border px-2.5 py-1.5">
            <div className="flex items-center gap-1.5 font-mono text-[11px]">
              <span className="rounded bg-secondary px-1 text-[8px] font-bold text-foreground/70">{ep.method}</span>
              <span className="flex-1 truncate text-foreground/85">
                {host}
                <span className="text-muted-foreground">{path}</span>
              </span>
              {ep.price_usd != null && (
                <span className="shrink-0 font-mono font-semibold text-foreground">${ep.price_usd}</span>
              )}
            </div>
            {ep.summary && <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{ep.summary}</div>}
            {ep.rails?.length ? (
              <div className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">{ep.rails.join(" · ")}</div>
            ) : null}
          </div>
        );
      })}
      <ExpandToggle open={open} hidden={endpoints.length - PREVIEW} onClick={() => setOpen((s) => !s)} />
    </>
  );
}

/** Chain-to capabilities from oasis_discover.next_steps (click selects the graph node). */
function NextStepList({
  steps,
  selectedId,
  onSelect,
}: {
  steps: NextStep[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const PREVIEW = 4;
  const list = open ? steps : steps.slice(0, PREVIEW);
  return (
    <>
      {list.map((ns) => {
        const sel = selectedId === ns.intent_id;
        return (
          <button
            key={ns.intent_id}
            onClick={() => onSelect(ns.intent_id)}
            className={cn(
              "w-full rounded-lg border border-dashed px-2.5 py-1.5 text-left transition",
              sel ? "bg-accent" : "hover:bg-accent/50",
            )}
          >
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#5eead4" }} />
              {ns.do}
            </div>
            <div className="mt-0.5 pl-3 text-[10px] italic text-muted-foreground">{ns.why}</div>
          </button>
        );
      })}
      <ExpandToggle open={open} hidden={steps.length - PREVIEW} onClick={() => setOpen((s) => !s)} />
    </>
  );
}

