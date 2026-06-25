import { entityMatches } from "./entity-match.js";
import type { EntityIndex } from "./entity-index.js";
import type { CapabilityIntent, FacetDomain } from "../core/types.js";

export interface ForwardEdge {
  from: string;
  to: string;
  entity: string;
  match: "exact" | "parent";
  from_role?: string;
  to_role?: string;
}

export interface LateralEdge {
  entity: string;
  from_domain?: FacetDomain;
  to: string;
  to_domain?: FacetDomain;
  to_role?: string;
}

export interface EntityFlowArtifact {
  spec_version: string;
  forward: ForwardEdge[];
  lateral: LateralEdge[];
}

export function buildEntityFlow(
  capabilities: CapabilityIntent[],
  entityIndex: EntityIndex,
): EntityFlowArtifact {
  const closure = {
    parentOf: entityIndex.parent_of,
    expands: entityIndex.subtype_closure,
  };

  const byId = new Map(capabilities.map((c) => [c.id, c]));
  const forward: ForwardEdge[] = [];
  const lateral: LateralEdge[] = [];

  const bridgeSet = new Set(entityIndex.bridge_eligible);
  const observationSet = new Set(entityIndex.observation_entities);

  for (const a of capabilities) {
    const produced = new Set((a.produces ?? []).map((p) => p.entity));
    for (const b of capabilities) {
      if (a.id === b.id) continue;
      for (const prod of a.produces ?? []) {
        for (const cons of b.consumes ?? []) {
          if (!entityMatches(prod.entity, cons.entity, closure)) continue;
          if (prod.role === "constraint" || cons.role === "constraint") continue;
          forward.push({
            from: a.id,
            to: b.id,
            entity: cons.entity,
            match: prod.entity === cons.entity ? "exact" : "parent",
            from_role: prod.role,
            to_role: cons.role,
          });
        }
      }
    }
  }

  for (const heldEntity of entityIndex.bridge_eligible) {
    if (!bridgeSet.has(heldEntity) || observationSet.has(heldEntity)) continue;
    for (const b of capabilities) {
      for (const cons of b.consumes ?? []) {
        if (!entityMatches(heldEntity, cons.entity, closure)) continue;
        for (const a of capabilities) {
          const domainA = a.facets?.domain;
          const domainB = b.facets?.domain;
          if (domainA && domainB && domainA === domainB) continue;
          lateral.push({
            entity: heldEntity,
            from_domain: domainA,
            to: b.id,
            to_domain: domainB,
            to_role: cons.role,
          });
        }
      }
    }
  }

  // dedupe lateral
  const seen = new Set<string>();
  const dedupedLateral = lateral.filter((e) => {
    const k = `${e.entity}|${e.to}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    spec_version: "0.1.0",
    forward,
    lateral: dedupedLateral,
  };
}

/** Pre-index consumers by held entity for O(1) lateral lookup */
export function buildConsumersByEntity(
  capabilities: CapabilityIntent[],
  entityIndex: EntityIndex,
): Map<string, Array<{ intent_id: string; domain?: FacetDomain; role?: string; port_entity: string }>> {
  const closure = { parentOf: entityIndex.parent_of, expands: entityIndex.subtype_closure };
  const map = new Map<string, Array<{ intent_id: string; domain?: FacetDomain; role?: string; port_entity: string }>>();

  const register = (heldKey: string, entry: { intent_id: string; domain?: FacetDomain; role?: string; port_entity: string }) => {
    const list = map.get(heldKey) ?? [];
    if (!list.some((x) => x.intent_id === entry.intent_id && x.port_entity === entry.port_entity)) {
      list.push(entry);
      map.set(heldKey, list);
    }
  };

  for (const cap of capabilities) {
    for (const cons of cap.consumes ?? []) {
      register(cons.entity, {
        intent_id: cap.id,
        domain: cap.facets?.domain,
        role: cons.role,
        port_entity: cons.entity,
      });
      for (const [child, parent] of Object.entries(entityIndex.parent_of)) {
        if (parent === cons.entity) {
          register(child, {
            intent_id: cap.id,
            domain: cap.facets?.domain,
            role: cons.role,
            port_entity: cons.entity,
          });
        }
      }
    }
  }

  // also index by canonical bridge identities
  for (const bridge of entityIndex.bridge_eligible) {
    if (!map.has(bridge)) map.set(bridge, []);
    for (const cap of capabilities) {
      for (const cons of cap.consumes ?? []) {
        if (entityMatches(bridge, cons.entity, closure)) {
          register(bridge, {
            intent_id: cap.id,
            domain: cap.facets?.domain,
            role: cons.role,
            port_entity: cons.entity,
          });
        }
      }
    }
  }

  return map;
}