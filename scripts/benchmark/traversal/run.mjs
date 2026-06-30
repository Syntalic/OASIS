// Traversal (next-step) benchmark — measures the OASIS moat a pure-vector engine can't produce.
//
// A pure-vector discovery engine (e.g. AgentCash) returns ONE ranked endpoint list and nothing
// else: it has no notion of "what you can do next". OASIS additionally surfaces the adjacent/
// downstream capabilities needed to finish a compound, multi-step workflow, via two key-free
// signals on the AUTHORED ontology:
//   (a) the typed capability graph — relatedOptions(intent, bundle): pipes_to / sibling_of /
//       alternative_of / broader_of / narrower_of / fed_by links, and
//   (b) entity-flow — suggestFollowUps seeded from the bridge identity the start intent PRODUCES
//       (Domain/Company/Person/Place/ProductCategory) → other-domain capabilities that consume it.
//
// For each compound task we resolve the union of (a)+(b) from the start intent ALONE (one call),
// rank it forward-first, and measure next-step recall@K (K=8) against a hand-authored gold set of
// the downstream capabilities the workflow actually needs. The contrast that IS the moat:
//   OASIS surfaces a real fraction of the needed next-steps; a vector-only engine surfaces 0.
//
// KEY-FREE: operates on the authored capability graph + entity-flow index only. No GOOGLE_API_KEY,
// no live embedding, no LLM. Run: OASIS_ROOT=/path/to/OASIS node scripts/benchmark/traversal/run.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.env.OASIS_ROOT || process.cwd();
const DIST = path.join(ROOT, "dist");
const K = Number(process.env.TRAVERSAL_K ?? "8"); // next-step budget the agent sees per call

const distImport = (rel) => import(pathToFileURL(path.join(DIST, rel)).href);
const { relatedOptions } = await distImport("search/related.js");
const { curatedCapabilitiesForSearch } = await distImport("search/curated-search.js");
const { extractEntities } = await distImport("entity/entity-extract.js");
const { loadEntityFlowRuntime, suggestFollowUps } = await distImport("entity/entity-flow-traverse.js");

const bundle = JSON.parse(readFileSync(path.join(DIST, "index.json"), "utf8"));
const tasks = JSON.parse(readFileSync(path.join(ROOT, "eval/benchmark/traversal-tasks.json"), "utf8")).tasks;

const curatedCaps = curatedCapabilitiesForSearch(bundle);
const capById = new Map(curatedCaps.map((c) => [c.id, c]));

// Entity-flow is optional — if the index lacks entity-index.json we fall back to the capability
// graph alone and SAY SO, so the reported number is never silently overstated.
let runtime = null;
try {
  runtime = await loadEntityFlowRuntime(DIST, curatedCaps);
} catch {
  runtime = null;
}

// Forward-first ordering for the K-budget: genuine "next steps" (pipes_to links + entity-flow
// consumers of the held identity) come first, then lateral options (alternatives/siblings/
// generalize/specialize), then prior steps (fed_by). Dedup by intent_id; the start is never itself.
const FORWARD_REL = new Set(["pipes_to"]);
const LATERAL_REL = new Set(["alternative_of", "sibling_of", "broader_of", "narrower_of"]);

function surfacedNextSteps(startId) {
  const intent = capById.get(startId);
  if (!intent) return null;

  // (a) capability-graph typed links
  const rel = relatedOptions(intent, bundle);

  // (b) entity-flow leads seeded from the start intent's produced bridge identity (the same
  // extract→suggest path oasis_next/oasis_find runs; no finding → structural-only, key-free rank).
  let ef = [];
  let entitiesHeld = [];
  if (runtime) {
    const ext = extractEntities({ source_intent_id: startId, bundle, capabilitiesById: capById });
    entitiesHeld = ext.entities.map((e) => e.entity);
    if (ext.entities.length) {
      const res = suggestFollowUps(
        { source_intent_id: startId, entities: ext.entities, exclude: [] },
        runtime,
        { limit: K, capabilities: curatedCaps, endpoints: bundle.endpoints },
      );
      ef = res.investigative;
    }
  }

  const ordered = [];
  const seen = new Set();
  const push = (intentId, via) => {
    if (!intentId || intentId === startId || seen.has(intentId)) return;
    seen.add(intentId);
    ordered.push({ intent_id: intentId, via });
  };
  for (const r of rel) if (FORWARD_REL.has(r.relation)) push(r.intent_id, `link:${r.relation}`);
  for (const f of ef) push(f.intent_id, `entity-flow:${f.bridging_entity}`);
  for (const r of rel) if (LATERAL_REL.has(r.relation)) push(r.intent_id, `link:${r.relation}`);
  for (const r of rel) if (r.relation === "fed_by") push(r.intent_id, `link:${r.relation}`);

  return { ordered, unionSize: ordered.length, relCount: rel.length, efCount: ef.length, entitiesHeld };
}

// ---- validate ids up front (a wrong intent_id silently scores 0 — fail loud instead) ----
const unknown = [];
for (const t of tasks) {
  if (!capById.has(t.start_intent)) unknown.push(`${t.id}: start_intent "${t.start_intent}"`);
  for (const g of t.gold_next_intents) if (!capById.has(g)) unknown.push(`${t.id}: gold "${g}"`);
}
if (unknown.length) {
  console.error("FATAL — intent_ids not present in dist/index.json capabilities:\n  " + unknown.join("\n  "));
  process.exit(1);
}

// ---- score ----
const rows = [];
let recallSum = 0;
let surfacedTotal = 0;
let goldTotal = 0;
for (const t of tasks) {
  const s = surfacedNextSteps(t.start_intent);
  const surfaced = s.ordered.slice(0, K);
  const surfacedSet = new Set(surfaced.map((x) => x.intent_id));
  const hits = t.gold_next_intents.filter((g) => surfacedSet.has(g));
  const missed = t.gold_next_intents.filter((g) => !surfacedSet.has(g));
  // A gold step that was in the full union but pushed past K by the budget is a truncation drop,
  // not an ontology gap — track it so misses can't be misread.
  const unionSet = new Set(s.ordered.map((x) => x.intent_id));
  const truncated = missed.filter((g) => unionSet.has(g));
  const recall = t.gold_next_intents.length ? hits.length / t.gold_next_intents.length : 0;
  recallSum += recall;
  surfacedTotal += hits.length;
  goldTotal += t.gold_next_intents.length;
  rows.push({ t, s, surfaced, hits, missed, truncated, recall });
}

const meanRecall = recallSum / tasks.length;
const microRecall = goldTotal ? surfacedTotal / goldTotal : 0;

// ---- report ----
const pct = (x) => `${(100 * x).toFixed(1)}%`;
console.log(`\n=== OASIS TRAVERSAL (next-step) BENCHMARK — ${tasks.length} compound tasks, recall@${K} ===`);
console.log(`index: ${path.join(DIST, "index.json")} (${curatedCaps.length} capabilities)`);
console.log(`signals: capability-graph relatedOptions + entity-flow ${runtime ? "suggestFollowUps" : "(UNAVAILABLE — capability-graph only)"}`);
if (!runtime) console.log("NOTE: entity-index.json not loaded — reporting capability-graph recall only.");
console.log(`key-free: GOOGLE_API_KEY ${process.env.GOOGLE_API_KEY ? "is set but UNUSED" : "not set"} (no embedding / no LLM)\n`);

const pad = (s, n) => String(s).padEnd(n);
console.log(pad("task id", 31) + pad("start_intent", 28) + pad("recall@" + K, 10) + "hit/gold  missed next-steps (genuine multi-hop / cross-domain gaps)");
console.log("-".repeat(140));
for (const r of rows) {
  const miss = r.missed.length
    ? r.missed.map((m) => (r.truncated.includes(m) ? `${m}*` : m)).join(", ")
    : "(none — all surfaced)";
  console.log(
    pad(r.t.id, 31) +
    pad(r.t.start_intent, 28) +
    pad(pct(r.recall), 10) +
    pad(`${r.hits.length}/${r.t.gold_next_intents.length}`, 10) +
    miss,
  );
}
console.log("-".repeat(140));
console.log("  (* = present in the surfaced union but pushed past the recall@" + K + " budget; not an ontology gap)\n");

console.log(`MEAN next-step recall@${K} (macro, per-task avg):  ${pct(meanRecall)}`);
console.log(`micro recall@${K} (gold steps surfaced / total):   ${pct(microRecall)}  (${surfacedTotal}/${goldTotal})`);
console.log(`\nVECTOR-ONLY BASELINE (AgentCash / any pure-vector engine): 0.0%`);
console.log(`  A vector index returns one ranked endpoint list with no relationship layer, so it`);
console.log(`  surfaces ZERO downstream next-steps by construction. That gap — ${pct(meanRecall)} vs 0% — is the moat.`);
