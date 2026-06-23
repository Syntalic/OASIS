// Discovery-method comparison. Each method is a real discovery TECHNIQUE in the
// agentic-commerce ecosystem (described generically — by technique, not vendor):
//
//   oasis           — curated task intents + vector search (this project)
//   spec-embedding  — semantic retrieval over raw endpoint specs. This is the
//                     technique third-party semantic registries / discovery MCP
//                     servers use; run on OUR corpus so coverage is equal.
//   catalog         — third-party scanner registry, keyword lookup. The scanner
//                     slices crawl the same ecosystem, so they're consolidated.
//   live-registry   — a LIVE external discovery-registry API (opt-in)
//
// Accuracy metric. The three INTERNAL methods all return OUR endpoint ids, so
// they're scored task-level and identically: top-k holds the golden endpoint OR an
// endpoint the index binds to the expected task intent (= "found a task-appropriate
// API", not "guessed the one label"). The LIVE registry returns external URLs not in
// our index, so it can only be scored on literal golden-URL match — a strict floor
// that UNDERSELLS it; its TECHNIQUE is fairly measured by spec-embedding.
//
// Efficiency metrics. `tool_calls` = round-trips to reach an INVOCABLE endpoint:
// oasis_find returns price + rails inline (1 hop); a semantic search / catalog
// returns candidates that need a follow-up detail/schema fetch (2). `avg_tokens` =
// the discovery payload the agent reads (≈ chars/4). The true END-TO-END agent token
// cost is the LLM probe (compare.mjs), not this. spec-embedding reuses the build
// cache, so no endpoints are re-embedded.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { curatedCapabilitiesForSearch } from "../curated-search.js";
import { embedText } from "../embed/embedder.js";
import { embedEndpointsCached } from "../embed/endpoint-cache.js";
import { defaultLanceDir } from "../embed/lance-index.js";
import { endpointId } from "../id.js";
import { searchHybridWithFallback } from "../search-hybrid.js";
import { searchIndex } from "../search.js";
import { resolveEndpointsForQuery } from "../select-policy.js";
import type { EndpointRecord, IndexBundle } from "../types.js";
import { expectedEndpointId, type EvalQuery } from "./discovery-benchmark.js";
import { searchCdpBazaar as searchLiveRegistry } from "./external/cdp-bazaar.js";
import { loadMessyQueries } from "./hybrid-mvp.js";
import { rankExternalHits } from "./url-match.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..", "..");

export type DiscoveryMethod = "oasis" | "spec-embedding" | "catalog" | "live-registry";

export interface MethodReport {
  method: DiscoveryMethod;
  represents: string;
  metric: "task-level" | "literal-url";
  queries: number;
  disc_at_1: number;
  disc_at_3: number;
  mrr: number;
  /** Round-trips to reach an invocable endpoint. */
  tool_calls: number;
  /** Avg discovery-payload tokens the agent reads (≈ chars/4). */
  avg_tokens: number;
}

const endpointEmbedText = (ep: EndpointRecord): string =>
  [ep.summary, ep.description, ep.path, ...(ep.inputs ?? [])].filter(Boolean).join(" ");

const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

const tokEst = (s: string): number => Math.round(s.length / 4);

/** oasis_find payload: invocable — method, url, summary, price, rails inline. */
function payloadInvocable(eps: EndpointRecord[]): string {
  return eps
    .map((e) => `${e.method} ${e.origin}${e.path} — ${e.summary ?? ""} [$${e.payment?.price_usd ?? "?"} ${(e.payment?.rails ?? []).map((r) => r.protocol).join("/")}]`)
    .join("\n");
}
/** search/catalog payload: candidates only — method, url, summary (schema/price deferred). */
function payloadCandidates(eps: EndpointRecord[]): string {
  return eps.map((e) => `${e.method} ${e.origin}${e.path} — ${e.summary ?? ""}`).join("\n");
}

function score(ranks: Array<number | null>): { disc_at_1: number; disc_at_3: number; mrr: number } {
  const n = ranks.length || 1;
  let d1 = 0, d3 = 0, mrr = 0;
  for (const r of ranks) if (r) { if (r === 1) d1++; if (r <= 3) d3++; mrr += 1 / r; }
  return { disc_at_1: (100 * d1) / n, disc_at_3: (100 * d3) / n, mrr: mrr / n };
}

/** Task-level rank: golden endpoint OR an endpoint bound to the expected intent. */
function taskRank(
  ids: string[],
  goldenId: string | null,
  expectIntent: string | undefined,
  epById: Map<string, EndpointRecord>,
  k: number,
): number | null {
  for (let i = 0; i < Math.min(k, ids.length); i++) {
    const id = ids[i];
    if (goldenId && id === goldenId) return i + 1;
    const ep = epById.get(id);
    if (ep && expectIntent && ep.capabilities?.includes(expectIntent)) return i + 1;
  }
  return null;
}

export interface MethodBenchmarkOptions {
  distDir?: string;
  /** Also hit the live external registry API. Default false (cross-corpus floor). */
  live?: boolean;
  topK?: number;
}

export async function runMethodBenchmark(
  bundle: IndexBundle,
  opts: MethodBenchmarkOptions = {},
): Promise<MethodReport[]> {
  const distDir = opts.distDir ?? path.join(PACKAGE_ROOT, "dist");
  const lanceDir = defaultLanceDir(distDir);
  const K = opts.topK ?? 10;
  const endpoints = bundle.endpoints;
  const epById = new Map(endpoints.map((e) => [e.id, e]));
  const curated = curatedCapabilitiesForSearch(bundle);
  const capById = new Map(curated.map((c) => [c.id, c]));
  const queries: EvalQuery[] = (await loadMessyQueries()).filter((q) => q.expect_endpoint);
  const n = queries.length;

  const { vectors: epVecs } = await embedEndpointsCached(
    endpoints.map(endpointEmbedText),
    path.join(distDir, "cache"),
  );
  // catalog: the third-party scanner slices (they crawl the same ecosystem, consolidated).
  const scanner = endpoints.filter((e) => {
    const p = e.provider_fqn ?? "";
    return p.startsWith("x402scan/") || p.startsWith("mppscan/") || p.startsWith("mpp-catalog/");
  });

  const reports: MethodReport[] = [];

  // --- oasis: route query→intent (vector), resolve intent→endpoints (1 hop, invocable) ---
  const oasisRanks: Array<number | null> = [];
  let oasisTok = 0;
  for (const q of queries) {
    const hits = await searchHybridWithFallback(q.query, bundle, lanceDir, 8);
    const recs: EndpointRecord[] = [];
    for (const h of hits) {
      if (h.kind !== "capability" || !h.capability_id) continue;
      const intent = capById.get(h.capability_id);
      if (!intent) continue;
      for (const e of resolveEndpointsForQuery(intent, endpoints, q.query, 3)) recs.push(e);
      if (recs.length >= K) break;
    }
    const top = recs.slice(0, K);
    const ids = top.map((e) => endpointId(e.origin, e.method, e.path));
    oasisRanks.push(taskRank(ids, expectedEndpointId(q.expect_endpoint), q.expect_intent, epById, K));
    oasisTok += tokEst(payloadInvocable(top));
  }
  reports.push({ method: "oasis", represents: "curated intents + vector search (this project)", metric: "task-level", queries: n, ...score(oasisRanks), tool_calls: 1, avg_tokens: Math.round(oasisTok / n) });

  // --- spec-embedding: embed endpoint specs, retrieve query→endpoint (search + schema fetch) ---
  const specRanks: Array<number | null> = [];
  let specTok = 0;
  for (const q of queries) {
    const qv = await embedText(q.query, "RETRIEVAL_QUERY");
    const sc = new Array(K).fill(-Infinity);
    const ix = new Array(K).fill(-1);
    for (let i = 0; i < endpoints.length; i++) {
      const s = dot(qv, epVecs[i]);
      if (s > sc[K - 1]) {
        let j = K - 1;
        while (j > 0 && sc[j - 1] < s) { sc[j] = sc[j - 1]; ix[j] = ix[j - 1]; j--; }
        sc[j] = s; ix[j] = i;
      }
    }
    const top = ix.filter((i) => i >= 0).map((i) => endpoints[i]);
    const ids = top.map((e) => e.id);
    specRanks.push(taskRank(ids, expectedEndpointId(q.expect_endpoint), q.expect_intent, epById, K));
    specTok += tokEst(payloadCandidates(top));
  }
  reports.push({ method: "spec-embedding", represents: "semantic over endpoint specs (third-party semantic-registry technique)", metric: "task-level", queries: n, ...score(specRanks), tool_calls: 2, avg_tokens: Math.round(specTok / n) });

  // --- catalog: keyword lookup over the scanner registry (browse + detail) ---
  const catRanks: Array<number | null> = [];
  let catTok = 0;
  for (const q of queries) {
    const top = searchIndex(q.query, scanner, [], K)
      .map((h) => (h.endpoint_id ? epById.get(h.endpoint_id) : undefined))
      .filter((e): e is EndpointRecord => !!e);
    const ids = top.map((e) => e.id);
    catRanks.push(taskRank(ids, expectedEndpointId(q.expect_endpoint), q.expect_intent, epById, K));
    catTok += tokEst(payloadCandidates(top));
  }
  reports.push({ method: "catalog", represents: "third-party scanner registry, keyword (consolidated)", metric: "task-level", queries: n, ...score(catRanks), tool_calls: 2, avg_tokens: Math.round(catTok / n) });

  // --- live-registry: a LIVE external registry (opt-in; literal golden-URL floor) ---
  // Opt-in: its endpoints aren't in our golden set, so this is a cross-corpus floor,
  // not a fair comparison. Its *technique* is fairly measured by spec-embedding.
  if (opts.live === true) {
    try {
      const liveRanks: Array<number | null> = [];
      let liveTok = 0;
      for (const q of queries) {
        const hits = await searchLiveRegistry(q.query, K);
        liveRanks.push(rankExternalHits(hits, q.expect_endpoint));
        liveTok += tokEst(hits.map((h) => `${h.resource ?? ""} — ${h.description ?? ""}`).join("\n"));
        await new Promise((r) => setTimeout(r, 100));
      }
      reports.push({ method: "live-registry", represents: "LIVE external registry API", metric: "literal-url", queries: n, ...score(liveRanks), tool_calls: 2, avg_tokens: Math.round(liveTok / n) });
    } catch (err) {
      reports.push({ method: "live-registry", represents: `live registry — unavailable (${err instanceof Error ? err.message : String(err)})`, metric: "literal-url", queries: 0, disc_at_1: 0, disc_at_3: 0, mrr: 0, tool_calls: 2, avg_tokens: 0 });
    }
  }

  return reports;
}

export function formatMethodTable(reports: MethodReport[]): string {
  const lines = [
    "Discovery-method comparison — hand-labeled NL queries, top-10",
    "",
    ["method".padEnd(16), "disc@1".padEnd(8), "disc@3".padEnd(8), "MRR".padEnd(7), "tools".padEnd(6), "tokens".padEnd(7), "metric".padEnd(12), "represents"].join(" "),
    "-".repeat(104),
  ];
  for (const r of reports) {
    lines.push([
      r.method.padEnd(16),
      `${r.disc_at_1.toFixed(1)}%`.padEnd(8),
      `${r.disc_at_3.toFixed(1)}%`.padEnd(8),
      r.mrr.toFixed(3).padEnd(7),
      String(r.tool_calls).padEnd(6),
      String(r.avg_tokens).padEnd(7),
      r.metric.padEnd(12),
      r.represents,
    ].join(" "));
  }
  lines.push(
    "",
    "tools  = round-trips to an invocable endpoint (oasis_find returns price+rails inline = 1 hop).",
    "tokens = avg discovery-payload tokens the agent reads (≈ chars/4); end-to-end agent cost is the LLM probe.",
    "task-level: top-k holds the golden endpoint OR an endpoint bound to the expected task intent.",
    "literal-url: golden-URL match only — a strict cross-corpus floor (live external registry).",
  );
  return lines.join("\n");
}
