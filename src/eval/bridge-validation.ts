import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { entityMatches } from "../entity-match.js";
import type { EntityIndex } from "../entity-index.js";
import type { CapabilityIntent, FacetDomain } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..", "..");

export interface BridgeScenario {
  id: string;
  description?: string;
  held_entities: Array<{ entity: string; value?: string; role?: string }>;
  source_domain?: FacetDomain;
  source_intent_id?: string;
  expect_intents?: string[];
  min_hits?: number;
  max_lateral?: number;
  must_cross_domain?: boolean;
  mode?: "lateral" | "forward";
  v1?: boolean;
}

export interface BridgeScenarioResult {
  id: string;
  passed: boolean;
  matched: string[];
  missing: string[];
  unexpected_lateral_on_query: boolean;
}

function lateralConsumersForHeld(
  heldEntity: string,
  capabilities: CapabilityIntent[],
  entityIndex: EntityIndex,
  sourceDomain?: FacetDomain,
): string[] {
  // Query and observations never seed lateral investigation (v1 gate).
  if (heldEntity === "Query" || entityIndex.observation_entities.includes(heldEntity)) {
    return [];
  }

  const closure = { parentOf: entityIndex.parent_of, expands: entityIndex.subtype_closure };
  const isBridgeHeld =
    entityIndex.bridge_eligible.includes(heldEntity) ||
    entityIndex.bridge_eligible.some((b) => entityMatches(heldEntity, b, closure));
  if (!isBridgeHeld) return [];

  const matched: string[] = [];
  for (const cap of capabilities) {
    for (const cons of cap.consumes ?? []) {
      // Only bridge-eligible consumer ports count as lateral targets.
      const portIsBridge =
        entityIndex.bridge_eligible.includes(cons.entity) ||
        entityIndex.bridge_eligible.some((b) => entityMatches(cons.entity, b, closure));
      if (!portIsBridge) continue;
      if (!entityMatches(heldEntity, cons.entity, closure)) continue;
      const domain = cap.facets?.domain;
      if (sourceDomain && domain === sourceDomain) continue;
      matched.push(cap.id);
    }
  }
  return [...new Set(matched)];
}

export function runBridgeValidation(
  capabilities: CapabilityIntent[],
  entityIndex: EntityIndex,
  scenarios: BridgeScenario[],
): { passed: number; failed: number; results: BridgeScenarioResult[] } {
  const results: BridgeScenarioResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const scenario of scenarios) {
    if (scenario.v1 === false) {
      results.push({ id: scenario.id, passed: true, matched: [], missing: [], unexpected_lateral_on_query: false });
      passed++;
      continue;
    }

    const held = scenario.held_entities[0]?.entity ?? "";
    const isQueryOrObs =
      held === "Query" || entityIndex.observation_entities.includes(held);

    const matched: string[] = [];
    for (const h of scenario.held_entities) {
      matched.push(
        ...lateralConsumersForHeld(h.entity, capabilities, entityIndex, scenario.source_domain),
      );
    }
    const unique = [...new Set(matched)];
    const expect = scenario.expect_intents ?? [];
    const missing = expect.filter((e) => !unique.includes(e));

    let ok = true;
    if (scenario.max_lateral === 0) {
      ok = unique.length === 0;
    } else if (scenario.min_hits != null) {
      const hitCount = expect.filter((e) => unique.includes(e)).length;
      ok = hitCount >= scenario.min_hits;
    } else if (expect.length) {
      ok = missing.length === 0;
    }

    if (isQueryOrObs && unique.length > 0) ok = false;

    const result: BridgeScenarioResult = {
      id: scenario.id,
      passed: ok,
      matched: unique,
      missing,
      unexpected_lateral_on_query: isQueryOrObs && unique.length > 0,
    };
    results.push(result);
    if (ok) passed++;
    else failed++;
  }

  return { passed, failed, results };
}

export async function loadBridgeScenarios(): Promise<BridgeScenario[]> {
  const file = path.join(PACKAGE_ROOT, "fixtures", "bridge-scenarios.json");
  const data = JSON.parse(await readFile(file, "utf8")) as { scenarios: BridgeScenario[] };
  return data.scenarios;
}