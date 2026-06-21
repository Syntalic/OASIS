import { parseOpenApi } from "./openapi-parser.js";
const OPENAPI_PATHS = [
    "/openapi.json",
    "/openapi.yaml",
    "/api/openapi.json",
    "/v1/openapi.json",
    "/swagger.json",
    "/api-docs/openapi.json",
    "/doc/openapi.json",
    "/.well-known/openapi.json",
];
const FETCH_HEADERS = {
    Accept: "application/json, application/yaml, text/yaml, */*",
    "User-Agent": "paid-api-graph/0.1 (+https://github.com/paid-api-graph)",
};
export function openapiCandidates(origin) {
    const base = origin.replace(/\/$/, "");
    return OPENAPI_PATHS.map((p) => `${base}${p}`);
}
function parseOpenApiBody(text, contentType) {
    const trimmed = text.trim();
    if (!trimmed)
        return null;
    if (contentType.includes("yaml") ||
        trimmed.startsWith("openapi:") ||
        trimmed.startsWith("swagger:")) {
        return null;
    }
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return null;
    }
}
export async function fetchOpenApiForOrigin(origin, builtAt, timeoutMs = 15_000) {
    for (const url of openapiCandidates(origin)) {
        try {
            const res = await fetch(url, {
                headers: FETCH_HEADERS,
                signal: AbortSignal.timeout(timeoutMs),
                redirect: "follow",
            });
            if (!res.ok)
                continue;
            const contentType = res.headers.get("content-type") ?? "";
            const text = await res.text();
            const doc = parseOpenApiBody(text, contentType);
            if (!doc?.paths)
                continue;
            const endpoints = parseOpenApi(doc, { origin, builtAt });
            if (endpoints.length === 0)
                continue;
            for (const ep of endpoints) {
                ep.openapi_url = url;
            }
            return { endpoints, openapi_url: url };
        }
        catch {
            /* try next candidate */
        }
    }
    return { endpoints: [] };
}
export function isStubEndpoint(ep) {
    if (ep.description)
        return false;
    if (ep.inputs?.length)
        return false;
    if (ep.operation_id)
        return false;
    if (ep.payment.price_usd != null)
        return false;
    const stubSummary = `${ep.method} ${ep.path}`;
    return ep.summary === stubSummary || ep.summary.length < 20;
}
//# sourceMappingURL=openapi-fetch.js.map