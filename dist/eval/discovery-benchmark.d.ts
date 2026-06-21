import type { IndexBundle } from "../types.js";
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
export type SearchMode = "full" | "endpoints-only" | "providers-only" | "pay-skills-only";
export interface QueryResult {
    id: string;
    query: string;
    mode: SearchMode;
    intent_hit: boolean;
    intent_rank: number | null;
    endpoint_hit: boolean;
    endpoint_rank: number | null;
    /** Endpoint found via search OR by resolving a top-k capability intent. */
    workflow_hit: boolean;
    workflow_rank: number | null;
    top_label: string | null;
}
export interface BenchmarkReport {
    mode: SearchMode;
    queries: number;
    intent_queries: number;
    endpoint_queries: number;
    intent_hit_at_1: number;
    intent_hit_at_3: number;
    intent_hit_at_5: number;
    endpoint_hit_at_1: number;
    endpoint_hit_at_3: number;
    endpoint_hit_at_5: number;
    /** search → resolve workflow (the intended agent protocol). */
    workflow_hit_at_1: number;
    workflow_hit_at_3: number;
    intent_mrr: number;
    endpoint_mrr: number;
    workflow_mrr: number;
    results: QueryResult[];
}
export declare function evaluateMode(queries: EvalQuery[], bundle: IndexBundle, mode: SearchMode): BenchmarkReport;
export declare function loadEvalQueries(): Promise<EvalQuery[]>;
export declare function runDiscoveryBenchmark(bundle: IndexBundle, modes?: SearchMode[]): Promise<BenchmarkReport[]>;
export declare function formatReportTable(reports: BenchmarkReport[]): string;
