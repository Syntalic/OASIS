import type { CapabilityIntent, EndpointRecord, IndexBundle, SearchHit } from "../types.js";
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
export type SearchMode = "full" | "endpoints-only" | "providers-only" | "pay-skills-only" | "x402scan-only" | "mpp-only";
export type BenchmarkMode = SearchMode | "cdp-bazaar" | "mpp-catalog-live" | "full-hybrid";
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
    /** Neutral selection policy ranks expected endpoint at rank 1. */
    select_hit: boolean;
    select_rank: number | null;
    top_label: string | null;
}
export interface BenchmarkReport {
    mode: BenchmarkMode;
    queries: number;
    task_queries: number;
    api_queries: number;
    select_queries: number;
    task_hit_at_1: number;
    task_hit_at_3: number;
    task_hit_at_5: number;
    literal_hit_at_1: number;
    literal_hit_at_3: number;
    literal_hit_at_5: number;
    discover_hit_at_1: number;
    discover_hit_at_3: number;
    select_hit_at_1: number;
    select_hit_at_3: number;
    task_mrr: number;
    literal_mrr: number;
    discover_mrr: number;
    select_mrr: number;
    results: QueryResult[];
}
export declare function expectedEndpointId(expect: EvalQuery["expect_endpoint"]): string | null;
export declare function rankIntent(hits: SearchHit[], intentId: string): number | null;
export declare function rankEndpoint(hits: SearchHit[], endpointIdExpected: string): number | null;
export declare function resolveIntentToEndpointIds(intent: CapabilityIntent, endpoints: EndpointRecord[]): string[];
/**
 * Discover rank: agent finds the right task and at least one viable paid API.
 * Does not require a specific vendor endpoint — that is measured by select@k.
 */
export declare function discoverRank(hits: SearchHit[], expectedIntent: string | undefined, expectedEndpointId: string | null, capabilities: CapabilityIntent[], endpoints: EndpointRecord[]): number | null;
export declare function mrr(ranks: Array<number | null>): number;
export declare function hitAt(ranks: Array<number | null>, k: number): number;
export interface ReportRanks {
    task: Array<number | null>;
    literal: Array<number | null>;
    discover: Array<number | null>;
    select: Array<number | null>;
}
/** Single source of truth for the BenchmarkReport metric block. */
export declare function buildReport(mode: BenchmarkMode, queries: EvalQuery[], results: QueryResult[], ranks: ReportRanks): BenchmarkReport;
export declare function evaluateMode(queries: EvalQuery[], bundle: IndexBundle, mode: SearchMode): BenchmarkReport;
export declare function loadEvalQueries(): Promise<EvalQuery[]>;
export declare function runDiscoveryBenchmark(bundle: IndexBundle, modes?: SearchMode[]): Promise<BenchmarkReport[]>;
export declare function formatReportTable(reports: BenchmarkReport[]): string;
