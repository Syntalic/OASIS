#!/usr/bin/env node
/**
 * Sync MCP tool descriptors from shipped mcp/tools.mjs → harness-tracked registry.
 * Never hand-edit .grok/.../mcps/oasis/tools/*.json — run this script instead.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MCP_TOOLS } from "../mcp/tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT =
  process.env.MCP_REGISTRY_DIR ??
  path.join(process.env.HOME ?? "", ".grok/projects/Users-azad/mcps/oasis/tools");

mkdirSync(OUT, { recursive: true });

for (const tool of MCP_TOOLS) {
  const dest = path.join(OUT, `${tool.name}.json`);
  writeFileSync(dest, `${JSON.stringify(tool, null, 2)}\n`, "utf8");
}

const nextPath = path.join(OUT, "oasis_next.json");
const next = readFileSync(nextPath, "utf8");

const errors = [];
if (!next.includes('"entities"')) errors.push("oasis_next.json missing entities");
if (!next.includes('"finding"')) errors.push("oasis_next.json missing finding");
if (!/investigative|bridging/i.test(next)) {
  errors.push("oasis_next.json missing investigative/bridging language");
}
if (next.includes("drill_down") || next.includes("next_steps")) {
  errors.push("oasis_next.json still contains legacy drill_down/next_steps");
}

if (errors.length) {
  console.error("MCP registry sync failed validation:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}

console.log(`synced ${MCP_TOOLS.length} tools → ${OUT}`);