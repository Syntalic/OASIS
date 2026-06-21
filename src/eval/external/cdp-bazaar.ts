import { parseResourceUrl, type ParsedEndpointRef } from "../url-match.js";

const CDP_BAZAAR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search";

interface BazaarInput {
  method?: string;
}

interface BazaarResource {
  resource: string;
  description?: string;
  extensions?: {
    bazaar?: {
      info?: {
        input?: BazaarInput;
      };
    };
  };
}

interface BazaarResponse {
  resources?: BazaarResource[];
  partialResults?: boolean;
}

export interface CdpBazaarHit extends ParsedEndpointRef {
  resource: string;
  description?: string;
  rank: number;
}

export async function searchCdpBazaar(
  query: string,
  limit = 10,
): Promise<CdpBazaarHit[]> {
  const capped = Math.min(Math.max(limit, 1), 20);
  const url = new URL(CDP_BAZAAR_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(capped));

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`CDP Bazaar search failed: ${res.status}`);
  }

  const body = (await res.json()) as BazaarResponse;
  const hits: CdpBazaarHit[] = [];

  for (const [i, item] of (body.resources ?? []).entries()) {
    const method =
      item.extensions?.bazaar?.info?.input?.method?.toUpperCase() ?? "GET";
    const parsed = parseResourceUrl(item.resource, method);
    if (!parsed) continue;
    hits.push({
      ...parsed,
      resource: item.resource,
      description: item.description,
      rank: i + 1,
    });
  }

  return hits;
}