import type { IndexBundle } from "./types.js";
export declare function loadSchemas(): Promise<{
    validateIndex: (data: unknown) => boolean;
    validateEndpoint: (data: unknown) => boolean;
    validateCapability: (data: unknown) => boolean;
    errors: () => string[];
}>;
export declare function validateBundle(bundle: IndexBundle): Promise<string[]>;
