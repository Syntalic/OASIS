import { readFileSync } from "node:fs";
const B = process.env.BENCH_DIR || "/tmp/oasis-bench";
const ac = JSON.parse(readFileSync(`${B}/agentcash.json`, "utf8"));
const attr = JSON.parse(readFileSync(`${B}/attribution.json`, "utf8"));
const eps = JSON.parse(readFileSync((process.env.OASIS_ROOT || process.cwd()) + "/dist/endpoints.json", "utf8")).endpoints;
const host = (u) => (u || "").replace(/^https?:\/\//, "").split("/")[0];
const corpusHosts = new Set(eps.map((e) => host(e.origin)));
console.log("OASIS corpus hosts:", corpusHosts.size, "across", eps.length, "endpoints");

let present = 0, absent = 0;
const absentHosts = {};
for (const l of attr.losses) {
  if (l.bucket !== "binding/cov") continue;
  const h = host((ac[l.qid] || [])[0]?.url);
  if (corpusHosts.has(h)) present++;
  else { absent++; absentHosts[h] = (absentHosts[h] || 0) + 1; }
}
console.log("\nWithin the 29 binding/cov losses — is AgentCash's winning HOST in OASIS's corpus?");
console.log("  PRESENT (OASIS has the host, ranked >3 / unbound → binding/rank fix):", present);
console.log("  ABSENT  (OASIS never crawled it → COVERAGE gap):", absent);
console.log("\n  top absent hosts (wins OASIS can't produce — a crawl gap):");
for (const [h, c] of Object.entries(absentHosts).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`    ${c}x  ${h}`);

let totAbsent = 0;
for (const l of attr.losses) if (!corpusHosts.has(host((ac[l.qid] || [])[0]?.url))) totAbsent++;
console.log(`\nOf ALL 53 losses: ${totAbsent} on hosts OASIS never crawled (coverage), ${53 - totAbsent} on hosts OASIS already has (binding/ranking — fixable with our approach).`);
