#!/usr/bin/env node
// Materialize ontology/workflows/*.yaml -> dist/workflows.json: each VALID recipe plus a goal+aliases
// embedding used for query->workflow matching at serve time. Steps reference intent IDs only; the
// index resolves them to live endpoints when discover runs. Needs GOOGLE_API_KEY (gemini) like embed.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { validateWorkflow } from "../dist/ontology/validate-workflow.js";
import { embedText } from "../dist/embed/embedder.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "ontology", "workflows");
const OUT = path.join(ROOT, "dist", "workflows.json");

const files = (await readdir(SRC).catch(() => [])).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
const out = [];
let skipped = 0;
for (const f of files) {
  const src = parseYaml(await readFile(path.join(SRC, f), "utf8"));
  const v = await validateWorkflow(src);
  if (!v.valid) { console.error(`  skip ${f}: ${v.errors.join("; ")}`); skipped++; continue; }
  const vector = await embedText([src.goal, ...(src.aliases ?? [])].join(" \n "));
  out.push({ id: src.id, goal: src.goal, shape: src.shape, aliases: src.aliases ?? [], steps: src.steps, produces: src.produces, vector, ...(typeof src.match_threshold === "number" ? { match_threshold: src.match_threshold } : {}) });
  console.error(`  + ${src.id} (${src.steps.length} steps, dim ${vector.length})`);
}
await writeFile(OUT, JSON.stringify(out));
console.error(`workflows: ${out.length} materialized${skipped ? `, ${skipped} skipped (invalid)` : ""} -> dist/workflows.json`);
