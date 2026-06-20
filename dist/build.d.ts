import type { IndexBundle } from "./types.js";
export interface BuildOptions {
    paySkillsDir?: string;
    openapiFile?: string;
    origin?: string;
    outputDir?: string;
    ontologyDir?: string;
}
export declare function buildIndex(options?: BuildOptions): Promise<IndexBundle>;
export declare function defaultPaySkillsPath(): string | undefined;
