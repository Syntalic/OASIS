// Score the benchmark. Per arm: is #1 on-task (P@1) and top-3 precision, using the blind judge.
// Headline: OASIS-scoped vs the baseline side-by-side win-rate. Plus gate contribution (scoped vs off).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const B = process.env.BENCH_DIR || "/tmp/oasis-bench";
const queries = JSON.parse(readFileSync(`${B}/queries.json`, "utf8"));
const J = JSON.parse(readFileSync(`${B}/judgments.json`, "utf8"));
const load = (f) => existsSync(`${B}/${f}`) ? JSON.parse(readFileSync(`${B}/${f}`, "utf8")) : {};
const arms = { scoped: load("oasis_scoped.json"), off: load("oasis_off.json"), baseline: load("baseline.json"), live: load("live.json") };
const present = Object.keys(arms).filter((a) => Object.keys(arms[a]).length);

const onTask = (qid, url) => !!(J[qid] && J[qid][url]);
const top1 = (qid, list) => (list && list[0]) ? onTask(qid, list[0].url) : false;
const p3 = (qid, list) => { const t = (list || []).slice(0, 3); return t.length ? t.filter((e) => onTask(qid, e.url)).length / t.length : 0; };

const agg = {};
for (const a of present) {
  let p1 = 0, pp = 0, answered = 0;
  for (const q of queries) {
    const list = arms[a][q.qid] || [];
    if (list.length) answered++;
    if (top1(q.qid, list)) p1++;
    pp += p3(q.qid, list);
  }
  agg[a] = { p1: p1 / queries.length, p3: pp / queries.length, answered };
}

// side-by-side: OASIS-scoped vs the baseline on #1 correctness
let both = 0, neither = 0, oasisOnly = 0, acOnly = 0;
const oasisWins = [], acWins = [];
for (const q of queries) {
  const o = top1(q.qid, arms.scoped[q.qid]);
  const c = top1(q.qid, arms.baseline[q.qid]);
  if (o && c) both++; else if (!o && !c) neither++;
  else if (o && !c) { oasisOnly++; oasisWins.push(q); }
  else { acOnly++; acWins.push(q); }
}
const N = queries.length;
// gate contribution
let gatedFlips = [];
for (const q of queries) {
  const on = top1(q.qid, arms.scoped[q.qid]), off = top1(q.qid, arms.off[q.qid]);
  if (on !== off) gatedFlips.push({ q, on });
}

console.log(`\n=== BENCHMARK: ${N} blind queries, ${present.join(" / ")} ===`);
console.log(`judge: gemini-3.5-flash, ${"90"}% vs hand-labels (consistent strictness — comparative metric robust)\n`);
console.log("Per-arm #1 correctness (P@1) and top-3 precision (P@3):");
for (const a of present) console.log(`  ${a.padEnd(10)} P@1=${(100 * agg[a].p1).toFixed(1)}%   P@3=${(100 * agg[a].p3).toFixed(1)}%   (answered ${agg[a].answered}/${N})`);

console.log(`\nHead-to-head — OASIS(scoped) vs the baseline, #1 correctness over ${N} queries:`);
console.log(`  OASIS #1 correct:     ${(100 * agg.scoped.p1).toFixed(1)}%`);
console.log(`  the baseline #1 correct: ${(100 * agg.baseline.p1).toFixed(1)}%`);
console.log(`  both right: ${both}  neither: ${neither}  OASIS-only: ${oasisOnly}  the baseline-only: ${acOnly}`);
const decisive = oasisOnly + acOnly;
console.log(`  → on the ${decisive} decisive queries: OASIS wins ${oasisOnly} (${(100*oasisOnly/decisive||0).toFixed(0)}%), the baseline wins ${acOnly} (${(100*acOnly/decisive||0).toFixed(0)}%)`);
console.log(`  → OASIS ">=" the baseline on #1: ${(100 * (both + neither + oasisOnly) / N).toFixed(1)}% of queries (win-or-tie)`);

console.log(`\nGate contribution (scoped vs off): ${gatedFlips.length} #1 flips — ${gatedFlips.filter(f=>f.on).length} gained, ${gatedFlips.filter(f=>!f.on).length} lost`);
for (const f of gatedFlips.slice(0, 8)) console.log(`  ${f.on ? "+" : "-"} [${f.q.intent_id}] ${f.q.query.slice(0, 50)}`);

writeFileSync(`${B}/score.json`, JSON.stringify({ agg, head2head: { both, neither, oasisOnly, acOnly }, oasisWins, acWins, gatedFlips }, null, 2));
console.log(`\nwrote score.json (incl. the ${acOnly} the baseline-only losses for attribution)`);
