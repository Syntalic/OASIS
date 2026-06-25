import { endpointId } from "../core/id.js";
import { canonicalOrigin } from "../ingest/origin-aliases.js";
import type { EvalQuery } from "./discovery-benchmark.js";

export interface ParsedEndpointRef {
  origin: string;
  method: string;
  path: string;
}

export function parseResourceUrl(
  resource: string,
  method = "GET",
): ParsedEndpointRef | null {
  try {
    const u = new URL(resource);
    const origin = canonicalOrigin(u.origin);
    const path = u.pathname || "/";
    return {
      origin,
      method: method.toUpperCase(),
      path: path.startsWith("/") ? path : `/${path}`,
    };
  } catch {
    return null;
  }
}

export function endpointRefId(ref: ParsedEndpointRef): string {
  return endpointId(ref.origin, ref.method, ref.path);
}

export function matchesExpectedEndpoint(
  hit: ParsedEndpointRef,
  expected: NonNullable<EvalQuery["expect_endpoint"]>,
): boolean {
  const expectedOrigin = canonicalOrigin(expected.origin.replace(/\/$/, ""));
  const hitOrigin = canonicalOrigin(hit.origin);
  const expectedPath = expected.path.startsWith("/")
    ? expected.path
    : `/${expected.path}`;
  const hitPath = hit.path.startsWith("/") ? hit.path : `/${hit.path}`;

  return (
    hitOrigin === expectedOrigin &&
    hit.method === expected.method.toUpperCase() &&
    hitPath === expectedPath
  );
}

export function rankExternalHits(
  hits: ParsedEndpointRef[],
  expected: EvalQuery["expect_endpoint"],
): number | null {
  if (!expected) return null;
  const idx = hits.findIndex((h) => matchesExpectedEndpoint(h, expected));
  return idx >= 0 ? idx + 1 : null;
}