// Generate a blind, per-intent query set. The generator sees ONLY each task definition — never
// any engine's behavior — so neither OASIS nor the baseline is favored. 3 styles/intent.
import { readFileSync, writeFileSync } from "node:fs";
const KEY = process.env.GOOGLE_API_KEY;
const B = process.env.BENCH_DIR || "/tmp/oasis-bench";
const intents = JSON.parse(readFileSync(`${B}/intents.json`, "utf8"));

async function gen(batch) {
  const prompt = `You write realistic natural-language queries that a person or AI agent would type to find a paid API for a task. For EACH task capability below, write exactly 3 queries:
- style "terse": a short keyword-style request.
- style "conversational": a natural full-sentence request.
- style "contextual": a natural request that includes a concrete real-world detail or proper noun (a place, brand, number, or name) relevant to the task — the kind of incidental token that can mislead naive keyword/vector matching.
Rules: describe the TASK only. NEVER mention "API", "endpoint", or the capability id/label. Make them sound like real user asks. Return a JSON array; each item { intent_id, query, style }.
Capabilities:
${batch.map((c) => `- ${c.id}: ${c.label} — ${c.summary}`).join("\n")}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json", temperature: 0.7,
      responseSchema: { type: "ARRAY", items: { type: "OBJECT", required: ["intent_id", "query", "style"], properties: {
        intent_id: { type: "STRING" }, query: { type: "STRING" }, style: { type: "STRING", enum: ["terse", "conversational", "contextual"] } } } },
    },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${KEY}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (r.ok) return JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text || "[]");
    process.stderr.write(`retry (${r.status})\n`);
  }
  return [];
}

const ids = new Set(intents.map((c) => c.id));
const out = [];
for (let i = 0; i < intents.length; i += 10) {
  const batch = intents.slice(i, i + 10);
  const qs = (await gen(batch)).filter((q) => ids.has(q.intent_id) && q.query);
  out.push(...qs);
  process.stderr.write(`\r  ${out.length} queries (${Math.min(i + 10, intents.length)}/${intents.length} intents)`);
}
process.stderr.write("\n");
out.forEach((q, i) => (q.qid = i + 1));
writeFileSync(`${B}/queries.json`, JSON.stringify(out, null, 2));
const byStyle = out.reduce((a, q) => ((a[q.style] = (a[q.style] || 0) + 1), a), {});
const intentsCovered = new Set(out.map((q) => q.intent_id)).size;
console.log(`wrote ${out.length} queries — ${intentsCovered}/${intents.length} intents covered; styles:`, byStyle);
console.log("samples:");
for (const q of [out[0], out[40], out[120], out[200]].filter(Boolean)) console.log(`  [${q.intent_id} / ${q.style}] ${q.query}`);
