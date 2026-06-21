import path from "node:path";
import { fileURLToPath } from "node:url";
import { endpointId } from "../id.js";
import { loadOntology } from "../ontology.js";
import type { CapabilityIntent, IndexBundle, SatisfiesRef } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..", "..");

export interface ResolveResult {
  intent_id: string;
  label: string;
  primary_ref: SatisfiesRef;
  resolved: boolean;
  endpoint_id: string | null;
}

export interface ResolveBenchmarkReport {
  total: number;
  resolved: number;
  missing: number;
  results: ResolveResult[];
}

function primaryRef(intent: CapabilityIntent): SatisfiesRef {
  return (
    intent.satisfies.find((s) => s.confidence === "primary") ?? intent.satisfies[0]
  );
}

function formatRef(ref: SatisfiesRef): string {
  return `${ref.method} ${ref.origin}${ref.path}`;
}

export async function loadCuratedIntents(): Promise<CapabilityIntent[]> {
  const intentsDir = path.join(PACKAGE_ROOT, "ontology", "intents");
  return loadOntology(intentsDir);
}

export function evaluateResolveAccuracy(
  bundle: IndexBundle,
  intents: CapabilityIntent[],
): ResolveBenchmarkReport {
  const endpointIds = new Set(bundle.endpoints.map((e) => e.id));
  const results: ResolveResult[] = [];

  for (const intent of intents) {
    const ref = primaryRef(intent);
    const id = endpointId(ref.origin, ref.method, ref.path);
    const resolved = endpointIds.has(id);

    results.push({
      intent_id: intent.id,
      label: intent.label,
      primary_ref: ref,
      resolved,
      endpoint_id: resolved ? id : null,
    });
  }

  const resolved = results.filter((r) => r.resolved).length;

  return {
    total: results.length,
    resolved,
    missing: results.length - resolved,
    results,
  };
}

export async function runResolveBenchmark(
  bundle: IndexBundle,
): Promise<ResolveBenchmarkReport> {
  const intents = await loadCuratedIntents();
  return evaluateResolveAccuracy(bundle, intents);
}

export function formatResolveReport(report: ResolveBenchmarkReport): string {
  const lines: string[] = [
    "Resolve accuracy (curated ontology intents)",
    "",
    `total: ${report.total}  resolved: ${report.resolved}  missing: ${report.missing}`,
    "",
  ];

  const header = [
    "resolved".padEnd(9),
    "intent".padEnd(32),
    "primary ref".padEnd(48),
    "endpoint id",
  ].join(" ");

  lines.push(header, "-".repeat(header.length));

  for (const r of report.results) {
    lines.push(
      [
        (r.resolved ? "yes" : "no").padEnd(9),
        r.intent_id.padEnd(32),
        formatRef(r.primary_ref).padEnd(48),
        r.endpoint_id ?? "—",
      ].join(" "),
    );
  }

  return lines.join("\n");
}