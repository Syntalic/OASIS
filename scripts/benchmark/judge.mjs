// Blind LLM judge. For each query, judge the UNION of candidate endpoints surfaced by all arms
// (deduped by url) — the judge never sees which engine produced which result. Rules each: does
// this endpoint actually PERFORM the task in the query? Output: judgments.json {qid:{url:bool}}.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const KEY = process.env.GOOGLE_API_KEY;
const B = process.env.BENCH_DIR || "/tmp/oasis-bench";
const queries = JSON.parse(readFileSync(`${B}/queries.json`, "utf8"));
const ARMS = ["oasis_off", "oasis_scoped", "baseline", "live"].filter((a) => existsSync(`${B}/${a}.json`));
const arm = Object.fromEntries(ARMS.map((a) => [a, JSON.parse(readFileSync(`${B}/${a}.json`, "utf8"))]));
const TOPK = 3;

async function judge(query, cands) {
  const prompt = `A user issued this request: "${query}"
For each candidate API endpoint below, decide if it can ACTUALLY perform the user's requested task. Judge by the endpoint's real capability — read its URL path/name AND description together. Descriptions are often terse or technical; a short or jargon-y one that plausibly performs the task still counts. Set on_task=true if the endpoint performs the requested ACTION on the requested OBJECT. Set false only when it does a clearly DIFFERENT action or object than asked — e.g. a QR generator or a text-to-VIDEO model for an "image" request; a pricing/availability lookup for a "register/buy" request; a property-tax lookup for a "mortgage payment" request; a validation endpoint for a "find/lookup" request (and vice-versa). When the endpoint plausibly does the requested task, prefer true. Return a JSON array, one object per candidate by index i: { i, on_task: boolean }.
Candidates:
${cands.map((c, i) => `[${i}] ${c.url} :: ${c.summary || ""}`).join("\n")}`;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: {
    responseMimeType: "application/json", temperature: 0,
    responseSchema: { type: "ARRAY", items: { type: "OBJECT", required: ["i", "on_task"], properties: { i: { type: "INTEGER" }, on_task: { type: "BOOLEAN" } } } } } };
  for (let a = 0; a < 3; a++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.JUDGE_MODEL || "gemini-3.5-flash"}:generateContent?key=${KEY}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (r.ok) return JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text || "[]");
  }
  return [];
}

// calibration mode: judge a hand-authored gold set and report accuracy
if (process.argv[2] === "--calibrate") {
  const gold = JSON.parse(readFileSync(`${B}/calib.json`, "utf8")); // [{query, url, summary, gold}]
  let ok = 0, conf = [];
  for (const g of gold) {
    const v = (await judge(g.query, [{ url: g.url, summary: g.summary }]))[0];
    const pred = !!v?.on_task;
    if (pred === g.gold) ok++; else conf.push(`${g.gold?"TRUE":"FALSE"}→${pred?"TRUE":"FALSE"}: ${g.url} (${g.query.slice(0,40)})`);
  }
  console.log(`judge calibration: ${ok}/${gold.length} = ${(100*ok/gold.length).toFixed(0)}% agreement with hand-labels`);
  conf.forEach((c) => console.log("  miss:", c));
  process.exit(0);
}

const out = {};
let n = 0;
for (const q of queries) {
  const seen = new Map(); // url -> summary
  for (const a of ARMS) for (const e of (arm[a][q.qid] || []).slice(0, TOPK)) if (e?.url && !seen.has(e.url)) seen.set(e.url, e.summary);
  const cands = [...seen].map(([url, summary]) => ({ url, summary }));
  if (!cands.length) { out[q.qid] = {}; continue; }
  const verdicts = await judge(q.query, cands);
  const m = {};
  for (const v of verdicts) if (cands[v.i]) m[cands[v.i].url] = !!v.on_task;
  out[q.qid] = m;
  if (++n % 30 === 0) process.stderr.write(`\r  judged ${n}/${queries.length}`);
}
process.stderr.write("\n");
writeFileSync(`${B}/judgments.json`, JSON.stringify(out));
console.log(`wrote judgments for ${Object.keys(out).length} queries (arms: ${ARMS.join(", ")})`);
