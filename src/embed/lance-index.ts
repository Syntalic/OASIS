import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as lancedb from "@lancedb/lancedb";
import { loadCuratedIntentIds } from "./curated-intents.js";
import { embedTexts } from "./embedder.js";
import type { CapabilityIntent, IndexBundle } from "../core/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..", "..");

export const LANCE_TABLE = "search";

export interface LanceRecord {
  id: string;
  // The index is capability-only this round, but the row carries its kind so the
  // hybrid merger can resolve each vector to the right key namespace (cap:/ep:)
  // without assuming every row is a capability. Endpoints may be embedded later.
  kind: "capability" | "endpoint";
  text: string;
  vector: number[];
}

export function capabilityEmbedText(cap: CapabilityIntent): string {
  return [
    // Spell out the id ("data.weather_forecast" -> "data weather forecast") so
    // it reads as words, not one opaque token.
    cap.id.replace(/[._]/g, " "),
    cap.label,
    cap.description,
    ...(cap.aliases ?? []),
    ...(cap.schema_org ?? []),
    // Domain + action verb add natural-language surface ("search", "extract",
    // "lookup", "send") that oblique queries hit even without an alias match.
    cap.facets?.domain,
    cap.facets?.action,
    // Input + output entity nouns: what the capability operates on and returns
    // ("Webpage", "AudioClip", "PriceSignal") — extra semantic anchors for the
    // vector arm. Additive: an intent without ports/facets contributes nothing.
    ...(cap.consumes ?? []).map((p) => p.entity),
    ...(cap.produces ?? []).map((p) => p.entity),
    ...(cap.facets?.modality ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

// The vector index is capability-only; keyword search already covers endpoints,
// and capabilities are the join point both retrievers fuse on (cap: keys).
export type EmbedScope = "all" | "capabilities" | "curated";

export function buildLanceRecords(
  bundle: IndexBundle,
  scope: EmbedScope = "all",
  curatedIds?: Set<string>,
): LanceRecord[] {
  const records: LanceRecord[] = [];
  for (const cap of bundle.capabilities) {
    if (scope === "curated" && !(curatedIds?.has(cap.id) ?? false)) continue;
    records.push({
      id: cap.id,
      kind: "capability",
      text: capabilityEmbedText(cap),
      vector: [],
    });
  }
  return records;
}

export async function buildLanceIndex(
  bundle: IndexBundle,
  outputDir: string,
  scope: EmbedScope = "all",
): Promise<{ records: number; table: string; path: string; scope: EmbedScope }> {
  const curatedIds =
    scope === "curated"
      ? await loadCuratedIntentIds(path.join(PACKAGE_ROOT, "ontology", "intents"))
      : undefined;
  const records = buildLanceRecords(bundle, scope, curatedIds);
  if (records.length === 0) {
    throw new Error("No capability records to embed");
  }

  const texts = records.map((r) => r.text);
  console.log(`Embedding ${texts.length} capability records (scope=${scope})...`);

  const vectors = await embedTexts(texts, (done, total) => {
    if (done % 50 === 0 || done === total) {
      process.stdout.write(`\r  ${done}/${total}`);
    }
  });
  console.log("");

  for (let i = 0; i < records.length; i++) {
    records[i].vector = vectors[i];
  }

  await mkdir(outputDir, { recursive: true });
  const db = await lancedb.connect(outputDir);
  await db.createTable(
    LANCE_TABLE,
    records as unknown as Record<string, unknown>[],
    { mode: "overwrite" },
  );

  return {
    records: records.length,
    table: LANCE_TABLE,
    path: outputDir,
    scope,
  };
}

// Reuse one open table handle per directory: eval loops call this once per query.
const tableCache = new Map<string, Promise<lancedb.Table>>();

export function openLanceTable(lanceDir: string): Promise<lancedb.Table> {
  let table = tableCache.get(lanceDir);
  if (!table) {
    table = lancedb.connect(lanceDir).then((db) => db.openTable(LANCE_TABLE));
    // Don't cache a rejection — drop it so a later call can retry.
    table.catch(() => tableCache.delete(lanceDir));
    tableCache.set(lanceDir, table);
  }
  return table;
}

export function defaultLanceDir(distDir: string): string {
  return path.join(distDir, "lance");
}