import type { EndpointRecord } from "../types.js";
export interface ScanIngestOptions {
    sitemapUrl: string;
    sourceName: "x402scan" | "mppscan";
    builtAt: string;
    concurrency?: number;
    maxServers?: number;
    fetchOpenApi?: boolean;
}
export declare function loadSitemapServerUrls(sitemapUrl: string): Promise<string[]>;
export declare function ingestScanSitemap(options: ScanIngestOptions): Promise<{
    endpoints: EndpointRecord[];
    servers: number;
    origins: number;
}>;
