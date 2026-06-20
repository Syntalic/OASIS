import { createHash } from "node:crypto";
export function endpointId(origin, method, path) {
    const normalizedOrigin = origin.replace(/\/$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const key = `${normalizedOrigin}|${method.toUpperCase()}|${normalizedPath}`;
    return createHash("sha256").update(key).digest("hex");
}
export function endpointKey(origin, method, path) {
    return `${origin.replace(/\/$/, "")}|${method.toUpperCase()}|${path}`;
}
//# sourceMappingURL=id.js.map