"use client";

import { Network } from "lucide-react";

import { ThemeToggle } from "@/features/theme/theme-toggle";
import { ontology } from "@/lib/ontology";

function GitHubMark({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.06-.02-2.08-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.12-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.18.77.84 1.24 1.92 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
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
          <GitHubMark />
        </a>
      </div>
    </header>
  );
}
