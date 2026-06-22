#!/usr/bin/env node
// Automated agent probe: drive an LLM through OASIS (search -> resolve -> pick)
// on real tasks and measure whether OASIS leads it to the right capability.
// Provider-agnostic — see llm.mjs for config (LLM_PROVIDER=anthropic|openai).
// Run: node --env-file=../.env probe.mjs
import { runAgent, providerLabel } from "./llm.mjs";

// Real, oblique tasks (phrased away from intent labels) + the capability an
// agent SHOULD land on. Success is judged at the capability level (forgiving of
// which specific endpoint it picks — alternatives are fine).
const TASKS = [
  { q: "grab a screenshot of competitor.com's pricing page for a slide deck", expect: "web.screenshot" },
  { q: "what's one ether worth in dollars right now", expect: "finance.crypto_spot_price" },
  { q: "transcribe this earnings-call recording into text", expect: "ai.speech_to_text" },
  { q: "find the cheapest place to buy a Nintendo Switch", expect: "shop.compare_price" },
  { q: "translate this support reply into Japanese", expect: "data.translate_text" },
  { q: "before I email this list, which addresses will bounce", expect: "data.email_validate" },
  { q: "give me a well-sourced summary of recent EU AI Act news with citations", expect: "ai.web_research" },
  { q: "pull the line items and totals out of this PDF invoice", expect: "ai.document_extract" },
  { q: "should I pack an umbrella in Lisbon this weekend", expect: "data.weather_forecast" },
  { q: "find sushi restaurants near my hotel in Tokyo", expect: "maps.places" },
  { q: "send a one-time code over text to a customer's phone", expect: "comms.send_sms" },
  { q: "make an image of a robot barista", expect: "ai.image_generate" },
  { q: "who registered the domain acme.com and where is it hosted", expect: "data.whois_lookup" },
  { q: "what city is the visitor on IP 8.8.8.8 in", expect: "data.ip_lookup" },
  { q: "find two-bedroom apartments for sale in Miami", expect: "realestate.property_lookup" },
  { q: "turn these product descriptions into vectors for semantic search", expect: "ai.embeddings" },
  { q: "what's Nvidia stock doing today", expect: "finance.stock_quote" },
  { q: "scrape the full contents of this product page", expect: "data.web_scrape" },
];

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
