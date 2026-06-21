import type { EndpointRecord, HttpMethod, PaymentInfo } from "../types.js";
import { endpointId } from "../id.js";
import { canonicalOrigin, canonicalResourceUrl } from "../origin-aliases.js";
import { parseOpenApi } from "../openapi-parser.js";

const RESOURCE_PATTERNS = [
  /https:\/\/[a-zA-Z0-9._-]+\.[a-z]{2,}\/v\d+\/[a-zA-Z0-9_./-]+/g,
  /https:\/\/[a-zA-Z0-9._-]+\.[a-z]{2,}\/api\/[a-zA-Z0-9_./-]+/g,
];

const ORIGIN_PATTERN =
  /https:\/\/[a-zA-Z0-9._-]+\.[a-z]{2,}(?:\/[a-zA-Z0-9._/-]*)?/g;

const ORIGIN_BLOCKLIST = new Set([
  "https://www.x402scan.com",
  "https://www.mppscan.com",
  "https://mppscan.com",
  "https://x402scan.com",
  "https://schema.org",
  "https://merit.systems",
]);

export interface ScanIngestOptions {
  sitemapUrl: string;
  sourceName: "x402scan" | "mppscan";
  builtAt: string;
  concurrency?: number;
  maxServers?: number;
  fetchOpenApi?: boolean;
}

function parseResourceUrl(
  resourceUrl: string,
  builtAt: string,
  sourceName: string,
): EndpointRecord | null {
  const canonical = canonicalResourceUrl(resourceUrl);
  let u: URL;
  try {
    u = new URL(canonical);
  } catch {
    return null;
  }

  const origin = canonicalOrigin(u.origin);
  const path = u.pathname;
  const method: HttpMethod = "GET";
  const payment: PaymentInfo = {
    paid: true,
    rails: [{ protocol: sourceName === "x402scan" ? "x402" : "mpp" }],
  };

  return {
    id: endpointId(origin, method, path),
    origin,
    method,
    path,
    summary: `${method} ${path}`,
    provider_fqn: `${sourceName}/${origin.replace(/^https?:\/\//, "")}`,
    provider_title: origin,
    payment,
    openapi_url: `${origin}/openapi.json`,
    search_text: `${sourceName} ${origin} ${path}`.toLowerCase(),
    built_at: builtAt,
  };
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "paid-api-graph/0.1 (+https://github.com/paid-api-graph)" },
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

export async function loadSitemapServerUrls(sitemapUrl: string): Promise<string[]> {
  const xml = await fetchText(sitemapUrl);
  const matches = xml.match(/<loc>([^<]*\/server\/[^<]+)<\/loc>/g) ?? [];
  return matches
    .map((m) => m.replace(/<\/?loc>/g, "").trim())
    .filter(Boolean);
}

function extractResourceUrls(html: string): string[] {
  const found = new Set<string>();
  for (const pattern of RESOURCE_PATTERNS) {
    for (const match of html.match(pattern) ?? []) {
      if (
        !match.includes("x402scan.com") &&
        !match.includes("mppscan.com") &&
        !match.includes("schema.org")
      ) {
        found.add(canonicalResourceUrl(match));
      }
    }
  }
  return [...found];
}

function extractServiceOrigins(html: string): string[] {
  const origins = new Set<string>();
  for (const match of html.match(ORIGIN_PATTERN) ?? []) {
    if (ORIGIN_BLOCKLIST.has(match.replace(/\/$/, ""))) continue;
    if (match.includes("x402scan") || match.includes("mppscan")) continue;
    try {
      const u = new URL(match);
      if (!u.hostname.includes(".")) continue;
      origins.add(canonicalOrigin(u.origin));
    } catch {
      /* skip */
    }
  }
  return [...origins];
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function tryFetchOpenApi(origin: string, builtAt: string): Promise<EndpointRecord[]> {
  const url = `${origin.replace(/\/$/, "")}/openapi.json`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const doc = (await res.json()) as Record<string, unknown>;
    return parseOpenApi(doc, { origin, builtAt });
  } catch {
    return [];
  }
}

export async function ingestScanSitemap(
  options: ScanIngestOptions,
): Promise<{ endpoints: EndpointRecord[]; servers: number; origins: number }> {
  const serverUrls = await loadSitemapServerUrls(options.sitemapUrl);
  const limited = options.maxServers
    ? serverUrls.slice(0, options.maxServers)
    : serverUrls;

  const concurrency = options.concurrency ?? 16;
  const htmlPages = await mapPool(limited, concurrency, async (serverUrl) => {
    try {
      return await fetchText(serverUrl);
    } catch {
      return "";
    }
  });

  const resourceUrls = new Set<string>();
  const serviceOrigins = new Set<string>();
  for (const html of htmlPages) {
    for (const url of extractResourceUrls(html)) {
      resourceUrls.add(url);
    }
    for (const origin of extractServiceOrigins(html)) {
      serviceOrigins.add(origin);
    }
  }

  const stubRecords: EndpointRecord[] = [];
  for (const url of resourceUrls) {
    const rec = parseResourceUrl(url, options.builtAt, options.sourceName);
    if (rec) stubRecords.push(rec);
  }

  const origins = [
    ...new Set([...stubRecords.map((e) => e.origin), ...serviceOrigins]),
  ];
  let enriched: EndpointRecord[] = [];

  if (options.fetchOpenApi !== false) {
    const openapiRecords = await mapPool(origins, 8, (origin) =>
      tryFetchOpenApi(origin, options.builtAt),
    );
    enriched = openapiRecords.flat();
  }

  const merged = new Map<string, EndpointRecord>();
  for (const ep of [...stubRecords, ...enriched]) {
    const key = ep.id;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...ep,
        provider_fqn: ep.provider_fqn ?? `${options.sourceName}/${ep.origin}`,
        search_text: `${ep.search_text} ${options.sourceName}`.trim(),
      });
      continue;
    }
    merged.set(key, {
      ...existing,
      ...ep,
      summary: ep.summary.length > existing.summary.length ? ep.summary : existing.summary,
      payment: ep.payment.rails.length ? ep.payment : existing.payment,
      provider_fqn: existing.provider_fqn ?? ep.provider_fqn,
      search_text: `${existing.search_text} ${options.sourceName}`.trim(),
    });
  }

  return {
    endpoints: [...merged.values()],
    servers: limited.length,
    origins: origins.length,
  };
}