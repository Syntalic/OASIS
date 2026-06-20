import type { EndpointRecord, PaySkillsProvider } from "./types.js";
interface OpenApiDoc {
    openapi?: string;
    servers?: Array<{
        url: string;
    }>;
    info?: {
        title?: string;
        description?: string;
        "x-guidance"?: string;
        "x-agent-guidance"?: string;
        guidance?: string;
    };
    paths?: Record<string, Record<string, unknown>>;
    "x-faremeter-assets"?: Record<string, {
        chain?: string;
    }>;
}
export declare function parseOpenApi(doc: OpenApiDoc, options: {
    origin?: string;
    provider?: PaySkillsProvider;
    builtAt: string;
    capabilityIds?: string[];
}): EndpointRecord[];
export {};
