"use client";

import { ReactFlowProvider } from "@xyflow/react";
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  ChevronRight,
  Network,
  Search,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { CoverageGraph, type GraphFocus } from "@/components/coverage/coverage-graph";
import { ThemeToggle } from "@/features/theme/theme-toggle";
import {
  catalog,
  domainSummary,
  fmtUsd,
  hostOf,
  resolveCapHints,
  serviceByOrigin,
  shortWallet,
  walletByKey,
  type CatalogEndpointRow,
  type CatalogService,
  type CatalogWallet,
} from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type Tab = "services" | "wallets";
type Selection =
  | { kind: "service"; origin: string }
  | { kind: "wallet"; payTo: string }
  | null;

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card/70 px-2.5 py-1.5">
      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-[15px] font-semibold tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

function FunnelMini() {
  const max = Math.max(...catalog.funnel.map((s) => s.count), 1);
  return (
    <div className="space-y-1.5">
      {catalog.funnel.map((step) => (
        <div key={step.id} className="flex items-center gap-2 text-[11px]">
          <div className="w-[7.5rem] shrink-0 truncate text-muted-foreground" title={step.hint}>
            {step.label}
          </div>
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500/80 to-amber-500/80"
              style={{ width: `${Math.max(4, (step.count / max) * 100)}%` }}
            />
          </div>
          <div className="w-14 shrink-0 text-right font-mono tabular-nums text-foreground">
            {step.count.toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

function OntologyHints({ ids }: { ids?: string[] }) {
  const hints = resolveCapHints(ids, 2);
  if (!hints.length) {
    return <span className="text-[10px] text-muted-foreground/60">—</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {hints.map((h) => (
        <div key={h.id} className="flex items-center gap-1 min-w-0">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: h.color }}
            title={h.domainLabel}
          />
          <span className="truncate text-[10px]" style={{ color: h.color }} title={h.id}>
            <span className="font-medium">{h.domainLabel}</span>
            <span className="text-muted-foreground"> · {h.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function EndpointTable({ rows }: { rows: CatalogEndpointRow[] }) {
  const [open, setOpen] = useState(false);
  const PREVIEW = 12;
  const list = open ? rows : rows.slice(0, PREVIEW);
  const domains = useMemo(() => domainSummary(rows, 5), [rows]);
  const bound = useMemo(() => rows.filter((r) => (r.capabilities?.length ?? 0) > 0).length, [rows]);

  if (!rows.length) {
    return <p className="text-[12px] text-muted-foreground">No endpoints in catalog for this selection.</p>;
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Endpoints ({rows.length.toLocaleString()}
          {bound > 0 ? ` · ${bound} ontology-bound` : ""})
        </div>
        {domains.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {domains.map((d) => (
              <span
                key={d.domain}
                className="rounded-full border px-1.5 py-0.5 text-[9.5px] font-medium tabular-nums"
                style={{
                  borderColor: `color-mix(in oklab, ${d.color} 45%, transparent)`,
                  color: d.color,
                  background: `color-mix(in oklab, ${d.color} 12%, transparent)`,
                }}
                title={`${d.n} bound endpoint hits in ${d.label}`}
              >
                {d.label} {d.n}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-left text-[11.5px]">
          <thead className="bg-secondary/50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Method</th>
              <th className="px-2 py-1.5 font-medium">Path</th>
              <th className="px-2 py-1.5 font-medium">Ontology</th>
              <th className="px-2 py-1.5 font-medium">Price</th>
              <th className="px-2 py-1.5 font-medium">Wallets</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={`${r.method}${r.path}${i}`} className="border-t">
                <td className="px-2 py-1 align-top">
                  <span className="rounded bg-secondary px-1 font-mono text-[10px] font-bold">{r.method}</span>
                </td>
                <td className="px-2 py-1 align-top">
                  <div className="font-mono text-foreground/90">{r.path}</div>
                  {r.summary && <div className="mt-0.5 text-[10px] text-muted-foreground">{r.summary}</div>}
                </td>
                <td className="px-2 py-1 align-top">
                  <OntologyHints ids={r.capabilities} />
                </td>
                <td className="px-2 py-1 align-top font-mono tabular-nums text-muted-foreground">
                  {r.price_usd != null ? `$${r.price_usd}` : r.paid ? "paid" : "free"}
                </td>
                <td className="px-2 py-1 align-top font-mono text-[10px] text-muted-foreground">
                  {r.payTos?.length ? r.payTos.map((p) => shortWallet(p, 4)).join(", ") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
        >
          {open ? (
            <>
              <ChevronDown size={12} /> Show less
            </>
          ) : (
            <>
              <ChevronRight size={12} /> Show all {rows.length.toLocaleString()} endpoints
            </>
          )}
        </button>
      )}
    </div>
  );
}

function GraphViewButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onClick} disabled={disabled}>
      <Network size={14} />
      Graph view
    </Button>
  );
}

function ServiceDetail({
  svc,
  onSelectWallet,
  onGraphView,
}: {
  svc: CatalogService;
  onSelectWallet: (k: string) => void;
  onGraphView: () => void;
}) {
  const endpoints = catalog.endpoints_by_origin[svc.origin] ?? [];
  const wallets = svc.wallets.map((k) => walletByKey.get(k)).filter(Boolean) as CatalogWallet[];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-sky-500">
            <Building2 size={12} /> Service
          </div>
          <h2 className="mt-0.5 font-display text-[16px] font-semibold tracking-tight">{svc.host}</h2>
          <a
            href={svc.origin}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
          >
            {svc.origin}
          </a>
        </div>
        <div className="flex flex-wrap gap-2">
          <GraphViewButton onClick={onGraphView} disabled={svc.walletCount === 0 && endpoints.length === 0} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatPill label="Endpoints" value={svc.endpoints} />
        <StatPill label="With payTo" value={svc.withPayTo} />
        <StatPill label="Wallets" value={svc.walletCount} />
        <StatPill label="Volume" value={fmtUsd(svc.volume_usd)} />
      </div>

      <div>
        <div className="font-display mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Wallets used by this service
        </div>
        {wallets.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No merchant wallet in the index for this host yet.</p>
        ) : (
          <div className="space-y-1">
            {wallets.map((w) => (
              <button
                key={w.payTo}
                type="button"
                onClick={() => onSelectWallet(w.payTo.toLowerCase())}
                className="flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition hover:bg-accent/50"
              >
                <div>
                  <div className="font-mono text-[12px] font-medium">{shortWallet(w.payTo)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {w.kind} · {w.serviceCount} service{w.serviceCount === 1 ? "" : "s"} · {w.endpoints} eps
                  </div>
                </div>
                <div className="shrink-0 font-mono text-[12px] font-semibold text-amber-600 dark:text-amber-400">
                  {fmtUsd(w.volume_usd)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <EndpointTable rows={endpoints} />
    </div>
  );
}

function WalletDetail({
  wallet,
  onSelectService,
  onGraphView,
}: {
  wallet: CatalogWallet;
  onSelectService: (origin: string) => void;
  onGraphView: () => void;
}) {
  const key = wallet.payTo.toLowerCase();
  const endpoints = useMemo(() => {
    const out: CatalogEndpointRow[] = [];
    for (const origin of wallet.services) {
      for (const row of catalog.endpoints_by_origin[origin] ?? []) {
        if (row.payTos?.includes(key)) out.push(row);
      }
    }
    return out;
  }, [wallet, key]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            <Wallet size={12} /> Merchant wallet
          </div>
          <h2 className="mt-0.5 break-all font-mono text-[14px] font-semibold tracking-tight">{wallet.payTo}</h2>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {wallet.kind}
            {wallet.stage ? ` · stage ${wallet.stage}` : ""}
            {wallet.source ? ` · ${wallet.source}` : ""}
          </div>
        </div>
        <GraphViewButton onClick={onGraphView} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatPill label="Services" value={wallet.serviceCount} />
        <StatPill label="Endpoints" value={wallet.endpoints} />
        <StatPill label="Volume" value={fmtUsd(wallet.volume_usd)} />
        <StatPill label="Txs" value={wallet.transactions?.toLocaleString() ?? "—"} />
      </div>

      <div>
        <div className="font-display mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Services using this wallet
        </div>
        <div className="space-y-1">
          {wallet.services.map((origin) => {
            const svc = serviceByOrigin.get(origin);
            return (
              <button
                key={origin}
                type="button"
                onClick={() => onSelectService(origin)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition hover:bg-accent/50"
              >
                <div>
                  <div className="text-[12.5px] font-medium">{svc?.host ?? hostOf(origin)}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {svc ? `${svc.endpoints} eps · ${svc.withPayTo} w/ payTo` : origin}
                  </div>
                </div>
                <div className="shrink-0 font-mono text-[11px] text-muted-foreground">{fmtUsd(svc?.volume_usd)}</div>
              </button>
            );
          })}
        </div>
      </div>

      <EndpointTable rows={endpoints} />
    </div>
  );
}

function focusLabel(f: GraphFocus): string {
  if (f.kind === "wallet") return `Wallet · ${shortWallet(f.payTo)}`;
  if (f.kind === "service") return `Service · ${hostOf(f.origin)}`;
  return `Endpoints · ${hostOf(f.origin)}`;
}

export function CoveragePage() {
  const s = catalog.stats;
  const [tab, setTab] = useState<Tab>("services");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Selection>(null);
  const [onlyWithWallet, setOnlyWithWallet] = useState(true);
  /** Stack of graph focuses; empty = details mode. */
  const [graphStack, setGraphStack] = useState<GraphFocus[]>([]);

  const services = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return catalog.services.filter((svc) => {
      if (onlyWithWallet && svc.walletCount === 0) return false;
      if (!qq) return true;
      return (
        svc.host.toLowerCase().includes(qq) ||
        svc.origin.toLowerCase().includes(qq) ||
        svc.wallets.some((w) => w.includes(qq))
      );
    });
  }, [q, onlyWithWallet]);

  const wallets = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return catalog.wallets.filter((w) => {
      if (!qq) return true;
      return (
        w.payTo.toLowerCase().includes(qq) ||
        w.services.some((o) => o.toLowerCase().includes(qq) || hostOf(o).toLowerCase().includes(qq))
      );
    });
  }, [q]);

  const selectedService = sel?.kind === "service" ? serviceByOrigin.get(sel.origin) : undefined;
  const selectedWallet = sel?.kind === "wallet" ? walletByKey.get(sel.payTo) : undefined;
  const graphFocus = graphStack.length ? graphStack[graphStack.length - 1]! : null;

  const selectService = (origin: string) => {
    setTab("services");
    setSel({ kind: "service", origin });
    setGraphStack([]);
  };
  const selectWallet = (payTo: string) => {
    setTab("wallets");
    setSel({ kind: "wallet", payTo });
    setGraphStack([]);
  };

  const openGraph = (focus: GraphFocus) => setGraphStack([focus]);
  const pushGraph = (focus: GraphFocus) => setGraphStack((s) => [...s, focus]);
  const graphBack = () => {
    setGraphStack((s) => {
      if (s.length <= 1) return [];
      return s.slice(0, -1);
    });
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden">
      <header className="z-30 flex shrink-0 items-center justify-between gap-4 border-b bg-card/60 px-4 py-2 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/40">
            <Network size={16} className="text-primary" />
          </div>
          <div className="font-display text-[14px] font-bold leading-none tracking-tight">
            OASIS<span className="ml-1.5 font-normal text-muted-foreground">Atlas</span>
          </div>
          <nav className="ml-1 flex items-center gap-1 rounded-lg border bg-background/50 p-0.5 text-[12px]">
            <Link href="/" className="rounded-md px-2.5 py-1 text-muted-foreground transition hover:text-foreground">
              Ontology
            </Link>
            <Link
              href="/coverage"
              className="rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground shadow"
            >
              Coverage
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="hidden sm:inline">
            Catalog map · not ontology ·{" "}
            {catalog.built_at ? new Date(catalog.built_at).toLocaleDateString() : "—"}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[380px] max-w-[48vw] shrink-0 flex-col border-r bg-card/25">
          <div className="space-y-3 border-b p-3">
            <div>
              <h1 className="font-display text-[15px] font-semibold">Coverage</h1>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                Browse services and wallets. On a detail page,{" "}
                <strong className="text-foreground">Graph view</strong> opens a neighborhood; click a
                service in the graph to open its <strong className="text-foreground">endpoints</strong>.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <StatPill label="Endpoints" value={s.endpoints} />
              <StatPill label="Services" value={s.origins} />
              <StatPill label="Wallets" value={s.unique_wallets} />
            </div>
            <FunnelMini />
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={tab === "services" ? "Filter services…" : "Filter wallets…"}
                className="h-9 pl-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg border bg-background/60 p-0.5">
              <button
                type="button"
                onClick={() => setTab("services")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-[12px] font-medium",
                  tab === "services" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                <Building2 size={13} /> Services
              </button>
              <button
                type="button"
                onClick={() => setTab("wallets")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-[12px] font-medium",
                  tab === "wallets" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                <Wallet size={13} /> Wallets
              </button>
            </div>
            {tab === "services" && (
              <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={onlyWithWallet}
                  onChange={(e) => setOnlyWithWallet(e.target.checked)}
                  className="rounded border"
                />
                Only with merchant wallet ({s.services_with_wallet.toLocaleString()})
              </label>
            )}
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-0.5 p-2">
              {tab === "services"
                ? services.map((svc) => {
                    const active = sel?.kind === "service" && sel.origin === svc.origin;
                    return (
                      <button
                        key={svc.origin}
                        type="button"
                        onClick={() => selectService(svc.origin)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition",
                          active ? "bg-accent" : "hover:bg-accent/50",
                        )}
                      >
                        <Building2 size={14} className="mt-0.5 shrink-0 text-sky-500" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] font-medium">{svc.host}</div>
                          <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                            {svc.endpoints} eps · {svc.walletCount} wallet
                            {svc.walletCount === 1 ? "" : "s"}
                            {svc.volume_usd ? ` · ${fmtUsd(svc.volume_usd)}` : ""}
                          </div>
                        </div>
                      </button>
                    );
                  })
                : wallets.map((w) => {
                    const active = sel?.kind === "wallet" && sel.payTo === w.payTo.toLowerCase();
                    return (
                      <button
                        key={w.payTo}
                        type="button"
                        onClick={() => selectWallet(w.payTo.toLowerCase())}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition",
                          active ? "bg-accent" : "hover:bg-accent/50",
                        )}
                      >
                        <Wallet size={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[12px] font-medium" title={w.payTo}>
                            {shortWallet(w.payTo)}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                            {w.serviceCount} svc · {w.endpoints} eps · {fmtUsd(w.volume_usd)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
              {tab === "services" && services.length === 0 && (
                <p className="p-3 text-center text-[12px] text-muted-foreground">No services match.</p>
              )}
              {tab === "wallets" && wallets.length === 0 && (
                <p className="p-3 text-center text-[12px] text-muted-foreground">No wallets match.</p>
              )}
            </div>
          </ScrollArea>
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden">
          {graphFocus ? (
            <div className="oasis-atmosphere relative flex h-full flex-col">
              <div className="z-10 flex shrink-0 flex-wrap items-center gap-2 border-b bg-card/80 px-3 py-2 backdrop-blur">
                <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={graphBack}>
                  <ArrowLeft size={14} />
                  {graphStack.length > 1 ? "Previous graph" : "Back to details"}
                </Button>
                <span className="text-[12px] text-muted-foreground">{focusLabel(graphFocus)}</span>
                {graphStack.length > 1 && (
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    depth {graphStack.length}
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1">
                <ReactFlowProvider>
                  <CoverageGraph focus={graphFocus} onNavigate={pushGraph} />
                </ReactFlowProvider>
              </div>
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="mx-auto max-w-3xl p-5">
                {!sel && (
                  <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
                    <div className="max-w-md space-y-2">
                      <h2 className="font-display text-[16px] font-semibold">Pick a service or wallet</h2>
                      <p className="text-[13px] leading-relaxed text-muted-foreground">
                        Open a row for the catalog map. Use <strong className="text-foreground">Graph view</strong>,
                        then click a service in the graph to fan out its endpoints — without leaving the canvas.
                      </p>
                    </div>
                  </div>
                )}
                {selectedService && (
                  <ServiceDetail
                    svc={selectedService}
                    onSelectWallet={selectWallet}
                    onGraphView={() =>
                      openGraph(
                        selectedService.walletCount > 0
                          ? { kind: "service", origin: selectedService.origin }
                          : { kind: "service-endpoints", origin: selectedService.origin },
                      )
                    }
                  />
                )}
                {selectedWallet && (
                  <WalletDetail
                    wallet={selectedWallet}
                    onSelectService={selectService}
                    onGraphView={() =>
                      openGraph({ kind: "wallet", payTo: selectedWallet.payTo.toLowerCase() })
                    }
                  />
                )}
              </div>
            </ScrollArea>
          )}
        </main>
      </div>
    </div>
  );
}
