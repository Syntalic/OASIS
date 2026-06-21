import { parseResourceUrl } from "../url-match.js";
const CDP_BAZAAR_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search";
export async function searchCdpBazaar(query, limit = 10) {
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
    const body = (await res.json());
    const hits = [];
    for (const [i, item] of (body.resources ?? []).entries()) {
        const method = item.extensions?.bazaar?.info?.input?.method?.toUpperCase() ?? "GET";
        const parsed = parseResourceUrl(item.resource, method);
        if (!parsed)
            continue;
        hits.push({
            ...parsed,
            resource: item.resource,
            description: item.description,
            rank: i + 1,
        });
    }
    return hits;
}
//# sourceMappingURL=cdp-bazaar.js.map