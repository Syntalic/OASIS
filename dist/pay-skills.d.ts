import type { EndpointRecord, PaySkillsProvider } from "./types.js";
export declare function ingestPaySkills(paySkillsDir: string, builtAt: string): Promise<{
    providers: PaySkillsProvider[];
    endpoints: EndpointRecord[];
}>;
