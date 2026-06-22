#!/usr/bin/env node
// Automated agent probe: drive an LLM through OASIS (search -> resolve -> pick)
// on real tasks and measure whether OASIS leads it to the right capability.
// Provider-agnostic — see llm.mjs for config (LLM_PROVIDER=anthropic|openai).
// Run: node --env-file=../.env probe.mjs
import { runAgent, providerLabel } from "./llm.mjs";
import { TASKS } from "./tasks.mjs";

const SYSTEM =
  "You are a tool-routing agent. Your ONLY job is to find which external PAID HTTP " +
  "API the user should call — assume the task MUST be done via an external paid API, " +
  "never by you directly, and never ask for the input payload. " +
  "ALWAYS begin by calling oasis_search with the task, then oasis_resolve (best " +
  "capability id AND the original task) for concrete endpoints. " +
  "Pick exactly ONE endpoint. End your final reply with a line: CHOSEN <intent_id> <METHOD> <url>";

const runTask = (task) => runAgent({ system: SYSTEM, query: task.q });

const rows = [];
let discoveredTop3 = 0, resolvedRight = 0, chosenRight = 0;
for (const task of TASKS) {
  try {
    const r = await runTask(task);
    const inTop3 = r.searchTop3.includes(task.expect);
    const resolvedExpect = r.resolved.includes(task.expect);
    const choseExpect = new RegExp(`CHOSEN\\s+${task.expect.replace(/[.]/g, "\\.")}\\b`).test(r.final);
    if (inTop3) discoveredTop3++;
    if (resolvedExpect) resolvedRight++;
    if (choseExpect) chosenRight++;
    rows.push({ q: task.q.slice(0, 48), expect: task.expect, inTop3, resolvedExpect, choseExpect, calls: r.calls });
    console.error(`${choseExpect ? "✓" : resolvedExpect ? "~" : "✗"} ${task.expect}  (search-top3:${inTop3} resolved:${resolvedExpect} chose:${choseExpect})`);
  } catch (err) {
    rows.push({ q: task.q.slice(0, 48), expect: task.expect, error: String(err).slice(0, 80) });
    console.error(`✗ ${task.expect}  ERROR ${String(err).slice(0, 80)}`);
  }
}

const n = TASKS.length, p = (x) => `${x}/${n} (${Math.round((x / n) * 100)}%)`;
console.log("\n=== OASIS agent probe (" + providerLabel() + ", " + n + " tasks) ===");
console.log("expected capability in search top-3:   " + p(discoveredTop3));
console.log("agent RESOLVED the expected capability: " + p(resolvedRight));
console.log("agent CHOSE an endpoint of expected cap: " + p(chosenRight));
console.log("\nmisses:");
for (const r of rows.filter((r) => !r.choseExpect)) console.log("  " + r.expect + "  " + JSON.stringify({ inTop3: r.inTop3, resolved: r.resolvedExpect, err: r.error }));
