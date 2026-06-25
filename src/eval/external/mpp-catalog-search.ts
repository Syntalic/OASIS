import { ingestMppCatalog } from "../../ingest/mpp-catalog.js";
import { searchIndex } from "../../search/search.js";
import type { EndpointRecord, SearchHit } from "../../core/types.js";

let cachedEndpoints: EndpointRecord[] | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function loadMppCatalogEndpoints(
  force = false,
): Promise<EndpointRecord[]> {
  const now = Date.now();
  if (!force && cachedEndpoints && now - cachedAt < CACHE_TTL_MS) {
    return cachedEndpoints;
  }
  cachedEndpoints = await ingestMppCatalog(new Date().toISOString());
  cachedAt = now;
  return cachedEndpoints;
}

export async function searchMppCatalogLive(
  query: string,
  limit = 10,
): Promise<SearchHit[]> {
  const endpoints = await loadMppCatalogEndpoints();
  return searchIndex(query, endpoints, [], limit);
}

export function clearMppCatalogCache(): void {
  cachedEndpoints = null;
  cachedAt = 0;
}