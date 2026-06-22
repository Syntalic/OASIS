#!/usr/bin/env node
// Automated agent probe for the SHIPPED OASIS method (oasis_find): drive an LLM
// through one call -> pick, and measure whether it lands on an endpoint that does
// the task. Provider-agnostic — see llm.mjs (LLM_PROVIDER=anthropic|openai).
// Run: node --env-file=../.env probe.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent, providerLabel } from "./llm.mjs";
import { TASKS } from "./tasks.mjs";

// The shipped one-hop tool. (handleTool in tools.mjs serves oasis_find.)
const FIND_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", description: "the task in natural language" },
    limit: { type: "number", description: "max endpoints (default 8)" },
  },
  required: ["query"],
};
const FIND_DESC =
  "Find the best paid HTTP API endpoints for a task in ONE call. Returns a ranked, flat list of endpoints (method, url, summary, price, payment rails). Use this first.";
const FIND_ANTHROPIC = [{ name: "oasis_find", description: FIND_DESC, input_schema: FIND_SCHEMA }];
const FIND_OPENAI = [{ type: "function", function: { name: "oasis_find", description: FIND_DESC, parameters: FIND_SCHEMA } }];

const SYSTEM =
  "You are a tool-routing agent. Find which external PAID HTTP API the user should " +
  "call — assume the task MUST be done via an external paid API, never by you " +
  "directly, and never ask for the input payload. Call oasis_find with the task, then " +
  "pick exactly ONE endpoint. End your final reply with a line: CHOSEN <METHOD> <URL>";

// Answer key: the agent's CHOSEN endpoint must satisfy the expected capability.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundle = JSON.parse(readFileSync(path.join(__dirname, "..", "dist", "index.json"), "utf8"));
const norm = (u) =>
  String(u).trim().replace(/^[<`'"(]+/, "").replace(/[>`'".,)\]]+$/, "").split(/[?#]/)[0].replace(/\/+$/, "");
const urlCaps = new Map();
for (const e of bundle.endpoints) {
  const u = norm(`${e.origin}${e.path}`);
  let s = urlCaps.get(u);
  if (!s) urlCaps.set(u, (s = new Set()));
  for (const c of e.capabilities || []) s.add(c);
}
function chosenSatisfies(final, expect) {
  const line = (final || "").split(/\r?\n/).reverse().find((l) => /CHOSEN/i.test(l));
  const url = (line?.match(/https?:\/\/\S+/) ?? (final || "").match(/https?:\/\/\S+/))?.[0];
  return !!(url && urlCaps.get(norm(url))?.has(expect));
}

let chose = 0;
const rows = [];
for (const task of TASKS) {
  try {
    const r = await runAgent({
      system: SYSTEM,
      query: task.q,
      anthropicTools: FIND_ANTHROPIC,
      openaiTools: FIND_OPENAI,
    });
    const ok = chosenSatisfies(r.final, task.expect);
    if (ok) chose += 1;
    rows.push({ expect: task.expect, ok });
    console.error(`${ok ? "✓" : "✗"} ${task.expect}`);
  } catch (err) {
    rows.push({ expect: task.expect, error: String(err).slice(0, 80) });
    console.error(`✗ ${task.expect}  ERROR ${String(err).slice(0, 80)}`);
  }
}

const n = TASKS.length;
console.log(`\n=== OASIS oasis_find probe (${providerLabel()}, ${n} tasks) ===`);
console.log(`agent chose an endpoint of the right capability: ${chose}/${n} (${Math.round((chose / n) * 100)}%)`);
const misses = rows.filter((r) => !r.ok).map((r) => r.expect);
if (misses.length) console.log("misses: " + misses.join(", "));
