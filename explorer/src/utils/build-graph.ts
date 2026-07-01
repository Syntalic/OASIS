import type { Edge, Node } from "@xyflow/react";

import {
  capabilities,
  capById,
  domains,
  domainMeta,
  entityByName,
  type Capability,
  type MatchResult,
} from "@/lib/ontology";
import type {
  CapabilityNodeData,
  DomainNodeData,
  EdgeKind,
  EndpointNodeData,
  EntityNodeData,
  FindResult,
  QueryNodeData,
} from "@/types/graph";
import { measureTextWidth, measureWrappedLines } from "@/utils/text-measure";

const CAP_W = 224;
const CAP_FONT = "600 13px Geist, system-ui, sans-serif";
const ENT_FONT = "500 11px Geist, system-ui, sans-serif";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function capSize(label: string, withBar: boolean): [number, number] {
  const lines = measureWrappedLines(label, CAP_FONT, CAP_W - 28);
  return [CAP_W, 52 + (lines - 1) * 16 + (withBar ? 10 : 0)];
}
function entSize(name: string): [number, number] {
  return [clamp(measureTextWidth(name, ENT_FONT) + 40, 96, 180), 40];
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function edge(
  id: string,
  source: string,
  target: string,
  kind: EdgeKind,
  color: string,
  flow: boolean,
): Edge {
  return {
    id,
    source,
    target,
    type: "relation",
    data: { kind, color, flow },
  };
}

/* ------------------------------------------------------------------ */
/* Explore — domains, capabilities, entity flow                        */
/* ------------------------------------------------------------------ */

export function buildExploreGraph(opts: {
  showEntities: boolean;
  focusDomain: string | null;
}): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const activeDomains = opts.focusDomain
    ? domains.filter((d) => d.id === opts.focusDomain)
    : domains;
  const caps = opts.focusDomain
    ? capabilities.filter((c) => c.domain === opts.focusDomain)
    : capabilities;

  for (const d of activeDomains) {
    const meta = domainMeta(d.id);
    const data: DomainNodeData = {
      kind: "domain",
      domainId: d.id,
      label: meta.label,
      color: meta.color,
      capCount: d.capabilities.length,
      endpointCount: d.endpointCount,
      size: [184, 104],
    };
    nodes.push({ id: `dom:${d.id}`, type: "domain", position: { x: 0, y: 0 }, data: data as unknown as Record<string, unknown> });
  }

  for (const c of caps) {
    const meta = domainMeta(c.domain);
    const data: CapabilityNodeData = {
      kind: "capability",
      capId: c.id,
      label: c.label,
      domain: c.domain,
      color: meta.color,
      action: c.action,
      modality: c.modality,
      endpointCount: c.endpointCount,
      size: capSize(c.label, false),
    };
    nodes.push({ id: c.id, type: "capability", position: { x: 0, y: 0 }, data: data as unknown as Record<string, unknown> });
    edges.push(edge(`m:${c.id}`, c.id, `dom:${c.domain}`, "membership", meta.color, false));
  }

  if (opts.showEntities) {
    const degree = new Map<string, number>();
    for (const c of caps) {
      for (const p of [...c.produces, ...c.consumes]) {
        degree.set(p.entity, (degree.get(p.entity) ?? 0) + 1);
      }
    }
    for (const [name, deg] of degree) {
      const data: EntityNodeData = {
        kind: "entity",
        name,
        degree: deg,
        size: entSize(name),
      };
      nodes.push({ id: `ent:${name}`, type: "entity", position: { x: 0, y: 0 }, data: data as unknown as Record<string, unknown> });
    }
    for (const c of caps) {
      for (const p of c.produces) {
        edges.push(edge(`p:${c.id}:${p.entity}`, c.id, `ent:${p.entity}`, "produces", "#64748b", false));
      }
      for (const p of c.consumes) {
        edges.push(edge(`c:${p.entity}:${c.id}`, `ent:${p.entity}`, c.id, "consumes", "#475569", false));
      }
    }
  }

  return { nodes, edges };
}

/* ------------------------------------------------------------------ */
/* Ask — question → capabilities → entities + endpoints                */
/* ------------------------------------------------------------------ */

/** teal accent for chain-to (next-step) capabilities from oasis_discover */
const NEXT_COLOR = "#5eead4";

export function buildAskGraph(
  query: string,
  matches: MatchResult[],
  find?: FindResult,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const queryId = "query:root";
  const qData: QueryNodeData = {
    kind: "query",
    text: query,
    count: matches.length,
    size: [264, 92],
  };
  nodes.push({
    id: queryId,
    type: "query",
    position: { x: 0, y: 0 },
    data: qData as unknown as Record<string, unknown>,
  });

  const entityDegree = new Map<string, number>();

  matches.forEach((m, i) => {
    const c = m.capability;
    const meta = domainMeta(c.domain);
    const data: CapabilityNodeData = {
      kind: "capability",
      capId: c.id,
      label: c.label,
      domain: c.domain,
      color: meta.color,
      action: c.action,
      modality: c.modality,
      endpointCount: c.endpointCount,
      strength: m.strength,
      rank: i + 1,
      size: capSize(c.label, true),
    };
    nodes.push({ id: c.id, type: "capability", position: { x: 0, y: 0 }, data: data as unknown as Record<string, unknown> });
    edges.push(edge(`q:${c.id}`, queryId, c.id, "match", meta.color, true));
    for (const p of [...c.produces, ...c.consumes]) {
      entityDegree.set(p.entity, (entityDegree.get(p.entity) ?? 0) + 1);
    }
  });

  const showEntity = new Set<string>();
  for (const [name, deg] of entityDegree) if (deg >= 2) showEntity.add(name);
  matches.slice(0, 3).forEach((m) => m.capability.produces.forEach((p) => showEntity.add(p.entity)));

  for (const name of showEntity) {
    const ent = entityByName.get(name);
    const data: EntityNodeData = {
      kind: "entity",
      name,
      degree: ent ? ent.producedBy.length + ent.consumedBy.length : 1,
      size: entSize(name),
    };
    nodes.push({ id: `ent:${name}`, type: "entity", position: { x: 0, y: 0 }, data: data as unknown as Record<string, unknown> });
  }

  for (const m of matches) {
    const c = m.capability;
    const meta = domainMeta(c.domain);
    for (const p of c.produces) {
      if (showEntity.has(p.entity)) {
        edges.push(edge(`p:${c.id}:${p.entity}`, c.id, `ent:${p.entity}`, "produces", meta.color, m.strength > 0.55));
      }
    }
    for (const p of c.consumes) {
      if (showEntity.has(p.entity)) {
        edges.push(edge(`c:${p.entity}:${c.id}`, `ent:${p.entity}`, c.id, "consumes", "#64748b", false));
      }
    }
  }

  // real paid endpoints for the strongest matches
  const seen = new Set<string>();
  matches.slice(0, 3).forEach((m) => {
    const c = m.capability;
    const meta = domainMeta(c.domain);
    let added = 0;
    for (const ep of c.sampleEndpoints) {
      if (added >= 3) break;
      const host = hostOf(ep.origin);
      const id = `ep:${c.id}:${host}${ep.path}`;
      if (seen.has(id)) continue;
      seen.add(id);
      added++;
      const data: EndpointNodeData = {
        kind: "endpoint",
        host,
        method: ep.method,
        path: ep.path,
        color: meta.color,
        capId: c.id,
        size: [216, 40],
      };
      nodes.push({ id, type: "endpoint", position: { x: 0, y: 0 }, data: data as unknown as Record<string, unknown> });
      edges.push(edge(`s:${id}`, c.id, id, "serves", meta.color, true));
    }
  });

  // chain-to suggestions from oasis_discover.next_steps
  if (find?.nextSteps.length) {
    const topCap = matches[0]?.capability.id ?? queryId;
    const present = new Set(matches.map((m) => m.capability.id));
    for (const ns of find.nextSteps.slice(0, 5)) {
      if (present.has(ns.intent_id)) continue;
      const c = capById.get(ns.intent_id);
      if (!c) continue;
      present.add(c.id);
      const meta = domainMeta(c.domain);
      const data: CapabilityNodeData = {
        kind: "capability",
        capId: c.id,
        label: c.label,
        domain: c.domain,
        color: meta.color,
        action: c.action,
        modality: c.modality,
        endpointCount: c.endpointCount,
        nextStep: true,
        why: ns.why,
        size: capSize(c.label, false),
      };
      nodes.push({ id: c.id, type: "capability", position: { x: 0, y: 0 }, data: data as unknown as Record<string, unknown> });
      edges.push(edge(`n:${c.id}`, topCap, c.id, "match", NEXT_COLOR, true));
    }
  }

  return { nodes, edges };
}

export type CapabilityLite = Capability;
