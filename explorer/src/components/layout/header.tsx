"use client";

import { Code2, Network } from "lucide-react";

import { ThemeToggle } from "@/features/theme/theme-toggle";
import { ontology } from "@/lib/ontology";

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span>
      <span className="font-mono font-semibold tabular-nums text-foreground">{n.toLocaleString()}</span>{" "}
      {label}
    </span>
  );
}

export function Header() {
  const s = ontology.stats;
  return (
    <header className="z-30 flex shrink-0 items-center justify-between gap-4 border-b bg-card/60 px-4 py-2 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/40">
          <Network size={16} className="text-primary" />
        </div>
        <div className="font-display text-[14px] font-bold leading-none tracking-tight">
          OASIS<span className="ml-1.5 font-normal text-muted-foreground">Atlas</span>
        </div>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          · discovery for paid x402 / MPP APIs
        </span>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="hidden items-center gap-3 md:flex">
          <Stat n={s.capabilities} label="capabilities" />
          <span className="text-border">·</span>
          <Stat n={s.entities} label="entities" />
          <span className="text-border">·</span>
          <Stat n={s.boundEndpoints} label="paid endpoints" />
        </span>
        <ThemeToggle />
        <a
          href="https://github.com/Syntalic/OASIS"
          target="_blank"
          rel="noreferrer"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md border transition hover:bg-accent"
          title="OASIS on GitHub"
        >
          <Code2 size={14} />
        </a>
      </div>
    </header>
  );
}
