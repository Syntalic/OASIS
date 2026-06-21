import type { IndexBundle } from "./types.js";
export interface BuildOptions {
    paySkillsDir?: string;
    openapiFile?: string;
    origin?: string;
    outputDir?: string;
    ontologyDir?: string;
    /** Ingest x402scan.com server sitemap + per-origin OpenAPI (default: true). */
    x402scan?: boolean;
    /** Ingest mppscan.com server sitemap + mpp.dev catalog (default: true). */
    mppscan?: boolean;
    maxScanServers?: number;
    skipPaySkills?: boolean;
}
export declare function buildIndex(options?: BuildOptions): Promise<IndexBundle>;
export declare function defaultPaySkillsPath(): string | undefined;
