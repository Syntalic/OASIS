// Run all benchmark queries through local oasis_find (handleTool = same code path the MCP server
// uses). Gate config comes from env (read at module load), so run twice: gate-off and scoped-on.
import { readFileSync, writeFileSync } from "node:fs";
const B = process.env.BENCH_DIR || "/tmp/oasis-bench";
const out = process.argv[2];
const queries = JSON.parse(readFileSync(`${B}/queries.json`, "utf8"));
const { handleTool } = await import((process.env.OASIS_ROOT || process.cwd()) + "/mcp/tools.mjs");
const res = {};
let n = 0;
for (const q of queries) {
  try {
    const r = await handleTool("oasis_find", { query: q.query, limit: 5 });
    res[q.qid] = (r.endpoints || []).map((e) => ({ url: e.url, summary: (e.summary || "").slice(0, 200), via: e.via }));
  } catch (e) { res[q.qid] = []; }
  if (++n % 40 === 0) process.stderr.write(`\r  ${n}/${queries.length}`);
}
process.stderr.write("\n");
writeFileSync(out, JSON.stringify(res));
console.log(`wrote ${Object.keys(res).length} → ${out}  [gate: action=${process.env.OASIS_ACTION_PENALTY ?? "0"} gated=${process.env.OASIS_GATED_INTENTS ?? "(none)"}]`);
