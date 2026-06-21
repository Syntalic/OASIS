import { type HybridFusionOptions } from "../search-hybrid.js";
import { type BenchmarkMode, type BenchmarkReport, type EvalQuery, type QueryResult } from "./discovery-benchmark.js";
import type { IndexBundle } from "../types.js";
export declare function loadMessyQueries(): Promise<EvalQuery[]>;
export declare function evaluateHybridMode(queries: EvalQuery[], bundle: IndexBundle, lanceDir: string | null, fusion?: HybridFusionOptions, reportMode?: BenchmarkMode): Promise<BenchmarkReport>;
export declare function evaluateKeywordOnly(queries: EvalQuery[], bundle: IndexBundle): BenchmarkReport;
export interface HybridComparison {
    baseline: BenchmarkReport;
    hybrid: BenchmarkReport;
    improved: QueryResult[];
    regressed: QueryResult[];
}
export declare function compareReports(baseline: BenchmarkReport, hybrid: BenchmarkReport): HybridComparison;
export declare function formatHybridComparison(cmp: HybridComparison, fusion?: HybridFusionOptions): string;
export declare function runHybridMvp(bundle: IndexBundle, distDir: string, fusion?: HybridFusionOptions): Promise<HybridComparison>;
export declare function verifyMessyQueries(bundle: IndexBundle): Promise<string[]>;
