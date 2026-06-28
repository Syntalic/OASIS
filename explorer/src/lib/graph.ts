import {
  capabilities,
  capById,
  domains,
  entityByName,
  domainMeta,
  type MatchResult,
} from "@/lib/ontology";

/* ------------------------------------------------------------------ */
/* Abstract graph model (layout-agnostic). The flow component turns    */
/* these into positioned React Flow nodes after the force pass.        */
/* ------------------------------------------------------------------ */

export type NodeKind = "domain" | "capability" | "entity" | "query" | "endpoint";

export type EdgeKind =
  | "membership"
  | "consumes"
  | "produces"
  | "match"
  | "serves";

export interface DomainNodeData {
  kind: "domain";
  id: string;
  label: string;
  color: string;
  capCount: number;
  endpointCount: number;
}

export interface CapabilityNodeData {
  kind: "capability";
  id: string;
  label: string;
  domain: string;
  color: string;
  action: string | null;
  modality: string[];
  endpointCount: number;
  /** present in question mode */
  strength?: number;
  rank?: number;
}

export interface EntityNodeData {
  kind: "entity";
  id: string;
  name: string;
  degree: number;
}

export interface QueryNodeData {
  kind: "query";
  id: string;
  text: string;
  count: number;
}

export interface EndpointNodeData {
  kind: "endpoint";
  id: string;
  host: string;
  method: string;
  path: string;
  color: string;
}

export type AnyNodeData =
  | DomainNodeData
  | CapabilityNodeData
  | EntityNodeData
  | QueryNodeData
  | EndpointNodeData;

export interface OntNode {
  id: string;
  kind: NodeKind;
  data: AnyNodeData;
  /** seed position for the force pass */
  seed: { x: number; y: number };
  /** relative size hint for the force collision radius */
  weight: number;
}

export interface OntEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  color: string;
  flow: boolean;
  strength: number;
}

export interface GraphModel {
  nodes: OntNode[];
  edges: OntEdge[];
}

const ENTITY_PREFIX = "ent:";
const DOMAIN_PREFIX = "dom:";

function ring(i: number, n: number, r: number, cx = 0, cy = 0) {
  const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}

/* ------------------------------------------------------------------ */
/* Overview: the whole ontology at rest                                */
/* ------------------------------------------------------------------ */

export interface OverviewOptions {
  showEntities: boolean;
  /** when set, only this domain's capabilities (+ their entities) are shown */
  focusDomain: string | null;
}

export function buildOverview(opts: OverviewOptions): GraphModel {
  const nodes: OntNode[] = [];
  const edges: OntEdge[] = [];

  const activeDomains = opts.focusDomain
    ? domains.filter((d) => d.id === opts.focusDomain)
    : domains;

  const caps = opts.focusDomain
    ? capabilities.filter((c) => c.domain === opts.focusDomain)
    : capabilities;

  // domains on an outer ring
  activeDomains.forEach((d, i) => {
    const meta = domainMeta(d.id);
    const pos = ring(i, activeDomains.length, opts.focusDomain ? 0 : 520);
    nodes.push({
      id: DOMAIN_PREFIX + d.id,
      kind: "domain",
      weight: 2.4,
      seed: pos,
      data: {
        kind: "domain",
        id: d.id,
        label: meta.label,
        color: meta.color,
        capCount: d.capabilities.length,
        endpointCount: d.endpointCount,
      },
    });
  });

  // capabilities seeded near their domain
  const domIndex = new Map(activeDomains.map((d, i) => [d.id, i]));
  caps.forEach((c, i) => {
    const meta = domainMeta(c.domain);
    const di = domIndex.get(c.domain) ?? 0;
    const base = ring(di, activeDomains.length, opts.focusDomain ? 0 : 520);
    const jitter = ring(i, caps.length, 180, base.x, base.y);
    nodes.push({
      id: c.id,
      kind: "capability",
      weight: 1.1 + Math.min(c.endpointCount, 60) / 120,
      seed: jitter,
      data: {
        kind: "capability",
        id: c.id,
        label: c.label,
        domain: c.domain,
        color: meta.color,
        action: c.action,
        modality: c.modality,
        endpointCount: c.endpointCount,
      },
    });
    edges.push({
      id: `m:${c.id}`,
      source: c.id,
      target: DOMAIN_PREFIX + c.domain,
      kind: "membership",
      color: meta.color,
      flow: false,
      strength: 0.5,
    });
  });

  if (opts.showEntities) {
    const usedEntities = new Map<string, number>();
    const capSet = new Set(caps.map((c) => c.id));
    for (const c of caps) {
      for (const p of c.produces) usedEntities.set(p.entity, (usedEntities.get(p.entity) ?? 0) + 1);
      for (const p of c.consumes) usedEntities.set(p.entity, (usedEntities.get(p.entity) ?? 0) + 1);
    }
    [...usedEntities.entries()].forEach(([name, degree], i) => {
      nodes.push({
        id: ENTITY_PREFIX + name,
        kind: "entity",
        weight: 0.8 + Math.min(degree, 12) / 14,
        seed: ring(i, usedEntities.size, 160),
        data: { kind: "entity", id: ENTITY_PREFIX + name, name, degree },
      });
    });
    for (const c of caps) {
      for (const p of c.produces) {
        edges.push({
          id: `p:${c.id}:${p.entity}`,
          source: c.id,
          target: ENTITY_PREFIX + p.entity,
          kind: "produces",
          color: "#64748b",
          flow: false,
          strength: 0.25,
        });
      }
      for (const p of c.consumes) {
        if (!capSet.has(c.id)) continue;
        edges.push({
          id: `c:${p.entity}:${c.id}`,
          source: ENTITY_PREFIX + p.entity,
          target: c.id,
          kind: "consumes",
          color: "#475569",
          flow: false,
          strength: 0.25,
        });
      }
    }
  }

  return { nodes, edges };
}

/* ------------------------------------------------------------------ */
/* Question: query → matched capabilities → shared entities + endpoints */
/* ------------------------------------------------------------------ */

export function buildQuestion(query: string, matches: MatchResult[]): GraphModel {
  const nodes: OntNode[] = [];
  const edges: OntEdge[] = [];

  const queryId = "query:root";
  nodes.push({
    id: queryId,
    kind: "query",
    weight: 3,
    seed: { x: 0, y: 0 },
    data: { kind: "query", id: queryId, text: query, count: matches.length },
  });

  const entityDegree = new Map<string, number>();
  const matchedIds = new Set(matches.map((m) => m.capability.id));

  matches.forEach((m, i) => {
    const c = m.capability;
    const meta = domainMeta(c.domain);
    const pos = ring(i, matches.length, 360);
    nodes.push({
      id: c.id,
      kind: "capability",
      weight: 1.3 + m.strength * 1.2,
      seed: pos,
      data: {
        kind: "capability",
        id: c.id,
        label: c.label,
        domain: c.domain,
        color: meta.color,
        action: c.action,
        modality: c.modality,
        endpointCount: c.endpointCount,
        strength: m.strength,
        rank: i + 1,
      },
    });
    edges.push({
      id: `q:${c.id}`,
      source: queryId,
      target: c.id,
      kind: "match",
      color: meta.color,
      flow: true,
      strength: 0.4 + m.strength * 0.8,
    });

    // shared entities (only those that link >1 matched capability, or top-3 caps)
    for (const p of [...c.produces, ...c.consumes]) {
      entityDegree.set(p.entity, (entityDegree.get(p.entity) ?? 0) + 1);
    }
  });

  // Decide which entities to render: any entity touched by >=2 matched caps,
  // plus the produced entity of the top 3 matches (to always show an output).
  const showEntity = new Set<string>();
  for (const [name, deg] of entityDegree) if (deg >= 2) showEntity.add(name);
  matches.slice(0, 3).forEach((m) => {
    m.capability.produces.forEach((p) => showEntity.add(p.entity));
  });

  [...showEntity].forEach((name, i) => {
    const ent = entityByName.get(name);
    const degree = entityDegree.get(name) ?? 1;
    nodes.push({
      id: ENTITY_PREFIX + name,
      kind: "entity",
      weight: 0.8 + Math.min(degree, 6) / 8,
      seed: ring(i, showEntity.size, 560),
      data: {
        kind: "entity",
        id: ENTITY_PREFIX + name,
        name,
        degree: ent ? ent.producedBy.length + ent.consumedBy.length : degree,
      },
    });
  });

  for (const m of matches) {
    const c = m.capability;
    const meta = domainMeta(c.domain);
    for (const p of c.produces) {
      if (!showEntity.has(p.entity)) continue;
      edges.push({
        id: `p:${c.id}:${p.entity}`,
        source: c.id,
        target: ENTITY_PREFIX + p.entity,
        kind: "produces",
        color: meta.color,
        flow: m.strength > 0.55,
        strength: 0.3,
      });
    }
    for (const p of c.consumes) {
      if (!showEntity.has(p.entity)) continue;
      edges.push({
        id: `c:${p.entity}:${c.id}`,
        source: ENTITY_PREFIX + p.entity,
        target: c.id,
        kind: "consumes",
        color: "#64748b",
        flow: false,
        strength: 0.3,
      });
    }
  }

  // Real paid endpoints for the strongest matches — the OASIS payoff.
  const endpointHosts = new Set<string>();
  matches.slice(0, 3).forEach((m) => {
    const c = m.capability;
    const meta = domainMeta(c.domain);
    let added = 0;
    for (const ep of c.sampleEndpoints) {
      if (added >= 3) break;
      let host = ep.origin;
      try {
        host = new URL(ep.origin).host;
      } catch {
        /* keep raw */
      }
      const nodeId = `ep:${c.id}:${host}${ep.path}`;
      if (endpointHosts.has(nodeId)) continue;
      endpointHosts.add(nodeId);
      added++;
      nodes.push({
        id: nodeId,
        kind: "endpoint",
        weight: 0.7,
        seed: { x: 0, y: 0 },
        data: {
          kind: "endpoint",
          id: nodeId,
          host,
          method: ep.method,
          path: ep.path,
          color: meta.color,
        },
      });
      edges.push({
        id: `s:${nodeId}`,
        source: c.id,
        target: nodeId,
        kind: "serves",
        color: meta.color,
        flow: true,
        strength: 0.6,
      });
    }
  });

  // seed endpoints near their capability so the force pass doesn't fling them
  const capPos = new Map(nodes.filter((n) => n.kind === "capability").map((n) => [n.id, n.seed]));
  let epIdx = 0;
  for (const n of nodes) {
    if (n.kind !== "endpoint") continue;
    const capId = n.id.split(":")[1];
    const base = capPos.get(capId) ?? { x: 0, y: 0 };
    const off = ring(epIdx++, 9, 120, base.x * 1.35, base.y * 1.35);
    n.seed = off;
  }

  void matchedIds;
  void capById;
  return { nodes, edges };
}
