import type { CapabilityIntent, IndexBundle } from "../core/types.js";
import { V1_BRIDGE_IDENTITIES } from "./entity-match.js";

export interface HeldEntity {
  entity: string;
  value?: string;
  source?: string;
  role?: "identifier" | "payload";
  kind?: "identity" | "observation";
}

export interface ExtractionResult {
  entities: HeldEntity[];
  method: "explicit" | "heuristic" | "llm" | "intent_produces";
  confidence: "high" | "medium" | "low";
}

const PLACE_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})\b/;
const DOMAIN_RE = /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/i;

const FORBIDDEN = new Set(["Query", "StructuredRecord", "NamedEntity", "Org"]);

export function extractEntitiesFromFinding(finding: string): HeldEntity[] {
  const out: HeldEntity[] = [];
  const place = finding.match(PLACE_RE);
  if (place) {
    out.push({ entity: "Place", value: `${place[1]}, ${place[2]}`, kind: "identity" });
  }
  const domain = finding.match(DOMAIN_RE);
  if (domain) {
    out.push({ entity: "Domain", value: domain[0].toLowerCase(), kind: "identity" });
  }
  return out;
}

export function extractEntities(opts: {
  finding?: string;
  explicitEntities?: HeldEntity[];
  source_intent_id?: string;
  bundle: IndexBundle;
  capabilitiesById: Map<string, CapabilityIntent>;
}): ExtractionResult {
  if (opts.explicitEntities?.length) {
    const entities = opts.explicitEntities
      .filter((e) => e.entity && !FORBIDDEN.has(e.entity))
      .map((e) => ({
        ...e,
        kind: e.kind ?? (V1_BRIDGE_IDENTITIES.includes(e.entity as (typeof V1_BRIDGE_IDENTITIES)[number]) ? "identity" : e.kind),
      }));
    return { entities, method: "explicit", confidence: "high" };
  }

  if (opts.finding) {
    const heuristic = extractEntitiesFromFinding(opts.finding);
    if (heuristic.length) {
      return { entities: heuristic, method: "heuristic", confidence: "medium" };
    }
  }

  if (opts.source_intent_id) {
    const intent = opts.capabilitiesById.get(opts.source_intent_id);
    if (intent) {
      const identityProduces = (intent.produces ?? [])
        .filter((p) => V1_BRIDGE_IDENTITIES.includes(p.entity as (typeof V1_BRIDGE_IDENTITIES)[number]))
        .map((p) => ({
          entity: p.entity,
          role: p.role === "identifier" || p.role === "payload" ? p.role : undefined,
          kind: "identity" as const,
        }));
      if (identityProduces.length) {
        return { entities: identityProduces, method: "intent_produces", confidence: "low" };
      }
    }
  }

  return { entities: [], method: "heuristic", confidence: "low" };
}