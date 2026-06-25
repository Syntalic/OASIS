import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchIndex, inferQueryFacets } from "../search/search.js";
import { curatedCapabilitiesForSearch } from "../search/curated-search.js";
import type { CapabilityIntent, IndexBundle } from "../core/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUERIES_PATH = path.join(
  __dirname,
  "..",
  "..",
  "eval",
  "multi-label-queries.json",
);

export type MultiLabelKind =
  | "multi_label"
  | "hard_negative"
  | "paraphrase"
  | "related";

export interface MultiLabelQuery {
  id: string;
  kind: MultiLabelKind;
  query: string;
  expect_intents: string[];
  negative_intents?: string[];
  expect_related?: string[];
}

export interface MultiLabelRow {
  id: string;
  kind: MultiLabelKind;
  top1: string | null;
  recall_at_1: boolean;
  recall_at_3: boolean;
  hard_negative_pass: boolean | null;
  related_found: number | null;
  related_expected: number | null;
  facet_tagged: boolean;
}

export interface MultiLabelReport {
  total: number;
  task_recall_at_1: number;
  task_recall_at_3: number;
  hard_negative_pass: number;
  hard_negative_total: number;
  related_found: number;
  related_expected: number;
  facet_coverage: number;
  rows: MultiLabelRow[];
}

export async function loadMultiLabelQueries(): Promise<MultiLabelQuery[]> {
  const raw = await readFile(QUERIES_PATH, "utf8");
  return JSON.parse(raw) as MultiLabelQuery[];
}

export function runMultiLabelBenchmark(
  bundle: IndexBundle,
  queries: MultiLabelQuery[],
): MultiLabelReport {
  const caps = curatedCapabilitiesForSearch(bundle);
  const capById = new Map<string, CapabilityIntent>(caps.map((c) => [c.id, c]));

  const rows: MultiLabelRow[] = [];
  let r1 = 0,
    r3 = 0,
    hnPass = 0,
    hnTotal = 0,
    relFound = 0,
    relExpected = 0,
    facet = 0;

  for (const q of queries) {
    const hits = searchIndex(q.query, bundle.endpoints, caps, 10);
    const capRanked = hits
      .filter((h) => h.kind === "capability" && h.capability_id)
      .map((h) => h.capability_id as string);
    const top1 = capRanked[0] ?? null;
    const top3 = capRanked.slice(0, 3);

    const recall1 = top1 != null && q.expect_intents.includes(top1);
    const recall3 = q.expect_intents.some((e) => top3.includes(e));
    if (recall1) r1 += 1;
    if (recall3) r3 += 1;

    let hnPassRow: boolean | null = null;
    if (q.kind === "hard_negative") {
      hnTotal += 1;
      // The right intent must win rank-1 over the trap token's intent.
      hnPassRow = top1 != null && q.expect_intents.includes(top1);
      if (hnPassRow) hnPass += 1;
    }

    // related@k: does the (correct) intent's typed-link neighborhood contain the
    // expected related capabilities? Measures link-authoring coverage, not search.
    let relFoundRow: number | null = null;
    let relExpRow: number | null = null;
    if (q.expect_related?.length) {
      const anchor = capById.get(q.expect_intents[0]);
      const links = new Set((anchor?.links ?? []).map((l) => l.to));
      relFoundRow = q.expect_related.filter((rl) => links.has(rl)).length;
      relExpRow = q.expect_related.length;
      relFound += relFoundRow;
      relExpected += relExpRow;
    }

    const facetTagged = Object.keys(inferQueryFacets(q.query)).length > 0;
    if (facetTagged) facet += 1;

    rows.push({
      id: q.id,
      kind: q.kind,
      top1,
      recall_at_1: recall1,
      recall_at_3: recall3,
      hard_negative_pass: hnPassRow,
      related_found: relFoundRow,
      related_expected: relExpRow,
      facet_tagged: facetTagged,
    });
  }

  return {
    total: queries.length,
    task_recall_at_1: r1,
    task_recall_at_3: r3,
    hard_negative_pass: hnPass,
    hard_negative_total: hnTotal,
    related_found: relFound,
    related_expected: relExpected,
    facet_coverage: facet,
    rows,
  };
}

export function formatMultiLabelReport(report: MultiLabelReport): string {
  const n = report.total;
  const pct = (x: number, d: number) =>
    d ? `${x}/${d} (${Math.round((x / d) * 100)}%)` : `${x}/${d}`;
  const lines = [
    "Multi-label / discovery benchmark",
    "",
    `queries:            ${n}`,
    `task recall@1:      ${pct(report.task_recall_at_1, n)}`,
    `task recall@3:      ${pct(report.task_recall_at_3, n)}`,
    `hard-negative pass: ${pct(report.hard_negative_pass, report.hard_negative_total)}`,
    `related@links:      ${pct(report.related_found, report.related_expected)}`,
    `facet coverage:     ${pct(report.facet_coverage, n)}`,
    "",
    "Legend:",
    "  task recall@k     = >=1 acceptable intent in top-k",
    "  hard-negative pass = right intent beats the trap-token intent at rank 1",
    "  related@links     = expected related intents present in the anchor intent's typed links[]",
    "  facet coverage    = queries that yield >=1 inferred query facet",
  ];
  return lines.join("\n");
}
