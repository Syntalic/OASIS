"use client";

/**
 * Focused neighborhood graphs for Coverage.
 * Opened from Browse via "Graph view"; in-graph clicks push a new focus
 * (wallet → services, service → endpoints) instead of leaving the canvas.
 */
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Building2, Plug, Wallet, X } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import {
  catalog,
  fmtUsd,
  hostOf,
  resolveCapHints,
  shortWallet,
  walletByKey,
  type CatalogEndpointRow,
} from "@/lib/catalog";
import { cn } from "@/lib/utils";

/** What the canvas is currently focused on. */
export type GraphFocus =
  | { kind: "wallet"; payTo: string }
  | { kind: "service"; origin: string }
  | { kind: "service-endpoints"; origin: string };

const MAX_NEIGHBORS = 20;
const MAX_ENDPOINTS = 24;

type SvcData = {
  kind: "service";
  host: string;
  origin: string;
  endpoints: number;
  volume_usd?: number;
  primary?: boolean;
};

type WalData = {
  kind: "wallet";
  payTo: string;
  chain: string;
  serviceCount: number;
  endpoints: number;
  volume_usd?: number;
  primary?: boolean;
};

type EpData = {
  kind: "endpoint";
  method: string;
  path: string;
  price_usd?: number;
  paid: boolean;
  hasWallet: boolean;
  /** e.g. "Data · Weather forecast" */
  ontology?: string;
  ontologyColor?: string;
  /** Full row for the detail popover */
  row?: CatalogEndpointRow;
  origin?: string;
  host?: string;
  selected?: boolean;
};

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="!opacity-0" />
    </>
  );
}

const ServiceNode = memo(function ServiceNode({ data, selected }: NodeProps) {
  const d = data as unknown as SvcData;
  return (
    <div>
      <Handles />
      <div
        className={cn(
          "w-[180px] rounded-xl border bg-card/95 px-2.5 py-2 shadow-sm",
          d.primary && "border-sky-400/80 ring-2 ring-sky-400/30",
          selected && !d.primary && "border-sky-300/50",
        )}
      >
        <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-sky-500">
          <Building2 size={11} /> Service
        </div>
        <div className="truncate text-[12px] font-semibold" title={d.origin}>
          {d.host}
        </div>
        <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
          {d.endpoints} eps
          {d.volume_usd ? ` · ${fmtUsd(d.volume_usd)}` : ""}
        </div>
        {!d.primary && (
          <div className="mt-1 text-[9px] text-sky-600 dark:text-sky-400">Click → endpoints</div>
        )}
      </div>
    </div>
  );
});

const WalletNode = memo(function WalletNode({ data, selected }: NodeProps) {
  const d = data as unknown as WalData;
  return (
    <div>
      <Handles />
      <div
        className={cn(
          "w-[200px] rounded-2xl border bg-card/95 px-3 py-2.5 shadow-md",
          d.primary && "border-amber-400/80 ring-2 ring-amber-400/30",
          selected && !d.primary && "border-amber-300/50",
        )}
      >
        <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
          <Wallet size={11} />
          {d.chain === "evm" ? "EVM wallet" : "Sol wallet"}
          {d.serviceCount > 1 && (
            <span className="rounded-full bg-amber-500/15 px-1.5 text-[9px]">×{d.serviceCount}</span>
          )}
        </div>
        <div className="mt-1 font-mono text-[12px] font-semibold" title={d.payTo}>
          {shortWallet(d.payTo, 5)}
        </div>
        <div className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground">
          {d.serviceCount} svc · {d.endpoints} eps
          {d.volume_usd ? ` · ${fmtUsd(d.volume_usd)}` : ""}
        </div>
        {!d.primary && (
          <div className="mt-1 text-[9px] text-amber-700 dark:text-amber-300">Click → services</div>
        )}
      </div>
    </div>
  );
});

const EndpointNode = memo(function EndpointNode({ data, selected }: NodeProps) {
  const d = data as unknown as EpData;
  const active = selected || d.selected;
  return (
    <div>
      <Handles />
      <div
        className={cn(
          "w-[228px] cursor-pointer rounded-lg border bg-card/95 px-2 py-1.5 shadow-sm transition",
          active && "border-primary/60 ring-2 ring-primary/25",
        )}
      >
        <div className="flex items-center gap-1.5">
          <Plug size={10} className="shrink-0 text-muted-foreground" />
          <span className="rounded bg-secondary px-1 font-mono text-[9px] font-bold">{d.method}</span>
          <span className="truncate font-mono text-[11px]" title={d.path}>
            {d.path}
          </span>
        </div>
        {d.ontology && (
          <div
            className="mt-0.5 truncate pl-4 text-[9.5px] font-medium"
            style={{ color: d.ontologyColor ?? undefined }}
            title={d.ontology}
          >
            {d.ontology}
          </div>
        )}
        <div className="mt-0.5 pl-4 font-mono text-[9.5px] text-muted-foreground">
          {d.price_usd != null ? `$${d.price_usd}` : d.paid ? "paid" : "free"}
          {d.hasWallet ? " · payTo" : ""}
        </div>
      </div>
    </div>
  );
});

const nodeTypes = { service: ServiceNode, wallet: WalletNode, endpoint: EndpointNode };

function edgeStyle(animated = false): Partial<Edge> {
  return {
    animated,
    style: { stroke: "oklch(0.75 0.12 75 / 0.55)", strokeWidth: 1.5 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 12,
      height: 12,
      color: "oklch(0.75 0.12 75 / 0.65)",
    },
  };
}

function layoutWallet(payToKey: string): { nodes: Node[]; edges: Edge[]; overflow: number; title: string } {
  const w = walletByKey.get(payToKey.toLowerCase());
  if (!w) return { nodes: [], edges: [], overflow: 0, title: "Wallet" };

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const hubId = `wallet:${w.payTo.toLowerCase()}`;
  nodes.push({
    id: hubId,
    type: "wallet",
    position: { x: 40, y: 40 },
    data: {
      kind: "wallet",
      payTo: w.payTo,
      chain: w.kind,
      serviceCount: w.serviceCount,
      endpoints: w.endpoints,
      volume_usd: w.volume_usd,
      primary: true,
    } satisfies WalData,
  });

  const origins = w.services.slice(0, MAX_NEIGHBORS);
  const overflow = Math.max(0, w.services.length - origins.length);
  const ROW = 96;
  origins.forEach((origin, i) => {
    const svc = catalog.services.find((s) => s.origin === origin);
    const sid = `svc:${origin}`;
    nodes.push({
      id: sid,
      type: "service",
      position: { x: 360, y: i * ROW },
      data: {
        kind: "service",
        host: svc?.host ?? hostOf(origin),
        origin,
        endpoints: svc?.endpoints ?? 0,
        volume_usd: svc?.volume_usd,
      } satisfies SvcData,
    });
    edges.push({ id: `e-${i}`, source: hubId, target: sid, ...edgeStyle() });
  });
  if (origins.length > 1) nodes[0]!.position = { x: 40, y: ((origins.length - 1) * ROW) / 2 };

  return {
    nodes,
    edges,
    overflow,
    title: `Wallet → services · ${shortWallet(w.payTo)}`,
  };
}

function layoutServiceWallets(origin: string): { nodes: Node[]; edges: Edge[]; overflow: number; title: string } {
  const svc = catalog.services.find((s) => s.origin === origin);
  if (!svc) return { nodes: [], edges: [], overflow: 0, title: "Service" };

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const sid = `svc:${origin}`;
  nodes.push({
    id: sid,
    type: "service",
    position: { x: 40, y: 40 },
    data: {
      kind: "service",
      host: svc.host,
      origin: svc.origin,
      endpoints: svc.endpoints,
      volume_usd: svc.volume_usd,
      primary: true,
    } satisfies SvcData,
  });

  const keys = svc.wallets.slice(0, MAX_NEIGHBORS);
  const overflow = Math.max(0, svc.wallets.length - keys.length);
  const ROW = 100;
  keys.forEach((k, i) => {
    const w = walletByKey.get(k);
    if (!w) return;
    const wid = `wallet:${k}`;
    nodes.push({
      id: wid,
      type: "wallet",
      position: { x: 340, y: i * ROW },
      data: {
        kind: "wallet",
        payTo: w.payTo,
        chain: w.kind,
        serviceCount: w.serviceCount,
        endpoints: w.endpoints,
        volume_usd: w.volume_usd,
      } satisfies WalData,
    });
    edges.push({ id: `e-${i}`, source: sid, target: wid, ...edgeStyle() });
  });
  if (keys.length > 1) nodes[0]!.position = { x: 40, y: ((keys.length - 1) * ROW) / 2 };

  return {
    nodes,
    edges,
    overflow,
    title: `Service → wallets · ${svc.host}`,
  };
}

function layoutServiceEndpoints(origin: string): {
  nodes: Node[];
  edges: Edge[];
  overflow: number;
  title: string;
} {
  const svc = catalog.services.find((s) => s.origin === origin);
  const rows: CatalogEndpointRow[] = catalog.endpoints_by_origin[origin] ?? [];
  if (!svc) return { nodes: [], edges: [], overflow: 0, title: "Endpoints" };

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const sid = `svc:${origin}`;
  nodes.push({
    id: sid,
    type: "service",
    position: { x: 40, y: 40 },
    data: {
      kind: "service",
      host: svc.host,
      origin: svc.origin,
      endpoints: svc.endpoints,
      volume_usd: svc.volume_usd,
      primary: true,
    } satisfies SvcData,
  });

  const shown = rows.slice(0, MAX_ENDPOINTS);
  const overflow = Math.max(0, rows.length - shown.length);
  const ROW = 64;
  // Two columns of endpoints if many
  const col = shown.length > 12 ? 2 : 1;
  const perCol = Math.ceil(shown.length / col);

  shown.forEach((r, i) => {
    const c = Math.floor(i / perCol);
    const row = i % perCol;
    const eid = `ep:${origin}:${r.method}:${r.path}:${i}`;
    const hints = resolveCapHints(r.capabilities, 1);
    const h0 = hints[0];
    nodes.push({
      id: eid,
      type: "endpoint",
      position: { x: 340 + c * 250, y: row * ROW },
      data: {
        kind: "endpoint",
        method: r.method,
        path: r.path,
        price_usd: r.price_usd,
        paid: r.paid,
        hasWallet: !!(r.payTos && r.payTos.length),
        ontology: h0 ? `${h0.domainLabel} · ${h0.label}` : undefined,
        ontologyColor: h0?.color,
        row: r,
        origin,
        host: svc.host,
      } satisfies EpData,
    });
    edges.push({ id: `e-ep-${i}`, source: sid, target: eid, ...edgeStyle(false) });
  });

  if (shown.length > 1) {
    nodes[0]!.position = { x: 40, y: (Math.min(shown.length, perCol) * ROW) / 2 - 20 };
  }

  return {
    nodes,
    edges,
    overflow,
    title: `Service → endpoints · ${svc.host} (${rows.length})`,
  };
}

function EndpointInfoCard({
  data,
  onClose,
}: {
  data: EpData;
  onClose: () => void;
}) {
  const hints = resolveCapHints(data.row?.capabilities, 3);
  const wallets = data.row?.payTos ?? [];
  return (
    <div className="absolute right-3 top-3 z-20 w-[min(320px,calc(100%-1.5rem))] rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Endpoint
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] font-bold">
              {data.method}
            </span>
            <span className="truncate font-mono text-[13px] font-semibold" title={data.path}>
              {data.path}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      {(data.host || data.origin) && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          <span className="text-foreground/80">{data.host ?? hostOf(data.origin!)}</span>
          {data.origin && (
            <a
              href={`${data.origin.replace(/\/$/, "")}${data.path}`}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block truncate font-mono text-[10px] hover:text-foreground hover:underline"
            >
              {data.origin}
              {data.path}
            </a>
          )}
        </div>
      )}

      {data.row?.summary && (
        <p className="mt-2 text-[12px] leading-snug text-foreground/90">{data.row.summary}</p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg border bg-secondary/30 px-2 py-1.5">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Price</div>
          <div className="mt-0.5 font-mono font-semibold tabular-nums">
            {data.price_usd != null ? `$${data.price_usd}` : data.paid ? "paid (dynamic)" : "free"}
          </div>
        </div>
        <div className="rounded-lg border bg-secondary/30 px-2 py-1.5">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Payment</div>
          <div className="mt-0.5 font-mono text-[11px]">
            {data.paid ? "paid" : "free"}
            {data.row?.verified ? ` · ${data.row.verified}` : ""}
          </div>
        </div>
      </div>

      <div className="mt-2">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Ontology</div>
        {hints.length ? (
          <div className="mt-1 space-y-1">
            {hints.map((h) => (
              <div key={h.id} className="flex items-center gap-1.5 text-[11px]">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: h.color }} />
                <span style={{ color: h.color }} className="font-medium">
                  {h.domainLabel}
                </span>
                <span className="text-muted-foreground">· {h.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-0.5 text-[11px] text-muted-foreground">Not bound to a curated capability</div>
        )}
      </div>

      {wallets.length > 0 && (
        <div className="mt-2">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Merchant wallets
          </div>
          <div className="mt-1 space-y-0.5">
            {wallets.map((w) => (
              <div key={w} className="truncate font-mono text-[10.5px]" title={w}>
                {shortWallet(w, 6)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function CoverageGraph({
  focus,
  onNavigate,
}: {
  focus: GraphFocus;
  /** In-graph navigation — stay on canvas, push a new focus. */
  onNavigate: (next: GraphFocus) => void;
}) {
  const [endpointInfo, setEndpointInfo] = useState<EpData | null>(null);

  const built = useMemo(() => {
    if (focus.kind === "wallet") return layoutWallet(focus.payTo);
    if (focus.kind === "service") return layoutServiceWallets(focus.origin);
    return layoutServiceEndpoints(focus.origin);
  }, [focus]);

  // Clear popover when navigating to a different graph
  useEffect(() => {
    setEndpointInfo(null);
  }, [focus]);

  const nodes = useMemo(() => {
    if (!endpointInfo) return built.nodes;
    return built.nodes.map((n) => {
      if (n.type !== "endpoint") return n;
      const d = n.data as EpData;
      const sel =
        d.method === endpointInfo.method &&
        d.path === endpointInfo.path &&
        d.origin === endpointInfo.origin;
      return { ...n, data: { ...d, selected: sel } };
    });
  }, [built.nodes, endpointInfo]);

  return (
    <div className="relative h-full w-full">
      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-lg rounded-lg border bg-card/90 px-3 py-2 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
        <div className="font-medium text-foreground">{built.title}</div>
        <div className="mt-0.5">
          {focus.kind === "wallet" && "Click a service to open its endpoint graph."}
          {focus.kind === "service" && "Click a wallet to see its services."}
          {focus.kind === "service-endpoints" &&
            `Click an endpoint for details · up to ${MAX_ENDPOINTS}${built.overflow ? ` · +${built.overflow} more in Browse` : ""}.`}
        </div>
      </div>

      {endpointInfo && (
        <EndpointInfoCard data={endpointInfo} onClose={() => setEndpointInfo(null)} />
      )}

      <ReactFlow
        nodes={nodes}
        edges={built.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        minZoom={0.25}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => {
          if (n.id.startsWith("ep:")) {
            setEndpointInfo(n.data as EpData);
            return;
          }
          setEndpointInfo(null);
          if (n.id.startsWith("svc:")) {
            const origin = n.id.slice(4);
            if (focus.kind === "wallet") {
              onNavigate({ kind: "service-endpoints", origin });
            } else if (focus.kind === "service") {
              onNavigate({ kind: "service-endpoints", origin });
            }
            // on endpoints graph, primary service click just clears popover
          } else if (n.id.startsWith("wallet:")) {
            const payTo = n.id.slice(7);
            if (focus.kind !== "wallet" || focus.payTo !== payTo) {
              onNavigate({ kind: "wallet", payTo });
            }
          }
        }}
        onPaneClick={() => setEndpointInfo(null)}
        nodesDraggable
        nodesConnectable={false}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
