/**
 * Shared entity port-matching primitive for E1, the traversal engine, and tests.
 * v1: exact identity match or one-hop parent only (no transitive abstract climb).
 */

export interface SubtypeClosure {
  /** entity → canonical parent (one hop) */
  parentOf: Record<string, string>;
  /** canonical parent → all entities that match it (self + children) */
  expands: Record<string, string[]>;
}

export const V1_BRIDGE_IDENTITIES = [
  "Place",
  "ProductCategory",
  "Company",
  "Person",
  "Domain",
] as const;

export type V1BridgeIdentity = (typeof V1_BRIDGE_IDENTITIES)[number];

export function buildSubtypeClosure(
  subtypes: Record<string, { parent: string }>,
): SubtypeClosure {
  const parentOf: Record<string, string> = {};
  for (const [child, { parent }] of Object.entries(subtypes)) {
    parentOf[child] = parent;
  }

  const expands: Record<string, string[]> = {};
  const all = new Set<string>(Object.keys(parentOf));
  for (const p of Object.values(parentOf)) all.add(p);

  for (const canonical of all) {
    const members = [canonical];
    for (const [child, parent] of Object.entries(parentOf)) {
      if (parent === canonical) members.push(child);
    }
    expands[canonical] = members;
  }
  return { parentOf, expands };
}

/** held entity matches consumer port entity */
export function entityMatches(
  held: string,
  port: string,
  closure: SubtypeClosure,
): boolean {
  if (held === port) return true;
  return closure.parentOf[held] === port;
}

export function matchKind(
  held: string,
  port: string,
  closure: SubtypeClosure,
): "exact" | "parent" | null {
  if (held === port) return "exact";
  if (closure.parentOf[held] === port) return "parent";
  return null;
}

export function isV1BridgeEntity(entity: string, bridgeEligible: string[]): boolean {
  return bridgeEligible.includes(entity) && V1_BRIDGE_IDENTITIES.includes(entity as V1BridgeIdentity);
}