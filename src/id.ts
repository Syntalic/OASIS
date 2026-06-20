import { createHash } from "node:crypto";

export function endpointId(
  origin: string,
  method: string,
  path: string,
): string {
  const normalizedOrigin = origin.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const key = `${normalizedOrigin}|${method.toUpperCase()}|${normalizedPath}`;
  return createHash("sha256").update(key).digest("hex");
}

export function endpointKey(
  origin: string,
  method: string,
  path: string,
): string {
  return `${origin.replace(/\/$/, "")}|${method.toUpperCase()}|${path}`;
}