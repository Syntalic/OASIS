"use client";

import { useEffect, useMemo, useState } from "react";
import { Compass, Sparkles, Network, Code2, PanelLeftOpen } from "lucide-react";
import { OntologyFlow } from "@/components/OntologyFlow";
import { DetailPanel } from "@/components/DetailPanel";
import { ControlSidebar, type Mode } from "@/components/ControlSidebar";
import { buildOverview, buildQuestion, type GraphModel } from "@/lib/graph";
import { matchCapabilities, ontology } from "@/lib/ontology";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Home() {
  const [mode, setMode] = useState<Mode>("explore");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [showEntities, setShowEntities] = useState(true);
  const [focusDomain, setFocusDomain] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // imperative signals to the canvas
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [relayoutNonce, setRelayoutNonce] = useState(0);

  const matches = useMemo(
    () => (mode === "ask" && query ? matchCapabilities(query) : []),
    [mode, query],
  );

  const model: GraphModel = useMemo(() => {
    if (mode === "ask" && query && matches.length > 0) {
      return buildQuestion(query, matches);
    }
    return buildOverview({ showEntities, focusDomain });
  }, [mode, query, matches, showEntities, focusDomain]);

  const fitKey = `${mode}|${query}|${showEntities}|${focusDomain}|${matches.length}`;

  useEffect(() => {
    const id = requestAnimationFrame(() => setSelectedId(null));
    return () => cancelAnimationFrame(id);
  }, [fitKey]);

  function runQuery(q: string) {
    setInput(q);
    setQuery(q);
    setMode("ask");
  }

  function selectResult(id: string) {
    setSelectedId(id);
    setFocus({ id, nonce: Date.now() });
  }

  const hasAsked = mode === "ask" && query.length > 0;
  const noMatches = hasAsked && matches.length === 0;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <Header
        stats={ontology.stats}
        mode={mode}
        onMode={(m) => {
          setMode(m);
          setSelectedId(null);
          setCollapsed(false); // switching task always reveals its controls
        }}
      />

      <div className="flex min-h-0 flex-1">
        <ControlSidebar
          mode={mode}
          collapsed={collapsed}
          onCollapse={() => setCollapsed((c) => !c)}
          onResetView={() => setResetNonce((n) => n + 1)}
          onAutoArrange={() => setRelayoutNonce((n) => n + 1)}
          showEntities={showEntities}
          setShowEntities={setShowEntities}
          focusDomain={focusDomain}
          setFocusDomain={setFocusDomain}
          input={input}
          setInput={setInput}
          onSubmit={() => runQuery(input)}
          onPick={runQuery}
          query={query}
          matches={matches}
          selectedId={selectedId}
          onSelectResult={selectResult}
        />

        <main className="oasis-atmosphere relative min-w-0 flex-1 overflow-hidden">
          {collapsed && (
            <Button
              variant="outline"
              size="icon"
              className="absolute left-3 top-3 z-30 h-8 w-8 bg-card/80 backdrop-blur"
              onClick={() => setCollapsed(false)}
              title="Show controls"
            >
              <PanelLeftOpen size={15} />
            </Button>
          )}

          {noMatches ? (
            <EmptyMatches query={query} />
          ) : (
            <OntologyFlow
              model={model}
              selectedId={selectedId}
              onSelect={setSelectedId}
              fitKey={fitKey}
              focus={focus}
              resetNonce={resetNonce}
              relayoutNonce={relayoutNonce}
            />
          )}

          <DetailPanel
            selectedId={selectedId}
            onClose={() => setSelectedId(null)}
            onNavigate={selectResult}
          />
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Header({
  stats,
  mode,
  onMode,
}: {
  stats: typeof ontology.stats;
  mode: Mode;
  onMode: (m: Mode) => void;
}) {
  return (
    <header className="z-30 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b bg-card/60 px-4 py-2.5 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/40">
          <Network size={17} className="text-primary" />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="font-display text-[15px] font-bold tracking-tight">
            OASIS<span className="ml-1.5 font-normal text-muted-foreground">Atlas</span>
          </div>
          <div className="truncate text-[10.5px] text-muted-foreground">
            Discovery layer for paid x402 / MPP APIs
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 justify-self-center rounded-lg border bg-background/60 p-0.5">
        <ModeButton icon={<Compass size={14} />} label="Explore" active={mode === "explore"} onClick={() => onMode("explore")} />
        <ModeButton icon={<Sparkles size={14} />} label="Ask a question" active={mode === "ask"} onClick={() => onMode("ask")} />
      </div>

      <div className="hidden items-center gap-3 justify-self-end text-[11px] text-muted-foreground lg:flex">
        <Stat n={stats.domains} label="domains" />
        <span className="text-border">/</span>
        <Stat n={stats.capabilities} label="capabilities" />
        <span className="text-border">/</span>
        <Stat n={stats.entities} label="entities" />
        <span className="text-border">/</span>
        <Stat n={stats.boundEndpoints} label="bound endpoints" />
        <a
          href="https://github.com/Syntalic/OASIS"
          target="_blank"
          rel="noreferrer"
          className="ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-md border transition hover:bg-accent"
          title="OASIS on GitHub"
        >
          <Code2 size={14} />
        </a>
      </div>
    </header>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span>
      <span className="font-mono font-semibold tabular-nums text-foreground">{n.toLocaleString()}</span>{" "}
      {label}
    </span>
  );
}

function ModeButton({
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
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
        active ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyMatches({ query }: { query: string }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-muted">
          <Sparkles className="text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">No capabilities matched “{query}”.</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Try describing the task differently — mention the data you have or the output you want.
        </p>
      </div>
    </div>
  );
}
