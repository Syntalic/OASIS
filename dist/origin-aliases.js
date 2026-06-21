/** Known origin migrations — old registry URLs map to current production origins. */
export const ORIGIN_ALIASES = {
    "https://api.crushrewards.dev": "https://api.syntalic.com",
};
export function canonicalOrigin(url) {
    const normalized = url.replace(/\/$/, "");
    return ORIGIN_ALIASES[normalized] ?? normalized;
}
export function canonicalResourceUrl(url) {
    try {
        const u = new URL(url);
        const origin = canonicalOrigin(u.origin);
        return `${origin}${u.pathname}${u.search}`;
    }
    catch {
        return url;
    }
}
//# sourceMappingURL=origin-aliases.js.map