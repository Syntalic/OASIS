import * as lancedb from "@lancedb/lancedb";
import type { CapabilityIntent, IndexBundle } from "../types.js";
export declare const LANCE_TABLE = "search";
export interface LanceRecord {
    id: string;
    kind: "capability" | "endpoint";
    text: string;
    vector: number[];
}
export declare function capabilityEmbedText(cap: CapabilityIntent): string;
export type EmbedScope = "all" | "capabilities" | "curated";
export declare function buildLanceRecords(bundle: IndexBundle, scope?: EmbedScope, curatedIds?: Set<string>): LanceRecord[];
export declare function buildLanceIndex(bundle: IndexBundle, outputDir: string, scope?: EmbedScope): Promise<{
    records: number;
    table: string;
    path: string;
    scope: EmbedScope;
}>;
export declare function openLanceTable(lanceDir: string): Promise<lancedb.Table>;
export declare function defaultLanceDir(distDir: string): string;
