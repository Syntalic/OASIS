import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultLanceDir } from "../embed/lance-index.js";
import { curatedCapabilitiesForSearch } from "../curated-search.js";
import { entityMatches } from "../entity-match.js";
import { loadEntityIndex } from "../entity-index.js";
import { loadEntityFlowRuntime, suggestFollowUps } from "../entity-flow-traverse.js";
import { searchHybridWithFallback } from "../search-hybrid.js";
import type { CapabilityIntent, IndexBundle } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..", "..");

export interface InvestigationScenario {
  id: string;
  user_query: string;
  steps: Array<{
    simulate_intent_id?: string;
    simulate_finding?: string;
    simulate_entities: Array<{ entity: string; value?: string; kind?: string }>;
    simulate_entities_for_investigative?: Array<{ entity: string; value?: string }>;
  }>;
  good_follow_ups: Array<{ intent_id: string; reason?: string }>;
  bad_follow_ups: Array<{ intent_id: string; reason?: string }>;
}

export interface UsefulnessReport {
  callable_precision: number;
  lateral_relevance_precision: number;
  identity_recall: number;
  good_recall_at_6: number;
  bad_rate_at_8: number;
  domain_diversity: number;
  baseline_catalog_aware: {
    good_recall_at_6: number;
    lateral_relevance_precision: number;
  };
  beats_baseline: boolean;
  passed: boolean;
}

export async function loadInvestigationScenarios(): Promise<InvestigationScenario[]> {
  const raw = await readFile(
    path.join(PACKAGE_ROOT, "fixtures", "investigation-scenarios.json"),
    "utf8",
  );
  return (JSON.parse(raw) as { scenarios: InvestigationScenario[] }).scenarios;
}

/**
 * catalog_aware baseline (05 §2.5): agent has oasis_find + catalog but must phrase
 * follow-up searches from the user query and finding only — no access to labeled
 * good_follow_ups, reasons, or intent ids.
 */
async function catalogAwareTop6(
  scenario: InvestigationScenario,
  step: InvestigationScenario["steps"][number],
  bundle: IndexBundle,
  lanceDir: string,
): Promise<string[]> {
  const query = [scenario.user_query, step.simulate_finding].filter(Boolean).join(" ");
  const hits = await searchHybridWithFallback(query, bundle, lanceDir, 6);
  return hits
    .filter((h) => h.kind === "capability" && h.capability_id)
    .slice(0, 6)
    .map((h) => h.capability_id as string);
}

export async function runUsefulnessEval(
  bundle: IndexBundle,
  distDir: string,
): Promise<UsefulnessReport> {
  const scenarios = await loadInvestigationScenarios();
  const capabilities = curatedCapabilitiesForSearch(bundle);
  const capById = new Map(capabilities.map((c) => [c.id, c]));
  const runtime = await loadEntityFlowRuntime(distDir, capabilities);
  const entityIndex = await loadEntityIndex(distDir);
  const closure = { parentOf: entityIndex.parent_of, expands: entityIndex.subtype_closure };
  const lanceDir = defaultLanceDir(distDir);

  let callableHits = 0;
  let callableTotal = 0;
  let identityRecallHits = 0;
  let goodHits = 0;
  let goodTotal = 0;
  let badHits = 0;
  let diversitySum = 0;
  let relevantLabeled = 0;
  let noiseLabeled = 0;

  let baselineGoodHits = 0;
  let baselineGoodTotal = 0;
  let baselineRelevantLabeled = 0;
  let baselineNoiseLabeled = 0;

  for (const scenario of scenarios) {
    const goodIds = new Set(scenario.good_follow_ups.map((g) => g.intent_id));
    const badIds = new Set(scenario.bad_follow_ups.map((b) => b.intent_id));

    for (const step of scenario.steps) {
      const catalogTop6 = await catalogAwareTop6(scenario, step, bundle, lanceDir);
      baselineGoodTotal += scenario.good_follow_ups.length;
      baselineGoodHits += scenario.good_follow_ups.filter((g) =>
        catalogTop6.includes(g.intent_id),
      ).length;
      for (const id of catalogTop6) {
        if (goodIds.has(id)) baselineRelevantLabeled++;
        else if (badIds.has(id)) baselineNoiseLabeled++;
      }
      const investigativeEntities =
        step.simulate_entities_for_investigative ??
        step.simulate_entities.filter((e) => e.kind !== "observation");

      if (investigativeEntities.some((e) => entityIndex.bridge_eligible.includes(e.entity))) {
        identityRecallHits++;
      }

      const result = suggestFollowUps(
        {
          source_intent_id: step.simulate_intent_id,
          entities: step.simulate_entities.map((e) => ({
            entity: e.entity,
            value: e.value,
            kind: e.kind as "identity" | "observation" | undefined,
          })),
          finding: step.simulate_finding,
          exclude: step.simulate_intent_id ? [step.simulate_intent_id] : [],
        },
        runtime,
        { limit: 8, capabilities, endpoints: bundle.endpoints },
      );

      const top = result.investigative.slice(0, 8);
      for (const lead of top) {
        callableTotal++;
        const held = investigativeEntities.map((e) => e.entity);
        const ok = held.some(
          (h) =>
            entityMatches(h, lead.bridging_entity, closure) ||
            (entityIndex.bridge_eligible.includes(h) && h === lead.bridging_entity),
        );
        if (ok && lead.top_endpoint) callableHits++;

        if (goodIds.has(lead.intent_id)) relevantLabeled++;
        else if (badIds.has(lead.intent_id)) noiseLabeled++;
      }

      const top6 = result.investigative.slice(0, 6).map((l) => l.intent_id);
      goodTotal += scenario.good_follow_ups.length;
      goodHits += scenario.good_follow_ups.filter((g) => top6.includes(g.intent_id)).length;

      const badInTop = scenario.bad_follow_ups.filter((b) =>
        top.some((l) => l.intent_id === b.intent_id),
      );
      badHits += badInTop.length;

      const domains = new Set(
        top6.map((id) => capById.get(id)?.facets?.domain).filter(Boolean),
      );
      diversitySum += domains.size;
    }
  }

  const steps = scenarios.reduce((n, s) => n + s.steps.length, 0);
  const callable_precision = callableTotal ? callableHits / callableTotal : 1;
  const labeledTotal = relevantLabeled + noiseLabeled;
  const lateral_relevance_precision = labeledTotal ? relevantLabeled / labeledTotal : 1;
  const identity_recall = steps ? identityRecallHits / steps : 1;
  const good_recall_at_6 = goodTotal ? goodHits / goodTotal : 1;
  const bad_rate_at_8 = steps ? badHits / (steps * 8) : 0;
  const domain_diversity = steps ? diversitySum / steps : 0;

  const baseline_good_recall_at_6 = baselineGoodTotal
    ? baselineGoodHits / baselineGoodTotal
    : 0;
  const baselineLabeled = baselineRelevantLabeled + baselineNoiseLabeled;
  const baseline_lateral_relevance_precision = baselineLabeled
    ? baselineRelevantLabeled / baselineLabeled
    : 0;

  const beats_baseline =
    good_recall_at_6 >= baseline_good_recall_at_6 + 0.15 ||
    (lateral_relevance_precision >= baseline_lateral_relevance_precision + 0.15 &&
      good_recall_at_6 >= baseline_good_recall_at_6);

  const passed =
    callable_precision >= 0.95 &&
    lateral_relevance_precision >= 0.7 &&
    identity_recall >= 1.0 &&
    good_recall_at_6 >= 0.6 &&
    bad_rate_at_8 <= 0.1 &&
    domain_diversity >= 2 &&
    beats_baseline;

  return {
    callable_precision,
    lateral_relevance_precision,
    identity_recall,
    good_recall_at_6,
    bad_rate_at_8,
    domain_diversity,
    baseline_catalog_aware: {
      good_recall_at_6: baseline_good_recall_at_6,
      lateral_relevance_precision: baseline_lateral_relevance_precision,
    },
    beats_baseline,
    passed,
  };
}