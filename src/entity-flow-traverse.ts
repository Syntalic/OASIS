import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { entityMatches, matchKind } from "./entity-match.js";
import type { EntityIndex } from "./entity-index.js";
import { buildConsumersByEntity } from "./entity-flow.js";
import { selectEndpointsForIntent } from "./select-policy.js";
import type { CapabilityIntent, EndpointRecord, FacetDomain } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface HeldEntity {
  entity: string;
  value?: string;
  source?: string;
  role?: "identifier" | "payload";
  kind?: "identity" | "observation";
}

export interface TraversalContext {
  source_intent_id?: string;
  entities: HeldEntity[];
  exclude?: string[];
  finding?: string;
}

export interface RankedFollowUp {
  intent_id: string;
  label: string;
  mode: "forward" | "investigative";
  bridging_entity: string;
  match_kind: "exact" | "parent";
  score: number;
  why: string;
  top_endpoint?: {
    method: string;
    origin: string;
    path: string;
    price_usd?: number;
    rails?: string[];
  };
}

export interface EntityFlowRuntime {
  entityIndex: EntityIndex;
  consumersByEntity: Map<string, Array<{ intent_id: string; domain?: FacetDomain; role?: string; port_entity: string }>>;
}

export async function loadEntityFlowRuntime(
  distDir: string,
  capabilities: CapabilityIntent[],
): Promise<EntityFlowRuntime> {
  const raw = await readFile(path.join(distDir, "entity-index.json"), "utf8");
  const entityIndex = JSON.parse(raw) as EntityIndex;
  const consumersByEntity = buildConsumersByEntity(capabilities, entityIndex);
  return { entityIndex, consumersByEntity };
}

export function suggestFollowUps(
  ctx: TraversalContext,
  runtime: EntityFlowRuntime,
  opts: {
    limit?: number;
    capabilities: CapabilityIntent[];
    endpoints: EndpointRecord[];
  },
): { forward: RankedFollowUp[]; investigative: RankedFollowUp[] } {
  const limit = opts.limit ?? 8;
  const capById = new Map(opts.capabilities.map((c) => [c.id, c]));
  const exclude = new Set(ctx.exclude ?? []);
  const closure = {
    parentOf: runtime.entityIndex.parent_of,
    expands: runtime.entityIndex.subtype_closure,
  };

  const sourceDomain = ctx.source_intent_id
    ? capById.get(ctx.source_intent_id)?.facets?.domain
    : undefined;

  const heldIdentities = ctx.entities.filter((e) => {
    if (e.kind === "observation") return false;
    if (runtime.entityIndex.observation_entities.includes(e.entity)) return false;
    if (e.entity === "Query") return false;
    return runtime.entityIndex.bridge_eligible.includes(e.entity) ||
      runtime.entityIndex.bridge_eligible.some((b) => entityMatches(e.entity, b, closure));
  });

  const candidates: RankedFollowUp[] = [];

  for (const held of heldIdentities) {
    const bridgeEntity = runtime.entityIndex.bridge_eligible.find((b) =>
      entityMatches(held.entity, b, closure) || entityMatches(b, held.entity, closure) || held.entity === b,
    ) ?? (runtime.entityIndex.bridge_eligible.includes(held.entity) ? held.entity : null);
    if (!bridgeEntity) continue;

    const consumers = runtime.consumersByEntity.get(bridgeEntity) ?? [];
    for (const consumer of consumers) {
      if (exclude.has(consumer.intent_id)) continue;
      if (consumer.intent_id === ctx.source_intent_id) continue;
      const mk = matchKind(held.entity, consumer.port_entity, closure);
      if (!mk) continue;
      const target = capById.get(consumer.intent_id);
      if (!target) continue;
      if (sourceDomain && consumer.domain === sourceDomain) continue;

      const ep = selectEndpointsForIntent(target, opts.endpoints, 1)[0];
      if (!ep) continue;

      const specificity = mk === "exact" ? 0.9 : 0.7;
      const crossDomain = sourceDomain && consumer.domain && consumer.domain !== sourceDomain ? 0.85 : 0.5;
      const score = specificity * 0.5 + crossDomain * 0.5;

      const valueSuffix = held.value ? ` (${held.value})` : "";
      candidates.push({
        intent_id: consumer.intent_id,
        label: target.label,
        mode: "investigative",
        bridging_entity: bridgeEntity,
        match_kind: mk,
        score,
        why: `${target.label} can investigate ${bridgeEntity} you hold${valueSuffix}`,
        top_endpoint: {
          method: ep.method,
          origin: ep.origin,
          path: ep.path,
          price_usd: ep.payment?.price_usd,
          rails: (ep.payment?.rails ?? []).map((r) => r.protocol),
        },
      });
    }
  }

  // rank + caps
  candidates.sort((a, b) => b.score - a.score);
  const investigative: RankedFollowUp[] = [];
  const perEntity = new Map<string, number>();
  const perDomain = new Map<string, number>();
  const seenIntent = new Set<string>();

  for (const c of candidates) {
    if (investigative.length >= limit) break;
    if (seenIntent.has(c.intent_id)) continue;
    const ec = perEntity.get(c.bridging_entity) ?? 0;
    if (ec >= 3) continue;
    const target = capById.get(c.intent_id);
    const dom = target?.facets?.domain ?? "unknown";
    const dc = perDomain.get(dom) ?? 0;
    if (dc >= 2) continue;
    investigative.push(c);
    seenIntent.add(c.intent_id);
    perEntity.set(c.bridging_entity, ec + 1);
    perDomain.set(dom, dc + 1);
  }

  return { forward: [], investigative };
}