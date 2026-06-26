import nlp from "compromise";
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

/**
 * Extract held identities from a finding for oasis_next. Hybrid, all LOCAL/serve-light (pure JS,
 * no live model download): compromise.js NER for Person/Place/Company (matches spaCy ~6/9 on the
 * battery) + the domain/`City, ST` regexes + a domain→Company derivation. Replaces the prior
 * regex-only path (1/9). See reports/oasis-implementation-plan.md (Phase 1).
 */
export function extractEntitiesFromFinding(finding: string): HeldEntity[] {
  const out: HeldEntity[] = [];
  const seen = new Set<string>();
  const add = (entity: string, value: string) => {
    const v = value.trim().replace(/[?.,!]+$/, "");
    if (!v) return;
    const k = `${entity}:${v.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ entity, value: v, kind: "identity" });
  };

  // Domain (regex — most reliable; compromise doesn't do domains).
  const domain = finding.match(DOMAIN_RE);
  if (domain) {
    add("Domain", domain[0].toLowerCase());
    // A domain usually names a Company too ("stripe.com" → Stripe) — derive it so a Company-bridge
    // is reachable even when compromise doesn't tag the org.
    const root = domain[0].toLowerCase().replace(/^www\./, "").split(".")[0];
    if (root && root.length > 1) add("Company", root[0].toUpperCase() + root.slice(1));
  }

  // compromise.js NER (pure JS) for Person / Place / Company.
  try {
    const doc = nlp(finding);
    for (const p of doc.people().out("array") as string[]) add("Person", p);
    for (const p of doc.places().out("array") as string[]) add("Place", p);
    for (const o of doc.organizations().out("array") as string[]) add("Company", o);
    // Last-resort: if NO Company was found, the salient proper noun (not a Person/Place) is
    // usually the org/brand the query is about (e.g. "Apple" in a stock query). Conservative —
    // fires once, only when needed — to avoid spurious Company entities. A brand/product gazetteer
    // would improve precision + ProductCategory typing (Phase-1 follow-up).
    if (!out.some((e) => e.entity === "Company")) {
      const claimed = new Set(out.map((e) => (e.value ?? "").toLowerCase()));
      const pn = (doc.match("#ProperNoun+").not("#Person").not("#Place").out("array") as string[])
        .find((x) => x.length > 1 && !claimed.has(x.toLowerCase()));
      if (pn) add("Company", pn);
    }
  } catch {
    /* compromise is best-effort; the regexes below still run */
  }

  // `City, ST` regex as a Place supplement.
  const place = finding.match(PLACE_RE);
  if (place) add("Place", `${place[1]}, ${place[2]}`);

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