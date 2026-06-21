import { ingestMppCatalog } from "../../ingest/mpp-catalog.js";
import { searchIndex } from "../../search.js";
let cachedEndpoints = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;
export async function loadMppCatalogEndpoints(force = false) {
    const now = Date.now();
    if (!force && cachedEndpoints && now - cachedAt < CACHE_TTL_MS) {
        return cachedEndpoints;
    }
    cachedEndpoints = await ingestMppCatalog(new Date().toISOString());
    cachedAt = now;
    return cachedEndpoints;
}
export async function searchMppCatalogLive(query, limit = 10) {
    const endpoints = await loadMppCatalogEndpoints();
    return searchIndex(query, endpoints, [], limit);
}
export function clearMppCatalogCache() {
    cachedEndpoints = null;
    cachedAt = 0;
}
//# sourceMappingURL=mpp-catalog-search.js.map