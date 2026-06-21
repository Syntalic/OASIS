import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { endpointId } from "../id.js";
import { searchIndex } from "../search.js";
import type {
  CapabilityIntent,
  EndpointRecord,
  IndexBundle,
  SearchHit,
} from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..", "..");

export interface EvalQuery {
  id: string;
  query: string;
  expect_intent?: string;
  expect_endpoint?: {
    origin: string;
    method: string;
    path: string;
  };
}

export type SearchMode =
  | "full"
  | "endpoints-only"
  | "providers-only"
  | "pay-skills-only"
  | "x402scan-only"
  | "mpp-only";

export type BenchmarkMode =
  | SearchMode
  | "cdp-bazaar"
  | "mpp-catalog-live"
  | "full-hybrid";

export interface QueryResult {
  id: string;
  query: string;
  mode: BenchmarkMode;
  /** Correct task intent at rank 1. */
  task_hit: boolean;
  task_rank: number | null;
  /** Correct endpoint row directly at rank 1. */
  literal_hit: boolean;
  literal_rank: number | null;
  /** Correct API via search → resolve at rank 1. */
  discover_hit: boolean;
  discover_rank: number | null;
  top_label: string | null;
}

export interface BenchmarkReport {
  mode: BenchmarkMode;
  queries: number;
  task_queries: number;
  api_queries: number;
  task_hit_at_1: number;
  task_hit_at_3: number;
  task_hit_at_5: number;
  literal_hit_at_1: number;
  literal_hit_at_3: number;
  literal_hit_at_5: number;
  discover_hit_at_1: number;
  discover_hit_at_3: number;
  task_mrr: number;
  literal_mrr: number;
  discover_mrr: number;
  results: QueryResult[];
}

export function expectedEndpointId(
  expect: EvalQuery["expect_endpoint"],
): string | null {
  if (!expect) return null;
  return endpointId(expect.origin, expect.method, expect.path);
}

// The provider "corpus" depends only on the bundle, so build it once per bundle
// instead of rebuilding it for every query in the providers-only sweep.
const providerCorpusCache = new WeakMap<IndexBundle, EndpointRecord[]>();

function providerCorpus(bundle: IndexBundle): EndpointRecord[] {
  const cached = providerCorpusCache.get(bundle);
  if (cached) return cached;

  let corpus: EndpointRecord[];
  if (bundle.providers?.length) {
    corpus = bundle.providers.map((p) => ({
      id: p.fqn,
      origin: p.service_url,
      method: "GET",
      path: "/",
      summary: p.title,
      description: p.description,
      provider_fqn: p.fqn,
      provider_title: p.title,
      category: p.category,
      payment: { paid: true, rails: p.payment_rails.map((r) => ({ protocol: r as "x402" | "mpp" })) },
      search_text: p.search_text,
      built_at: bundle.built_at,
    }));
  } else {
    const byProvider = new Map<string, EndpointRecord>();
    for (const ep of bundle.endpoints) {
      const key = ep.provider_fqn ?? ep.origin;
      if (!byProvider.has(key)) byProvider.set(key, ep);
    }
    corpus = [...byProvider.values()].map((ep) => ({
      ...ep,
      search_text: [ep.provider_fqn, ep.provider_title, ep.category, ep.origin]
        .filter(Boolean)
        .join(" "),
    }));
  }

  providerCorpusCache.set(bundle, corpus);
  return corpus;
}

function searchProvidersOnly(
  query: string,
  bundle: IndexBundle,
  limit: number,
): SearchHit[] {
  return searchIndex(query, providerCorpus(bundle), [], limit).map((h) => ({
    ...h,
    kind: "endpoint" as const,
  }));
}

function runSearch(
  query: string,
  bundle: IndexBundle,
  mode: SearchMode,
  limit = 10,
): SearchHit[] {
  let endpoints = bundle.endpoints;
  let capabilities = bundle.capabilities;

  if (mode === "pay-skills-only") {
    endpoints = endpoints.filter(
      (e) =>
        e.provider_fqn &&
        !e.provider_fqn.startsWith("x402scan/") &&
        !e.provider_fqn.startsWith("mppscan/") &&
        !e.provider_fqn.startsWith("mpp-catalog/"),
    );
  } else if (mode === "x402scan-only") {
    endpoints = endpoints.filter((e) =>
      e.provider_fqn?.startsWith("x402scan/"),
    );
  } else if (mode === "mpp-only") {
    endpoints = endpoints.filter(
      (e) =>
        e.provider_fqn?.startsWith("mppscan/") ||
        e.provider_fqn?.startsWith("mpp-catalog/"),
    );
  }

  switch (mode) {
    case "endpoints-only":
    case "pay-skills-only":
    case "x402scan-only":
    case "mpp-only":
      return searchIndex(query, endpoints, [], limit);
    case "providers-only":
      return searchProvidersOnly(query, bundle, limit);
    default:
      return searchIndex(query, endpoints, capabilities, limit);
  }
}

export function rankIntent(hits: SearchHit[], intentId: string): number | null {
  const idx = hits.findIndex((h) => h.capability_id === intentId);
  return idx >= 0 ? idx + 1 : null;
}

export function rankEndpoint(
  hits: SearchHit[],
  endpointIdExpected: string,
): number | null {
  const idx = hits.findIndex((h) => h.endpoint_id === endpointIdExpected);
  return idx >= 0 ? idx + 1 : null;
}

export function resolveIntentToEndpointIds(
  intent: CapabilityIntent,
  endpoints: EndpointRecord[],
): string[] {
  return intent.satisfies
    .map((ref) => endpointId(ref.origin, ref.method, ref.path))
    .filter((id) => endpoints.some((e) => e.id === id));
}

export function discoverRank(
  hits: SearchHit[],
  expectedIntent: string | undefined,
  expectedEndpointId: string | null,
  capabilities: CapabilityIntent[],
  endpoints: EndpointRecord[],
): number | null {
  if (!expectedEndpointId) return null;

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (hit.endpoint_id === expectedEndpointId) return i + 1;
    if (hit.capability_id) {
      const intent = capabilities.find((c) => c.id === hit.capability_id);
      if (intent) {
        const resolved = resolveIntentToEndpointIds(intent, endpoints);
        if (resolved.includes(expectedEndpointId)) return i + 1;
      }
    }
  }
  return null;
}

export function mrr(ranks: Array<number | null>): number {
  const scored = ranks.filter((r): r is number => r != null);
  if (!scored.length) return 0;
  return scored.reduce((sum, r) => sum + 1 / r, 0) / ranks.length;
}

export function hitAt(ranks: Array<number | null>, k: number): number {
  return ranks.filter((r) => r != null && r <= k).length;
}

export interface ReportRanks {
  task: Array<number | null>;
  literal: Array<number | null>;
  discover: Array<number | null>;
}

/** Single source of truth for the BenchmarkReport metric block. */
export function buildReport(
  mode: BenchmarkMode,
  queries: EvalQuery[],
  results: QueryResult[],
  ranks: ReportRanks,
): BenchmarkReport {
  const withIntent = queries.filter((q) => q.expect_intent).length;
  const withEndpoint = queries.filter((q) => q.expect_endpoint).length;

  return {
    mode,
    queries: queries.length,
    task_queries: withIntent,
    api_queries: withEndpoint,
    task_hit_at_1: withIntent ? hitAt(ranks.task, 1) : 0,
    task_hit_at_3: withIntent ? hitAt(ranks.task, 3) : 0,
    task_hit_at_5: withIntent ? hitAt(ranks.task, 5) : 0,
    literal_hit_at_1: withEndpoint ? hitAt(ranks.literal, 1) : 0,
    literal_hit_at_3: withEndpoint ? hitAt(ranks.literal, 3) : 0,
    literal_hit_at_5: withEndpoint ? hitAt(ranks.literal, 5) : 0,
    discover_hit_at_1: withEndpoint ? hitAt(ranks.discover, 1) : 0,
    discover_hit_at_3: withEndpoint ? hitAt(ranks.discover, 3) : 0,
    task_mrr: mrr(ranks.task),
    literal_mrr: mrr(ranks.literal),
    discover_mrr: mrr(ranks.discover),
    results,
  };
}

export function evaluateMode(
  queries: EvalQuery[],
  bundle: IndexBundle,
  mode: SearchMode,
): BenchmarkReport {
  const results: QueryResult[] = [];
  const taskRanks: Array<number | null> = [];
  const literalRanks: Array<number | null> = [];
  const discoverRanks: Array<number | null> = [];

  for (const q of queries) {
    const hits = runSearch(q.query, bundle, mode, 10);
    const expectedId = expectedEndpointId(q.expect_endpoint);

    const intentRank = q.expect_intent
      ? rankIntent(hits, q.expect_intent)
      : null;
    const endpointRank = expectedId ? rankEndpoint(hits, expectedId) : null;
    const discover = discoverRank(
      hits,
      q.expect_intent,
      expectedId,
      bundle.capabilities,
      bundle.endpoints,
    );

    if (q.expect_intent) taskRanks.push(intentRank);
    if (expectedId) {
      literalRanks.push(endpointRank);
      discoverRanks.push(discover);
    }

    results.push({
      id: q.id,
      query: q.query,
      mode,
      task_hit: intentRank === 1,
      task_rank: intentRank,
      literal_hit: endpointRank === 1,
      literal_rank: endpointRank,
      discover_hit: discover === 1,
      discover_rank: discover,
      top_label: hits[0]?.label ?? null,
    });
  }

  return buildReport(mode, queries, results, {
    task: taskRanks,
    literal: literalRanks,
    discover: discoverRanks,
  });
}

export async function loadEvalQueries(): Promise<EvalQuery[]> {
  const raw = await readFile(
    path.join(PACKAGE_ROOT, "eval", "queries.json"),
    "utf8",
  );
  return JSON.parse(raw) as EvalQuery[];
}

export async function runDiscoveryBenchmark(
  bundle: IndexBundle,
  modes: SearchMode[] = [
    "full",
    "endpoints-only",
    "providers-only",
    "pay-skills-only",
  ],
): Promise<BenchmarkReport[]> {
  const queries = await loadEvalQueries();
  return modes.map((mode) => evaluateMode(queries, bundle, mode));
}

export function formatReportTable(reports: BenchmarkReport[]): string {
  const header = [
    "mode".padEnd(18),
    "task@1".padEnd(10),
    "disc@1".padEnd(8),
    "disc@3".padEnd(8),
    "lit@3".padEnd(8),
    "disc MRR".padEnd(9),
  ].join(" ");

  const lines = [header, "-".repeat(header.length)];
  for (const r of reports) {
    lines.push(
      [
        r.mode.padEnd(18),
        `${r.task_hit_at_1}/${r.task_queries}`.padEnd(10),
        `${r.discover_hit_at_1}/${r.api_queries}`.padEnd(8),
        `${r.discover_hit_at_3}/${r.api_queries}`.padEnd(8),
        `${r.literal_hit_at_3}/${r.api_queries}`.padEnd(8),
        r.discover_mrr.toFixed(3).padEnd(9),
      ].join(" "),
    );
  }
  return lines.join("\n");
}