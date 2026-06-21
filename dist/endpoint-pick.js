const GENERIC_SUMMARY = /^(authenticate|prove action|delete a memory|get mcp|api info|free health|x402 defi)/i;
const GENERIC_PATH = /\/(health|authenticate|auth|prove|memory|mcp-tools|api-info|defi-nontokenized)(\/|$)/i;
const PROVIDER_PATH_PREFERENCES = {
    "crushrewards/pricing": [
        /\/v1\/shopper\/best-price/,
        /\/v1\/shopper\/deal-finder/,
        /\/v1\/shopper\/price-history/,
    ],
    "agentmail/email": [/\/v0\/inboxes$/],
    "quicknode/rpc": [/\/solana-mainnet\/?$/, /\/ethereum-mainnet\/?$/],
    "merit-systems/stablecrypto/market-data": [/\/api\/coingecko\/price/],
    "merit-systems/stableemail/email": [/\/api\/send$/],
    "merit-systems/stablephone/calls": [/\/api\/call$/],
    "merit-systems/stableenrich/enrichment": [/\/api\/exa\/search/],
    "paysponge/fal": [/\/fal-ai\/fast-sdxl/],
    "paysponge/perplexity": [/\/v1\/async\/sonar/],
    "paysponge/screenshotone": [/\/take$/],
    "paysponge/rentcast": [/\/listings\/sale/],
    "paysponge/2captcha": [/\/createTask/],
    "socialintel/influencer-search": [/\/v1\/search$/],
};
const MPP_SERVICE_PATH_PREFERENCES = {
    "abstract-company-enrichment": [/lookup/],
    "abstract-web-scraping": [/scrape/],
    "agentfax": [/\/v1\/fax/],
    "anthropic": [/messages/],
    "deepgram": [/transcri/],
    "deepl": [/translate/],
};
function tokenize(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9._\s-]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2);
}
function isGenericEndpoint(ep) {
    if (GENERIC_SUMMARY.test(ep.summary))
        return true;
    if (GENERIC_PATH.test(ep.path))
        return true;
    if (/^lookup$/i.test(ep.summary) && ep.path.split("/").length > 4)
        return false;
    return false;
}
function useCaseOverlap(provider, ep) {
    if (!provider?.use_case)
        return 0;
    const useTokens = new Set(tokenize(provider.use_case));
    const epTokens = tokenize(`${ep.summary} ${ep.description ?? ""} ${ep.path} ${ep.tags?.join(" ") ?? ""}`);
    let hits = 0;
    for (const t of epTokens) {
        if (useTokens.has(t))
            hits += 1;
    }
    return hits;
}
function pathPreferenceScore(ep, preferences) {
    for (let i = 0; i < preferences.length; i++) {
        if (preferences[i].test(ep.path))
            return preferences.length - i;
    }
    return 0;
}
export function scoreEndpointPrimary(ep, provider, serviceId) {
    if (isGenericEndpoint(ep))
        return -100;
    let score = 0;
    if (ep.description)
        score += 3;
    if (ep.inputs?.length)
        score += Math.min(ep.inputs.length, 5);
    if (ep.payment.price_usd != null)
        score += 2;
    if (ep.payment.paid)
        score += 1;
    if (ep.guidance_available)
        score += 2;
    const depth = ep.path.split("/").filter(Boolean).length;
    score += Math.max(0, 6 - depth);
    if (provider) {
        score += useCaseOverlap(provider, ep) * 2;
        const prefs = PROVIDER_PATH_PREFERENCES[provider.fqn];
        if (prefs)
            score += pathPreferenceScore(ep, prefs) * 5;
    }
    if (serviceId) {
        const prefs = MPP_SERVICE_PATH_PREFERENCES[serviceId];
        if (prefs)
            score += pathPreferenceScore(ep, prefs) * 5;
    }
    if (/^get /i.test(ep.summary) && ep.summary.length < 16)
        score -= 1;
    return score;
}
export function pickPrimaryEndpoints(endpoints, options = {}) {
    const max = options.max ?? 3;
    const paid = endpoints.filter((e) => e.payment.paid || e.payment.rails.length);
    const pool = paid.length ? paid : endpoints;
    return [...pool]
        .sort((a, b) => scoreEndpointPrimary(b, options.provider, options.serviceId) -
        scoreEndpointPrimary(a, options.provider, options.serviceId))
        .slice(0, max);
}
//# sourceMappingURL=endpoint-pick.js.map