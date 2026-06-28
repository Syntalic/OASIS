import { existsSync } from "node:fs";
import { curatedCapabilitiesForSearch } from "./curated-search.js";
import { embedText } from "../embed/embedder.js";
import { openLanceTable } from "../embed/lance-index.js";
import { searchIndex } from "./search.js";
import type { CapabilityIntent, IndexBundle, SearchHit } from "../core/types.js";

// Fusion weights live in src/tuning.ts (single source); re-exported for the established importers
// (the `search` CLI + eval/hybrid-mvp). Vestigial in the live path, which does no keyword/vector fusion.
export { DEFAULT_KEYWORD_WEIGHT, DEFAULT_VECTOR_WEIGHT } from "../tuning.js";

export interface HybridFusionOptions {
  keywordWeight?: number;
  vectorWeight?: number;
  candidatePool?: number;
}

function capabilityToHit(cap: CapabilityIntent, score: number): SearchHit {
  return {
    kind: "capability",
    score,
    capability_id: cap.id,
    label: cap.label,
    summary: cap.description ?? cap.label,
  };
}

/**
 * Pure-vector retrieval: rank capabilities by embedding similarity ALONE — no
 * keyword arm, no regex cue tables, no facet/domain pre-filter. With a
 * high-quality embedder (gemini-embedding-001) this beats the old keyword+vector
 * RRF hybrid by a wide margin on novel phrasing (disc@1 ~95% vs ~78% on the
 * held-out set; ~97% vs ~87% over messy+held-out combined). The keyword arm
 * overfit the alias vocabulary and injected cross-domain noise — e.g. "hotel bill
 * in euros … in dollars" got dragged from exchange_rates onto maps.places. The
 * vector index is capability-only, so this returns capability hits; resolve
 * expands them to endpoints.
 */
export async function searchVectorOnly(
  query: string,
  bundle: IndexBundle,
  lanceDir: string,
  limit = 10,
): Promise<SearchHit[]> {
  const table = await openLanceTable(lanceDir);
  const queryVector = await embedText(query);
  const rows = await table
    .vectorSearch(queryVector)
    .limit(Math.max(limit, 24))
    .toArray();

  const byId = new Map(
    curatedCapabilitiesForSearch(bundle).map((c) => [c.id, c]),
  );
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if ((row.kind as string) !== "capability") continue;
    const id = row.id as string;
    if (seen.has(id)) continue;
    const cap = byId.get(id);
    if (!cap) continue; // skip any non-curated shadow rows
    seen.add(id);
    // LanceDB returns ascending L2 _distance on the normalized vectors; map to a
    // descending similarity so higher = better, consistent with searchIndex.
    const distance = typeof row._distance === "number" ? (row._distance as number) : 0;
    hits.push(capabilityToHit(cap, 1 / (1 + distance)));
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * Default retrieval path for the MCP tools and CLI. Pure embeddings when a vector
 * index is available (see searchVectorOnly); degrades to keyword-only (searchIndex)
 * when there is no index or the embedder/vector lookup fails, so dev/offline still
 * works. The `_options` arg is accepted for signature compatibility with the eval
 * harness and ignored — there is no keyword/vector fusion to tune.
 */
export async function searchHybridWithFallback(
  query: string,
  bundle: IndexBundle,
  lanceDir: string | null,
  limit = 10,
  _options: HybridFusionOptions = {},
): Promise<SearchHit[]> {
  const keywordFallback = () =>
    searchIndex(
      query,
      bundle.endpoints,
      curatedCapabilitiesForSearch(bundle),
      limit,
    );
  if (!lanceDir || !existsSync(lanceDir)) return keywordFallback();
  try {
    return await searchVectorOnly(query, bundle, lanceDir, limit);
  } catch (err) {
    console.warn(
      `vector-only search failed, using keyword fallback (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return keywordFallback();
  }
}
