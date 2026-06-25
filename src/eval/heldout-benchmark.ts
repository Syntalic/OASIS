import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchIndex } from "../search/search.js";
import { curatedCapabilitiesForSearch } from "../search/curated-search.js";
import type { CapabilityIntent, IndexBundle } from "../core/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUERIES_PATH = path.join(
  __dirname,
  "..",
  "..",
  "eval",
  "heldout-queries.json",
);

export interface HeldoutQuery {
  id: string;
  query: string;
  expect_intents: string[];
  /** "dev" (default) is tunable; "test" is held back for honest final reporting. */
  split?: string;
}

export interface HeldoutRow {
  id: string;
  split: string;
  alias_overlap: number;
  discover_at_1: boolean;
  discover_at_3: boolean;
  top1: string | null;
  expected: string[];
}

export interface SplitScore {
  total: number;
  discover_at_1: number;
  discover_at_3: number;
}

export interface HeldoutReport {
  total: number;
  discover_at_1: number;
  discover_at_3: number;
  mean_alias_overlap: number;
  low_overlap_count: number; // queries with <30% alias overlap (genuinely novel)
  splits: Record<string, SplitScore>;
  rows: HeldoutRow[];
}

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "you", "your", "its",
  "get", "give", "need", "want", "find", "into", "over", "what", "are", "how",
  "can", "out", "off", "now", "right", "just", "them", "they", "than", "under",
  "past", "few", "last", "one", "two", "three", "give", "show", "make", "have",
  "got", "let", "know", "tell", "their", "these", "this", "some", "any", "but",
]);

function contentWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export async function loadHeldoutQueries(): Promise<HeldoutQuery[]> {
  return JSON.parse(await readFile(QUERIES_PATH, "utf8")) as HeldoutQuery[];
}

export function runHeldoutBenchmark(
  bundle: IndexBundle,
  queries: HeldoutQuery[],
): HeldoutReport {
  const caps = curatedCapabilitiesForSearch(bundle);
  const byId = new Map<string, CapabilityIntent>(caps.map((c) => [c.id, c]));

  const rows: HeldoutRow[] = [];
  let d1 = 0,
    d3 = 0,
    overlapSum = 0,
    lowOverlap = 0;

  for (const q of queries) {
    // Alias overlap vs the expected intent's label + aliases (its "training"
    // surface) — the held-out proof: low overlap = phrased away from the labels.
    const anchor = byId.get(q.expect_intents[0]);
    const aliasWords = contentWords(
      [anchor?.label ?? "", ...(anchor?.aliases ?? [])].join(" "),
    );
    const qWords = [...contentWords(q.query)];
    const overlap = qWords.length
      ? qWords.filter((w) => aliasWords.has(w)).length / qWords.length
      : 0;
    overlapSum += overlap;
    if (overlap < 0.3) lowOverlap += 1;

    const ranked = searchIndex(q.query, bundle.endpoints, caps, 10)
      .filter((h) => h.kind === "capability" && h.capability_id)
      .map((h) => h.capability_id as string);
    const hit1 = ranked[0] != null && q.expect_intents.includes(ranked[0]);
    const hit3 = q.expect_intents.some((e) => ranked.slice(0, 3).includes(e));
    if (hit1) d1 += 1;
    if (hit3) d3 += 1;

    rows.push({
      id: q.id,
      split: q.split ?? "dev",
      alias_overlap: Number(overlap.toFixed(2)),
      discover_at_1: hit1,
      discover_at_3: hit3,
      top1: ranked[0] ?? null,
      expected: q.expect_intents,
    });
  }

  const splits: Record<string, SplitScore> = {};
  for (const r of rows) {
    const s = (splits[r.split] ??= { total: 0, discover_at_1: 0, discover_at_3: 0 });
    s.total += 1;
    if (r.discover_at_1) s.discover_at_1 += 1;
    if (r.discover_at_3) s.discover_at_3 += 1;
  }

  return {
    total: queries.length,
    discover_at_1: d1,
    discover_at_3: d3,
    mean_alias_overlap: Number((overlapSum / (queries.length || 1)).toFixed(3)),
    low_overlap_count: lowOverlap,
    splits,
    rows,
  };
}

export function formatHeldoutReport(report: HeldoutReport): string {
  const n = report.total;
  const pct = (x: number) => `${x}/${n} (${Math.round((x / n) * 100)}%)`;
  const misses = report.rows.filter((r) => !r.discover_at_3);
  const lines = [
    "Held-out generalization benchmark (queries phrased away from intent labels)",
    "",
    `queries:           ${n}`,
    `mean alias overlap: ${report.mean_alias_overlap}  (lower = more novel phrasing)`,
    `low-overlap (<30%): ${pct(report.low_overlap_count)}  — the genuinely held-out slice`,
    `discover@1:        ${pct(report.discover_at_1)}`,
    `discover@3:        ${pct(report.discover_at_3)}`,
  ];
  for (const [name, s] of Object.entries(report.splits).sort()) {
    const sp = (x: number) => `${x}/${s.total} (${Math.round((x / s.total) * 100)}%)`;
    lines.push(
      `  [${name}] discover@1 ${sp(s.discover_at_1)}  discover@3 ${sp(s.discover_at_3)}`,
    );
  }
  if (misses.length) {
    lines.push("", "Top-3 misses:");
    for (const m of misses) {
      lines.push(`  ${m.id}: top1=${m.top1} expected=${m.expected.join("|")}`);
    }
  }
  return lines.join("\n");
}
