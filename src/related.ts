import { selectEndpointsForIntent } from "./select-policy.js";
import type {
  CapabilityIntent,
  CapabilityLink,
  IndexBundle,
} from "./types.js";

export interface RelatedOption {
  relation: CapabilityLink["type"];
  /** Human label for the relation, for agent-facing output. */
  relation_label: string;
  intent_id: string;
  label: string;
  /** Why this neighbor is linked (the edge's note), when present. */
  note?: string;
  top_endpoint?: {
    origin: string;
    method: string;
    path: string;
    price_usd?: number;
  };
}

/** Display order + agent-facing wording for each typed relation. */
// Labels describe the TARGET from this intent's perspective. A `broader_of -> B`
// link means *this* intent is broader, so B is the more-specific option (and a
// `narrower_of -> B` link means B is the more-general option).
const RELATION_LABEL: Record<CapabilityLink["type"], string> = {
  alternative_of: "alternative",
  broader_of: "more specific",
  narrower_of: "more general",
  sibling_of: "related",
  pipes_to: "next step",
  fed_by: "prior step",
};
const RELATION_ORDER: CapabilityLink["type"][] = [
  "alternative_of",
  "narrower_of",
  "broader_of",
  "sibling_of",
  "pipes_to",
  "fed_by",
];

/**
 * The typed-link neighborhood of an intent — the "options & alternatives" an
 * LLM gets after resolving a tool. Each neighbor carries its relation and its
 * best endpoint, so an unsure agent can pivot to a substitute (alternative_of),
 * generalize/specialize (broader/narrower_of), explore the family (sibling_of),
 * or chain forward (pipes_to). Dedupes by target, ordered by relation.
 */
export function relatedOptions(
  intent: CapabilityIntent,
  bundle: IndexBundle,
): RelatedOption[] {
  const byId = new Map(bundle.capabilities.map((c) => [c.id, c]));
  const links = [...(intent.links ?? [])].sort(
    (a, b) => RELATION_ORDER.indexOf(a.type) - RELATION_ORDER.indexOf(b.type),
  );

  const seen = new Set<string>();
  const out: RelatedOption[] = [];
  for (const link of links) {
    if (link.to === intent.id || seen.has(link.to)) continue;
    const target = byId.get(link.to);
    if (!target) continue;
    seen.add(link.to);
    const ep = selectEndpointsForIntent(target, bundle.endpoints, 1)[0];
    out.push({
      relation: link.type,
      relation_label: RELATION_LABEL[link.type] ?? link.type,
      intent_id: target.id,
      label: target.label,
      note: link.note,
      top_endpoint: ep
        ? {
            origin: ep.origin,
            method: ep.method,
            path: ep.path,
            price_usd: ep.payment.price_usd,
          }
        : undefined,
    });
  }
  return out;
}
