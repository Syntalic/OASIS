// pay.sh registry ingestion (Solana Foundation `pay` CLI's live pay-skills catalog).
// pay.sh/api/catalog is a PROVIDER directory (not endpoint-level): each provider gives a
// service_url (origin) + rich metadata + a USD price range. We use it as a discovery-layer
// origin source; endpoints come from hopping each service_url to /openapi.json (enrichment).
import { canonicalOrigin } from "./origin-aliases.js";

const PAYSH_CATALOG = "https://pay.sh/api/catalog";

export interface PayShProvider {
  fqn: string;
  title?: string;
  description?: string;
  use_case?: string;
  category?: string;
  service_url: string;
  endpoint_count?: number;
  has_metering?: boolean;
  has_free_tier?: boolean;
  min_price_usd?: number;
  max_price_usd?: number;
  sha?: string;
}
interface PayShCatalog {
  version?: string;
  providers?: PayShProvider[];
}

/** Fetch the live pay.sh provider catalog. Drops providers with no service_url or 0 endpoints
 *  (nothing to enrich). */
export async function fetchPayShProviders(): Promise<PayShProvider[]> {
  let res: Response;
  try {
    res = await fetch(PAYSH_CATALOG);
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const j = (await res.json()) as PayShCatalog;
  return (j.providers ?? []).filter((p) => p.service_url && p.endpoint_count !== 0);
}

/** Canonical origin for a pay.sh provider's gateway service_url. */
export function payShOrigin(p: PayShProvider): string | null {
  try {
    return canonicalOrigin(new URL(p.service_url).origin);
  } catch {
    return null;
  }
}
