import type { IndexBundle } from "../types.js";
export interface ResolveResult {
    intent_id: string;
    label: string;
    endpoint_count: number;
    resolved_count: number;
    resolved: boolean;
    sample_ref: string | null;
}
export interface ResolveBenchmarkReport {
    total: number;
    resolved: number;
    missing: number;
    total_endpoint_refs: number;
    resolved_endpoint_refs: number;
    results: ResolveResult[];
}
export declare function loadCuratedSources(): Promise<import("../types.js").CuratedIntentSource[]>;
export declare function evaluateResolveAccuracy(bundle: IndexBundle): ResolveBenchmarkReport;
export declare function runResolveBenchmark(bundle: IndexBundle): Promise<ResolveBenchmarkReport>;
export declare function formatResolveReport(report: ResolveBenchmarkReport): string;
