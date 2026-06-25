import path from "node:path";
import { fileURLToPath } from "node:url";
import { curatedCapabilitiesForSearch } from "../search/curated-search.js";
import { CURATED_INTENT_IDS } from "../search/intent-match.js";
import { endpointId } from "../core/id.js";
import { loadOntologySources } from "../ontology/ontology.js";
import type { CapabilityIntent, IndexBundle } from "../core/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..", "..");

export interface ResolveResult {
  intent_id: string;
  label: string;
  endpoint_count: number;
  resolved_count: number;
  resolved: boolean;
  sample_ref: string | null;
}

export interface ResolveBenchmarkReport {
  total: number;
  resolved: number;
  missing: number;
  total_endpoint_refs: number;
  resolved_endpoint_refs: number;
  results: ResolveResult[];
}

function formatRef(origin: string, method: string, p: string): string {
  return `${method} ${origin}${p}`;
}

export async function loadCuratedSources() {
  const intentsDir = path.join(PACKAGE_ROOT, "ontology", "intents");
  return loadOntologySources(intentsDir);
}

export function evaluateResolveAccuracy(bundle: IndexBundle): ResolveBenchmarkReport {
  const endpointIds = new Set(bundle.endpoints.map((e) => e.id));
  const curated = curatedCapabilitiesForSearch(bundle);

  const results: ResolveResult[] = [];
  let totalRefs = 0;
  let resolvedRefs = 0;

  for (const intent of curated) {
    let resolvedCount = 0;
    for (const ref of intent.satisfies) {
      totalRefs += 1;
      const id = endpointId(ref.origin, ref.method, ref.path);
      if (endpointIds.has(id)) {
        resolvedCount += 1;
        resolvedRefs += 1;
      }
    }

    const sample = intent.satisfies[0];
    results.push({
      intent_id: intent.id,
      label: intent.label,
      endpoint_count: intent.satisfies.length,
      resolved_count: resolvedCount,
      resolved: resolvedCount > 0,
      sample_ref: sample
        ? formatRef(sample.origin, sample.method, sample.path)
        : null,
    });
  }

  const resolved = results.filter((r) => r.resolved).length;

  return {
    total: results.length,
    resolved,
    missing: results.length - resolved,
    total_endpoint_refs: totalRefs,
    resolved_endpoint_refs: resolvedRefs,
    results,
  };
}

export async function runResolveBenchmark(
  bundle: IndexBundle,
): Promise<ResolveBenchmarkReport> {
  return evaluateResolveAccuracy(bundle);
}

export function formatResolveReport(report: ResolveBenchmarkReport): string {
  const lines: string[] = [
    "Resolve accuracy (materialized curated intents)",
    "",
    `intents: ${report.total}  with_candidates: ${report.resolved}  missing: ${report.missing}`,
    `endpoint_refs: ${report.resolved_endpoint_refs}/${report.total_endpoint_refs} resolve to index`,
    "",
  ];

  const header = [
    "ok".padEnd(4),
    "intent".padEnd(32),
    "candidates".padEnd(12),
    "sample endpoint",
  ].join(" ");

  lines.push(header, "-".repeat(header.length));

  for (const r of report.results) {
    lines.push(
      [
        (r.resolved ? "yes" : "no").padEnd(4),
        r.intent_id.padEnd(32),
        `${r.resolved_count}/${r.endpoint_count}`.padEnd(12),
        r.sample_ref ?? "—",
      ].join(" "),
    );
  }

  return lines.join("\n");
}