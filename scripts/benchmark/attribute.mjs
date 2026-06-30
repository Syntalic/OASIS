// Attribute every OASIS loss (baseline #1 correct, OASIS #1 not) to a cause, using oasis_search
// (routing) + the judge. Buckets:
//   ranking       = OASIS HAS an on-task endpoint in its top-3, just not at #1 (fixable by gate/ranking; no new data/ontology)
//   binding/cov   = routed to the right intent but surfaced no on-task endpoint (binding/coverage gap)
//   routing/onto  = did not even route to the query's home intent (routing miss or missing intent)
import { readFileSync, writeFileSync } from "node:fs";
const B = process.env.BENCH_DIR || "/tmp/oasis-bench";
const score = JSON.parse(readFileSync(`${B}/score.json`, "utf8"));
const J = JSON.parse(readFileSync(`${B}/judgments.json`, "utf8"));
const scoped = JSON.parse(readFileSync(`${B}/oasis_scoped.json`, "utf8"));
const { handleTool } = await import((process.env.OASIS_ROOT || process.cwd()) + "/mcp/tools.mjs");

const losses = score.acWins || [];
const out = [];
const hist = {};
let n = 0;
for (const q of losses) {
  let routed = [];
  try { const s = await handleTool("oasis_search", { query: q.query, limit: 3 }); routed = (s.capabilities || []).map((c) => c.intent_id); } catch {}
  const routingOk = routed.includes(q.intent_id);
  const top3 = (scoped[q.qid] || []).slice(0, 3);
  const hasCorrect = top3.some((e) => J[q.qid] && J[q.qid][e.url]);
  const bucket = hasCorrect ? "ranking" : routingOk ? "binding/cov" : "routing/onto";
  hist[bucket] = (hist[bucket] || 0) + 1;
  out.push({ qid: q.qid, intent_id: q.intent_id, query: q.query, routed_top: routed[0], routing_ok: routingOk, has_correct_in_top3: hasCorrect, bucket });
  if (++n % 20 === 0) process.stderr.write(`\r  ${n}/${losses.length}`);
}
process.stderr.write("\n");
writeFileSync(`${B}/attribution.json`, JSON.stringify({ hist, losses: out }, null, 2));
console.log(`\nLoss attribution (${losses.length} OASIS losses to the baseline):`);
const tot = losses.length || 1;
for (const [k, v] of Object.entries(hist).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(13)} ${v}  (${(100 * v / tot).toFixed(0)}%)`);
console.log("\n  ranking = we already have a correct endpoint, just mis-ranked → fixable, NO usage data needed");
console.log("  routing/onto = wrong intent / missing intent → ontology work, NOT the gate");
console.log("\nsample losses:");
for (const l of out.slice(0, 12)) console.log(`  [${l.bucket}] ${l.intent_id} (routed→${l.routed_top}) :: ${l.query.slice(0, 46)}`);
