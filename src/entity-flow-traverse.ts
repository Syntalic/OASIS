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

// A bridge must INVESTIGATE the held identity, not act on/with it. Intents whose action
// mutates or produces (send a message, register a domain, transform input, execute code)
// consume an entity to *act*, not to look it up — they are not investigative bridges.
const ACT_ACTIONS = new Set(["send", "provision", "transform", "execute"]);

// Score = structural(port-match) × topical(finding↔intent) + small domain/quality nudges.
const TOPIC_FLOOR = 0.15; // least-topical candidate is demoted, not zeroed
const RELEVANCE_FLOOR = 0.3; // when a finding gives topical signal, drop bridges below this
const PER_ENTITY_CAP = 3;
const PER_DOMAIN_CAP = 2;

/** Rep-endpoint completeness → a small quality nudge in [0, 0.05] (tiebreak only). */
function qualityNudge(ep: EndpointRecord): number {
  const q =
    ((ep.description?.length ?? 0) > 20 ? 1 : 0) +
    (ep.guidance_available ? 1 : 0) +
    (ep.openapi_url ? 1 : 0) +
    ((ep.inputs?.length ?? 0) > 0 ? 1 : 0) +
    (ep.payment?.price_usd != null ? 1 : 0);
  return 0.05 * (q / 5);
}

interface ScoredCandidate {
  follow: RankedFollowUp;
  struct: number; // 1.0 exact port match, 0.7 via parent/subtype
  topicRaw: number; // finding↔intent relevance (0 if finding present but intent not surfaced)
  domainNudge: number;
  qNudge: number;
  relevance: number; // struct × topic' — set after the topical min-max
}

export function suggestFollowUps(
  ctx: TraversalContext,
  runtime: EntityFlowRuntime,
  opts: {
    limit?: number;
    capabilities: CapabilityIntent[];
    endpoints: EndpointRecord[];
    /** intent_id → topical relevance of the finding (reuses oasis_find's hybrid search over
     *  the same intent vectors). Absent ⇒ no finding ⇒ structural-only ranking. */
    topicalScores?: Map<string, number>;
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

  const work: ScoredCandidate[] = [];

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
      // A bridge must INVESTIGATE the held identity, not act on/with it (register a domain,
      // send it a message). Drop consume-to-act intents.
      if (ACT_ACTIONS.has(target.facets?.action ?? "")) continue;
      // Same-domain bridges are NOT excluded: relevance to the finding drives ranking; cross-domain
      // is only a small nudge (below), so the obvious same-domain next step can still win.

      const ep = selectEndpointsForIntent(target, opts.endpoints, 1)[0];
      if (!ep) continue;

      const valueSuffix = held.value ? ` (${held.value})` : "";
      work.push({
        struct: mk === "exact" ? 1.0 : 0.7,
        topicRaw: opts.topicalScores?.get(consumer.intent_id) ?? 0,
        domainNudge: sourceDomain && consumer.domain && consumer.domain !== sourceDomain ? 0.05 : 0,
        qNudge: qualityNudge(ep),
        relevance: 0,
        follow: {
          intent_id: consumer.intent_id,
          label: target.label,
          mode: "investigative",
          bridging_entity: bridgeEntity,
          match_kind: mk,
          score: 0,
          why: `${target.label} can investigate ${bridgeEntity} you hold${valueSuffix}`,
          top_endpoint: {
            method: ep.method,
            origin: ep.origin,
            path: ep.path,
            price_usd: ep.payment?.price_usd,
            rails: (ep.payment?.rails ?? []).map((r) => r.protocol),
          },
        },
      });
    }
  }

  // Topical term: min-max the finding↔intent scores across THIS call's candidates, floored so the
  // least-relevant bridge is demoted but not zeroed. No finding (or no spread) ⇒ topic' = 1, i.e.
  // structural-only ranking.
  const hasTopical = opts.topicalScores !== undefined && work.length > 1;
  let tMin = Infinity;
  let tMax = -Infinity;
  if (hasTopical) {
    for (const c of work) {
      if (c.topicRaw < tMin) tMin = c.topicRaw;
      if (c.topicRaw > tMax) tMax = c.topicRaw;
    }
  }
  const spread = tMax - tMin;
  const topical = hasTopical && spread > 0;

  for (const c of work) {
    const topicPrime = topical ? TOPIC_FLOOR + (1 - TOPIC_FLOOR) * ((c.topicRaw - tMin) / spread) : 1.0;
    c.relevance = c.struct * topicPrime;
    c.follow.score = c.relevance + c.domainNudge + c.qNudge;
  }

  // When a finding gives a topical signal, drop bridges below the relevance floor — better to show
  // nothing for an irrelevant held identity than a tangential lead. Never return fully empty.
  let pool = work;
  if (topical) {
    const passing = work.filter((c) => c.relevance >= RELEVANCE_FLOOR);
    pool = passing.length ? passing : [[...work].sort((a, b) => b.follow.score - a.follow.score)[0]];
  }
  pool.sort((a, b) => b.follow.score - a.follow.score);

  // Fill by score with per-entity / per-domain spread caps so one identity/domain can't dominate.
  const investigative: RankedFollowUp[] = [];
  const perEntity = new Map<string, number>();
  const perDomain = new Map<string, number>();
  const seenIntent = new Set<string>();
  for (const c of pool) {
    if (investigative.length >= limit) break;
    const f = c.follow;
    if (seenIntent.has(f.intent_id)) continue;
    if ((perEntity.get(f.bridging_entity) ?? 0) >= PER_ENTITY_CAP) continue;
    const dom = capById.get(f.intent_id)?.facets?.domain ?? "unknown";
    if ((perDomain.get(dom) ?? 0) >= PER_DOMAIN_CAP) continue;
    investigative.push(f);
    seenIntent.add(f.intent_id);
    perEntity.set(f.bridging_entity, (perEntity.get(f.bridging_entity) ?? 0) + 1);
    perDomain.set(dom, (perDomain.get(dom) ?? 0) + 1);
  }

  return { forward: [], investigative };
}