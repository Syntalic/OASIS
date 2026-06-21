/** Known origin migrations — old registry URLs map to current production origins. */
export declare const ORIGIN_ALIASES: Record<string, string>;
export declare function canonicalOrigin(url: string): string;
export declare function canonicalResourceUrl(url: string): string;
