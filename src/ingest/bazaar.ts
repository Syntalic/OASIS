// CDP Bazaar discovery ingestion. Bazaar (api.cdp.coinbase.com/platform/v2/x402/discovery)
// is a registry over the same x402 ecosystem: each resource carries the URL, inline x402
// `accepts` (price), description/tags, and real usage telemetry (`quality`). We use it as a
// discovery-layer source — origins + a pre-enrichment record (so price/description survive
// even when the origin serves no /openapi.json). The runtime 402 is authoritative.
import { endpointId } from "../core/id.js";
import { baseUnitsToUsd } from "../core/money.js";
import { canonicalOrigin } from "./origin-aliases.js";
import type { EndpointRecord, HttpMethod, PaymentOffer, PaymentRail } from "../core/types.js";

const BAZAAR_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
const HTTP = new Set<HttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export interface BazaarAccept {
  amount?: string;
  asset?: string;
  network?: string;
  payTo?: string;
  scheme?: string;
  extra?: Record<string, unknown>;
}
export interface BazaarQuality {
  l30DaysTotalCalls?: number;
  l30DaysUniquePayers?: number;
  lastCalledAt?: string;
}
export interface BazaarResource {
  resource: string;
  type?: string;
  accepts?: BazaarAccept[];
  description?: string;
  serviceName?: string;
  tags?: string[];
  quality?: BazaarQuality;
  iconUrl?: string;
  lastUpdated?: string;
  extensions?: { bazaar?: { info?: { input?: { method?: string } } } };
  x402Version?: number;
}

function methodOf(r: BazaarResource): HttpMethod {
  const raw = (r.extensions?.bazaar?.info?.input?.method ?? "POST").toUpperCase() as HttpMethod;
  return HTTP.has(raw) ? raw : "POST";
}

function offersFromAccepts(accepts: BazaarAccept[]): PaymentOffer[] {
  return accepts
    .filter((a) => a.amount != null && /^[0-9]+$/.test(String(a.amount)))
    .map((a) => ({
      intent: "charge" as const,
      method: "x402",
      amount: String(a.amount),
      currency: a.asset,
    }));
}

/**
 * Normalize a Bazaar resource into an EndpointRecord (pre-enrichment — an OpenAPI hop can
 * later supersede it for the same origin). Returns null for non-http or unusable entries.
 */
export function bazaarToEndpoint(r: BazaarResource, builtAt: string): EndpointRecord | null {
  if (r.type && r.type !== "http") return null; // skip mcp etc.
  let u: URL;
  try {
    u = new URL(r.resource);
  } catch {
    return null;
  }
  const origin = canonicalOrigin(u.origin);
  const path = u.pathname || "/";
  const method = methodOf(r);
  const offers = offersFromAccepts(r.accepts ?? []);
  const price = offers
    .map((o) => baseUnitsToUsd(o.amount, { asset: o.currency }))
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b)[0];
  const rails: PaymentRail[] = [{ protocol: "x402", version: "2" }];
  const summary = (r.description || r.serviceName || path).slice(0, 200);
  return {
    id: endpointId(origin, method, path),
    origin,
    method,
    path,
    summary,
    description: r.description,
    tags: r.tags,
    provider_fqn: `bazaar/${u.hostname}`,
    provider_title: r.serviceName,
    payment: { paid: true, price_usd: price, rails, offers, currency: r.accepts?.[0]?.asset },
    responses: { has402: true },
    search_text: [r.serviceName, r.description, path, (r.tags ?? []).join(" ")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    built_at: builtAt,
  };
}

/** Paginate the full Bazaar discovery list (offset-based; ~23.5k resources, 100/page). */
export async function fetchBazaar(
  opts: { maxPages?: number; pageSize?: number; onProgress?: (n: number, total: number) => void } = {},
): Promise<BazaarResource[]> {
  const pageSize = opts.pageSize ?? 100;
  const out: BazaarResource[] = [];
  let total = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < total; offset += pageSize) {
    if (opts.maxPages != null && offset / pageSize >= opts.maxPages) break;
    let res: Response;
    try {
      res = await fetch(`${BAZAAR_URL}?limit=${pageSize}&offset=${offset}`);
    } catch {
      break;
    }
    if (!res.ok) break;
    const j = (await res.json()) as { items?: BazaarResource[]; pagination?: { total?: number } };
    total = j.pagination?.total ?? out.length;
    const items = j.items ?? [];
    if (!items.length) break;
    out.push(...items);
    opts.onProgress?.(out.length, total);
  }
  return out;
}
