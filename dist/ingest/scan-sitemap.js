import { endpointId } from "../id.js";
import { canonicalOrigin, canonicalResourceUrl } from "../origin-aliases.js";
import { fetchOpenApiForOrigin, isStubEndpoint } from "../openapi-fetch.js";
const RESOURCE_PATTERNS = [
    /https:\/\/[a-zA-Z0-9._-]+\.[a-z]{2,}\/v\d+\/[a-zA-Z0-9_./-]+/g,
    /https:\/\/[a-zA-Z0-9._-]+\.[a-z]{2,}\/api\/[a-zA-Z0-9_./-]+/g,
];
const ORIGIN_PATTERN = /https:\/\/[a-zA-Z0-9._-]+\.[a-z]{2,}(?:\/[a-zA-Z0-9._/-]*)?/g;
const ORIGIN_BLOCKLIST = new Set([
    "https://www.x402scan.com",
    "https://www.mppscan.com",
    "https://mppscan.com",
    "https://x402scan.com",
    "https://schema.org",
    "https://merit.systems",
]);
function parseResourceUrl(resourceUrl, builtAt, sourceName) {
    const canonical = canonicalResourceUrl(resourceUrl);
    let u;
    try {
        u = new URL(canonical);
    }
    catch {
        return null;
    }
    const origin = canonicalOrigin(u.origin);
    const path = u.pathname;
    const method = "GET";
    const payment = {
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
async function fetchText(url) {
    const res = await fetch(url, {
        headers: { "User-Agent": "oasis/0.1 (+https://github.com/Syntalic/OASIS)" },
    });
    if (!res.ok)
        throw new Error(`${url} → ${res.status}`);
    return res.text();
}
export async function loadSitemapServerUrls(sitemapUrl) {
    const xml = await fetchText(sitemapUrl);
    const matches = xml.match(/<loc>([^<]*\/server\/[^<]+)<\/loc>/g) ?? [];
    return matches
        .map((m) => m.replace(/<\/?loc>/g, "").trim())
        .filter(Boolean);
}
function extractResourceUrls(html) {
    const found = new Set();
    for (const pattern of RESOURCE_PATTERNS) {
        for (const match of html.match(pattern) ?? []) {
            if (!match.includes("x402scan.com") &&
                !match.includes("mppscan.com") &&
                !match.includes("schema.org")) {
                found.add(canonicalResourceUrl(match));
            }
        }
    }
    return [...found];
}
function extractServiceOrigins(html) {
    const origins = new Set();
    for (const match of html.match(ORIGIN_PATTERN) ?? []) {
        if (ORIGIN_BLOCKLIST.has(match.replace(/\/$/, "")))
            continue;
        if (match.includes("x402scan") || match.includes("mppscan"))
            continue;
        try {
            const u = new URL(match);
            if (!u.hostname.includes("."))
                continue;
            origins.add(canonicalOrigin(u.origin));
        }
        catch {
            /* skip */
        }
    }
    return [...origins];
}
async function mapPool(items, concurrency, fn) {
    const results = [];
    let i = 0;
    async function worker() {
        while (i < items.length) {
            const idx = i++;
            results[idx] = await fn(items[idx]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
}
function mergeEndpointRecords(merged, ep, sourceName) {
    const key = ep.id;
    const existing = merged.get(key);
    if (!existing) {
        merged.set(key, {
            ...ep,
            provider_fqn: ep.provider_fqn ?? `${sourceName}/${ep.origin.replace(/^https?:\/\//, "")}`,
            search_text: `${ep.search_text} ${sourceName}`.trim(),
        });
        return;
    }
    const prefer = isStubEndpoint(existing) && !isStubEndpoint(ep)
        ? ep
        : !isStubEndpoint(existing) && isStubEndpoint(ep)
            ? existing
            : ep.summary.length > existing.summary.length
                ? ep
                : existing;
    const other = prefer === ep ? existing : ep;
    merged.set(key, {
        ...other,
        ...prefer,
        description: prefer.description ?? other.description,
        inputs: prefer.inputs?.length ? prefer.inputs : other.inputs,
        operation_id: prefer.operation_id ?? other.operation_id,
        tags: prefer.tags?.length ? prefer.tags : other.tags,
        provider_title: prefer.provider_title ?? other.provider_title,
        category: prefer.category ?? other.category,
        payment: {
            paid: prefer.payment.paid || other.payment.paid,
            price_usd: prefer.payment.price_usd ?? other.payment.price_usd,
            rails: prefer.payment.rails.length ? prefer.payment.rails : other.payment.rails,
        },
        provider_fqn: existing.provider_fqn ?? ep.provider_fqn,
        search_text: `${existing.search_text} ${ep.search_text} ${sourceName}`.trim(),
    });
}
export async function ingestScanSitemap(options) {
    const serverUrls = await loadSitemapServerUrls(options.sitemapUrl);
    const limited = options.maxServers
        ? serverUrls.slice(0, options.maxServers)
        : serverUrls;
    const concurrency = options.concurrency ?? 16;
    const htmlPages = await mapPool(limited, concurrency, async (serverUrl) => {
        try {
            return await fetchText(serverUrl);
        }
        catch {
            return "";
        }
    });
    const resourceUrls = new Set();
    const serviceOrigins = new Set();
    for (const html of htmlPages) {
        for (const url of extractResourceUrls(html)) {
            resourceUrls.add(url);
        }
        for (const origin of extractServiceOrigins(html)) {
            serviceOrigins.add(origin);
        }
    }
    const stubRecords = [];
    for (const url of resourceUrls) {
        const rec = parseResourceUrl(url, options.builtAt, options.sourceName);
        if (rec)
            stubRecords.push(rec);
    }
    const origins = [
        ...new Set([...stubRecords.map((e) => e.origin), ...serviceOrigins]),
    ];
    let enriched = [];
    if (options.fetchOpenApi !== false) {
        const openapiRecords = await mapPool(origins, 12, async (origin) => {
            const result = await fetchOpenApiForOrigin(origin, options.builtAt);
            return result.endpoints;
        });
        enriched = openapiRecords.flat();
    }
    const merged = new Map();
    for (const ep of [...stubRecords, ...enriched]) {
        mergeEndpointRecords(merged, ep, options.sourceName);
    }
    if (options.fetchOpenApi !== false) {
        const stubOrigins = new Set();
        for (const ep of merged.values()) {
            if (isStubEndpoint(ep))
                stubOrigins.add(ep.origin);
        }
        if (stubOrigins.size > 0) {
            const backfill = await mapPool([...stubOrigins], 16, async (origin) => {
                const result = await fetchOpenApiForOrigin(origin, options.builtAt, 20_000);
                return result.endpoints;
            });
            for (const ep of backfill.flat()) {
                mergeEndpointRecords(merged, ep, options.sourceName);
            }
        }
    }
    return {
        endpoints: [...merged.values()],
        servers: limited.length,
        origins: origins.length,
    };
}
//# sourceMappingURL=scan-sitemap.js.map