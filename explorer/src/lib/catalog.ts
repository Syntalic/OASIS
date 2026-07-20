import raw from "@/data/catalog.json";
import { capById, domainMeta } from "@/lib/ontology";

export interface CatalogFunnelStep {
  id: string;
  label: string;
  count: number;
  hint: string;
}

export interface CatalogService {
  origin: string;
  host: string;
  endpoints: number;
  paid: number;
  free: number;
  withPayTo: number;
  withoutPayTo: number;
  walletCount: number;
  /** lowercased payTo keys */
  wallets: string[];
  volume_usd?: number;
  usage_active?: boolean;
  usage_stage?: string | null;
}

export interface CatalogWallet {
  payTo: string;
  kind: string;
  endpoints: number;
  serviceCount: number;
  services: string[];
  volume_usd?: number;
  transactions?: number;
  unique_buyers?: number;
  active?: boolean;
  stage?: string | null;
  source?: string | null;
}

export interface CatalogEndpointRow {
  method: string;
  path: string;
  paid: boolean;
  price_usd?: number;
  summary?: string;
  /** lowercased payTo keys on this endpoint */
  payTos?: string[];
  capabilities?: string[];
  verified?: string;
}

export interface CatalogData {
  built_at: string;
  stats: {
    endpoints: number;
    origins: number;
    paid_endpoints: number;
    free_or_unpaid_endpoints: number;
    endpoints_with_payto: number;
    endpoints_without_payto: number;
    services_with_wallet: number;
    services_without_wallet: number;
    unique_wallets: number;
    wallets_active: number;
    multi_service_wallets: number;
    multi_wallet_services: number;
    endpoints_usage_active: number;
    endpoints_usage_volume: number;
    endpoints_with_volume_usd: number;
  };
  funnel: CatalogFunnelStep[];
  services: CatalogService[];
  wallets: CatalogWallet[];
  endpoints_by_origin: Record<string, CatalogEndpointRow[]>;
}

export const catalog = raw as unknown as CatalogData;

/** payTo lower → wallet row */
export const walletByKey = new Map(
  catalog.wallets.map((w) => [w.payTo.toLowerCase(), w] as const),
);

/** origin → service row */
export const serviceByOrigin = new Map(catalog.services.map((s) => [s.origin, s] as const));

export function shortWallet(addr: string, n = 6): string {
  if (!addr) return "";
  if (addr.length <= n * 2 + 2) return addr;
  const head = addr.startsWith("0x") ? 2 + n : n;
  return `${addr.slice(0, head)}…${addr.slice(-n)}`;
}

export function fmtUsd(n?: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

/* ------------------------------------------------------------------ */
/* Light ontology join for coverage (intent id → domain + label)       */
/* ------------------------------------------------------------------ */

export interface CapHint {
  id: string;
  label: string;
  domain: string;
  domainLabel: string;
  color: string;
}

/** Resolve up to `limit` capability ids into domain-colored hints. */
export function resolveCapHints(ids: string[] | undefined, limit = 2): CapHint[] {
  if (!ids?.length) return [];
  const out: CapHint[] = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    const cap = capById.get(id);
    if (!cap) {
      // unbound / unknown id — show local segment only
      const local = id.includes(".") ? id.split(".").slice(1).join(".") : id;
      out.push({
        id,
        label: local.replace(/_/g, " "),
        domain: "other",
        domainLabel: "?",
        color: "#9ca3af",
      });
      continue;
    }
    const meta = domainMeta(cap.domain);
    out.push({
      id: cap.id,
      label: cap.label,
      domain: cap.domain,
      domainLabel: meta.label,
      color: meta.color,
    });
  }
  return out;
}

/** Distinct domains among endpoint rows (for a service summary chip). */
export function domainSummary(
  rows: CatalogEndpointRow[],
  limit = 4,
): Array<{ domain: string; label: string; color: string; n: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const id of r.capabilities ?? []) {
      const cap = capById.get(id);
      const d = cap?.domain ?? "other";
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([domain, n]) => {
      const meta = domainMeta(domain);
      return { domain, label: meta.label, color: meta.color, n };
    });
}
