import type { EndpointRecord, HttpMethod, PaymentInfo } from "../core/types.js";
import { endpointId } from "../core/id.js";
import { canonicalOrigin } from "./origin-aliases.js";

const MPP_CATALOG_URL = "https://mpp.dev/api/services";

interface MppPayment {
  intent?: string;
  method?: string;
  currency?: string;
  decimals?: number;
  amount?: string;
  amountHint?: string;
  dynamic?: boolean;
  description?: string;
}

interface MppEndpoint {
  method?: string;
  path: string;
  description?: string;
  summary?: string;
  payment?: MppPayment;
}

interface MppService {
  id: string;
  name: string;
  url?: string;
  serviceUrl?: string;
  description?: string;
  categories?: string[];
  tags?: string[];
  endpoints?: MppEndpoint[];
}

interface MppCatalog {
  version: number;
  services: MppService[];
}

function parseAmountHint(hint?: string): number | undefined {
  if (!hint) return undefined;
  const m = hint.match(/\$([0-9]+(?:\.[0-9]+)?)/);
  return m ? Number(m[1]) : undefined;
}

function paymentFromMpp(payment?: MppPayment): PaymentInfo {
  const method = payment?.method ?? "tempo";
  const rails =
    method === "stripe" || method === "card"
      ? [{ protocol: "mpp" as const, networks: [method] }]
      : [{ protocol: "mpp" as const, networks: [method === "tempo" ? "tempo" : method] }];

  let price_usd = parseAmountHint(payment?.amountHint);
  if (price_usd == null && payment?.amount && payment.decimals != null) {
    price_usd = Number(payment.amount) / 10 ** payment.decimals;
  }

  return {
    paid: true,
    price_usd,
    rails,
  };
}

export async function ingestMppCatalog(builtAt: string): Promise<EndpointRecord[]> {
  const res = await fetch(MPP_CATALOG_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`mpp.dev catalog fetch failed: ${res.status}`);
  }
  const catalog = (await res.json()) as MppCatalog;
  const records: EndpointRecord[] = [];

  for (const service of catalog.services ?? []) {
    const origin = canonicalOrigin(
      (service.serviceUrl ?? service.url ?? "").replace(/\/$/, ""),
    );
    if (!origin.startsWith("http")) continue;

    const providerTitle = service.name;
    const category = service.categories?.[0];
    const searchBase = [
      service.id,
      service.name,
      service.description,
      ...(service.categories ?? []),
      ...(service.tags ?? []),
      "mpp",
      "mppscan",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    for (const ep of service.endpoints ?? []) {
      const method = (ep.method ?? "GET").toUpperCase() as HttpMethod;
      const path = ep.path.startsWith("/") ? ep.path : `/${ep.path}`;
      const summary = ep.summary ?? ep.description ?? `${method} ${path}`;

      records.push({
        id: endpointId(origin, method, path),
        origin,
        method,
        path,
        summary,
        description: ep.description,
        provider_fqn: `mpp-catalog/${service.id}`,
        provider_title: providerTitle,
        category,
        payment: paymentFromMpp(ep.payment),
        guidance_available: true,
        openapi_url: `${origin}/openapi.json`,
        search_text: `${searchBase} ${summary} ${path}`.toLowerCase(),
        built_at: builtAt,
      });
    }
  }

  return records;
}