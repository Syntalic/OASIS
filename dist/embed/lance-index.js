import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as lancedb from "@lancedb/lancedb";
import { loadCuratedIntentIds } from "./curated-intents.js";
import { embedTexts } from "./embedder.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..", "..");
export const LANCE_TABLE = "search";
export function capabilityEmbedText(cap) {
    return [
        cap.id,
        cap.label,
        cap.description,
        ...(cap.aliases ?? []),
        ...(cap.schema_org ?? []),
    ]
        .filter(Boolean)
        .join(" ");
}
export function buildLanceRecords(bundle, scope = "all", curatedIds) {
    const records = [];
    for (const cap of bundle.capabilities) {
        if (scope === "curated" && !(curatedIds?.has(cap.id) ?? false))
            continue;
        records.push({
            id: cap.id,
            kind: "capability",
            text: capabilityEmbedText(cap),
            vector: [],
        });
    }
    return records;
}
export async function buildLanceIndex(bundle, outputDir, scope = "all") {
    const curatedIds = scope === "curated"
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
    await db.createTable(LANCE_TABLE, records, { mode: "overwrite" });
    return {
        records: records.length,
        table: LANCE_TABLE,
        path: outputDir,
        scope,
    };
}
// Reuse one open table handle per directory: eval loops call this once per query.
const tableCache = new Map();
export function openLanceTable(lanceDir) {
    let table = tableCache.get(lanceDir);
    if (!table) {
        table = lancedb.connect(lanceDir).then((db) => db.openTable(LANCE_TABLE));
        // Don't cache a rejection — drop it so a later call can retry.
        table.catch(() => tableCache.delete(lanceDir));
        tableCache.set(lanceDir, table);
    }
    return table;
}
export function defaultLanceDir(distDir) {
    return path.join(distDir, "lance");
}
//# sourceMappingURL=lance-index.js.map