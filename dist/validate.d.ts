import type { CuratedIntentSource, IndexBundle } from "./types.js";
export declare function loadSchemas(): Promise<{
    validateIndex: (data: unknown) => boolean;
    validateEndpoint: (data: unknown) => boolean;
    validateCapability: (data: unknown) => boolean;
    errors: () => string[];
}>;
export declare function validateBundle(bundle: IndexBundle): Promise<string[]>;
export interface IntegrityIssue {
    level: "warning";
    kind: "dangling_link" | "dangling_related" | "unknown_entity" | "asymmetric_link" | "self_link" | "pipes_to_flow";
    intent_id: string;
    detail: string;
}
export interface IntegrityReport {
    intents: number;
    links_checked: number;
    related_checked: number;
    ports_checked: number;
    issues: IntegrityIssue[];
    counts: Record<IntegrityIssue["kind"], number>;
}
/**
 * Resolve every link/related/port reference against the in-file id set and the
 * entity vocabulary; enforce symmetry for symmetric link types; lint pipes_to
 * flow-consistency where producer/consumer ports exist. WARN only.
 */
export declare function checkReferentialIntegrity(sources: CuratedIntentSource[], vocab: Set<string>): Promise<IntegrityReport>;
export declare function runReferentialIntegrity(intentsDir?: string): Promise<IntegrityReport>;
export declare function formatIntegrityReport(report: IntegrityReport): string;
