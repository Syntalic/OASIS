import { endpointId } from "../id.js";
import { canonicalOrigin } from "../origin-aliases.js";
export function parseResourceUrl(resource, method = "GET") {
    try {
        const u = new URL(resource);
        const origin = canonicalOrigin(u.origin);
        const path = u.pathname || "/";
        return {
            origin,
            method: method.toUpperCase(),
            path: path.startsWith("/") ? path : `/${path}`,
        };
    }
    catch {
        return null;
    }
}
export function endpointRefId(ref) {
    return endpointId(ref.origin, ref.method, ref.path);
}
export function matchesExpectedEndpoint(hit, expected) {
    const expectedOrigin = canonicalOrigin(expected.origin.replace(/\/$/, ""));
    const hitOrigin = canonicalOrigin(hit.origin);
    const expectedPath = expected.path.startsWith("/")
        ? expected.path
        : `/${expected.path}`;
    const hitPath = hit.path.startsWith("/") ? hit.path : `/${hit.path}`;
    return (hitOrigin === expectedOrigin &&
        hit.method === expected.method.toUpperCase() &&
        hitPath === expectedPath);
}
export function rankExternalHits(hits, expected) {
    if (!expected)
        return null;
    const idx = hits.findIndex((h) => matchesExpectedEndpoint(h, expected));
    return idx >= 0 ? idx + 1 : null;
}
//# sourceMappingURL=url-match.js.map