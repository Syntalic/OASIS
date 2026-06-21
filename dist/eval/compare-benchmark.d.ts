import { type BenchmarkMode, type BenchmarkReport } from "./discovery-benchmark.js";
import type { IndexBundle } from "../types.js";
export type DiscoveryMethod = BenchmarkMode;
export interface CompareOptions {
    methods?: DiscoveryMethod[];
    distDir?: string;
    offline?: boolean;
    bazaarDelayMs?: number;
}
/** Every method eval:compare accepts (superset of DEFAULT_METHODS). */
export declare const VALID_METHODS: ReadonlySet<DiscoveryMethod>;
export declare function runCompareBenchmark(bundle: IndexBundle, options?: CompareOptions): Promise<BenchmarkReport[]>;
export declare function formatCompareTable(reports: BenchmarkReport[]): string;
