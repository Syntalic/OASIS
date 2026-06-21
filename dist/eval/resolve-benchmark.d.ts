import type { CapabilityIntent, IndexBundle, SatisfiesRef } from "../types.js";
export interface ResolveResult {
    intent_id: string;
    label: string;
    primary_ref: SatisfiesRef;
    resolved: boolean;
    endpoint_id: string | null;
}
export interface ResolveBenchmarkReport {
    total: number;
    resolved: number;
    missing: number;
    results: ResolveResult[];
}
export declare function loadCuratedIntents(): Promise<CapabilityIntent[]>;
export declare function evaluateResolveAccuracy(bundle: IndexBundle, intents: CapabilityIntent[]): ResolveBenchmarkReport;
export declare function runResolveBenchmark(bundle: IndexBundle): Promise<ResolveBenchmarkReport>;
export declare function formatResolveReport(report: ResolveBenchmarkReport): string;
