#!/usr/bin/env node
/**
 * Facet-label DELTA tool. Compares the freshly-built endpoints (dist/endpoints.json) against the
 * authored labels (ontology/endpoint-facets.csv) and acts ONLY on the delta — endpoints that are
 * NEW or whose content changed since they were labeled. Change detection mirrors the embedder cache
 * (src/embed/endpoint-cache.ts): a content hash over the classifier-relevant text.
 *
 * Modes:
 *   --report                 (default) print the delta breakdown
 *   --emit-csv <path>        write the bound+unlabeled delta as a labeling CSV for a manual/external
 *                            model pass (seeding). Add --all to include unbound endpoints too.
 *   --merge <labeled.csv>    ingest a labeled CSV (hand-back from the manual pass) into the labels file
 *   --llm [--limit N]        classify the delta via gemini + merge into the labels file (going-forward
 *                            automation; run PRE-build, commit the result, then the build applies it)
 *
 * The labels file always gets a content_hash column written (baseline for future change detection).
 * Env: GOOGLE_API_KEY (for --llm), OASIS_CLASSIFY_MODEL (default gemini-2.0-flash-lite).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABELS = path.join(ROOT, "ontology", "endpoint-facets.csv");
const ENDPOINTS = path.join(ROOT, "dist", "endpoints.json");
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (k) => process.argv.includes(k);

const ACTIONS = ["search","lookup","compare","extract","generate","transform","validate","send","provision","analyze","execute","monitor"];
const DOMAINS = ["shop","ai","data","web","comms","finance","maps","travel","realestate","social","media","marketing","analyst","cloud","compute","devtools","storage","search","crypto"];

const contentHash = (e) =>
  createHash("sha256").update(`${e.method}\n${e.path}\n${e.summary ?? ""}\n${e.description ?? ""}\n${(e.inputs ?? []).join("|")}`).digest("hex").slice(0, 16);

function parseCsv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else if (c !== "\r") f += c; }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const cell = (v) => { const s = (v ?? "").toString().replace(/\r?\n/g, " "); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const COLS = ["key","method","path","origin","summary","description","inputs","bound_intents","regex_domain","content_hash","action","domain_corrected","entity"];
const rowFor = (e, extra = {}) => ({
  key: e.id, method: e.method, path: e.path, origin: e.origin,
  summary: (e.summary ?? "").slice(0, 200), description: (e.description ?? "").slice(0, 400),
  inputs: (e.inputs ?? []).join(" | "), bound_intents: (e.capabilities ?? []).join(" | "),
  regex_domain: e.facets?.domain ?? "", content_hash: contentHash(e),
  action: "", domain_corrected: "", entity: "", ...extra,
});
const writeCsv = (file, objs) => writeFileSync(file, [COLS.join(","), ...objs.map((o) => COLS.map((c) => cell(o[c])).join(","))].join("\n") + "\n");

// --- load state ---
const eps = JSON.parse(readFileSync(ENDPOINTS, "utf8")).endpoints;
const byId = new Map(eps.map((e) => [e.id, e]));
const labelRows = existsSync(LABELS) ? (() => {
  const rows = parseCsv(readFileSync(LABELS, "utf8")); const head = rows[0]; const ix = (n) => head.indexOf(n);
  return rows.slice(1).filter((r) => r.length > 1).map((r) => Object.fromEntries(COLS.map((c) => [c, ix(c) >= 0 ? r[ix(c)] ?? "" : ""])));
})() : [];
const labeled = new Map(labelRows.map((r) => [r.key, r]));

// --- delta detection ---
const isNew = (e) => !labeled.has(e.id);
const isChanged = (e) => { const r = labeled.get(e.id); return r && r.content_hash && r.content_hash !== contentHash(e); };
const bound = eps.filter((e) => e.capabilities?.length);
const deltaNew = eps.filter(isNew);
const deltaChanged = eps.filter(isChanged);
const boundUnlabeled = bound.filter(isNew);

function report() {
  console.log(`Facet-label delta — labels: ${labeled.size}  endpoints: ${eps.length} (bound ${bound.length})`);
  console.log(`  new (unlabeled):      ${deltaNew.length}   [bound: ${boundUnlabeled.length}, unbound: ${deltaNew.length - boundUnlabeled.length}]`);
  console.log(`  changed-content:      ${deltaChanged.length}`);
  console.log(`  labeled & current:    ${labeled.size - deltaChanged.length}`);
  const missingHash = labelRows.filter((r) => !r.content_hash).length;
  if (missingHash) console.log(`  (note: ${missingHash} existing labels have no content_hash baseline yet — run --llm or --merge to write it, or it backfills on next write)`);
}

// --- writes ---
function writeLabels(rows) {
  // refresh content_hash for any row whose endpoint still exists (baseline maintenance)
  for (const r of rows) { const e = byId.get(r.key); if (e) r.content_hash = contentHash(e); }
  writeCsv(LABELS, rows);
  console.log(`wrote ${rows.length} labels → ${LABELS}`);
}

// --- gemini classifier (action + domain) ---
async function classifyBatch(batch, model, key) {
  const items = batch.map((e, i) => ({ i, method: e.method, path: e.path,
    summary: (e.summary ?? "").slice(0, 180), description: (e.description ?? "").slice(0, 240),
    inputs: (e.inputs ?? []).slice(0, 8), bound_intents: e.capabilities ?? [] }));
  const prompt = `You classify paid HTTP API endpoints for a discovery index. For EACH endpoint assign:
- action: what it DOES — one of: ${ACTIONS.join(", ")}
- domain: its topic area — one of: ${DOMAINS.join(", ")}
Action guide: provision=create/register/buy/renew a resource; lookup=fetch known data by id/params (get/check/whois/list); search=find by query; extract=pull structured data out (OCR/parse/scrape); generate=create NEW content (image/TTS/text); transform=convert existing content (translate/resize); validate=verify correctness; send=deliver a message; analyze=score/assess/sentiment; execute=run code/transaction/RPC; monitor=watch/alert over time; compare=compare same item across sources.
Classify the ENDPOINT's own function independently; bound_intents is context only. Return a JSON array, one object per endpoint with its index i.
Endpoints: ${JSON.stringify(items)}`;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: {
    responseMimeType: "application/json", temperature: 0,
    responseSchema: { type: "ARRAY", items: { type: "OBJECT", required: ["i", "action", "domain"], properties: {
      i: { type: "INTEGER" }, action: { type: "STRING", enum: ACTIONS }, domain: { type: "STRING", enum: DOMAINS } } } },
  } };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const out = JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]");
  return { out, usage: j.usageMetadata ?? {} };
}

async function runLlm() {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY required for --llm (load via: set -a; . ./.env; set +a)");
  const model = process.env.OASIS_CLASSIFY_MODEL ?? "gemini-flash-lite-latest";
  const limit = arg("--limit") ? Number(arg("--limit")) : Infinity;
  const targets = [...deltaNew.filter((e) => e.capabilities?.length), ...deltaChanged].slice(0, limit);
  console.log(`classifying ${targets.length} delta endpoint(s) with ${model} (batched)…`);
  const merged = new Map(labelRows.map((r) => [r.key, r]));
  let inTok = 0, outTok = 0, done = 0;
  const BATCH = 20;
  for (let b = 0; b < targets.length; b += BATCH) {
    const batch = targets.slice(b, b + BATCH);
    const { out, usage } = await classifyBatch(batch, model, key);
    inTok += usage.promptTokenCount ?? 0; outTok += usage.candidatesTokenCount ?? 0;
    for (const o of out) { const e = batch[o.i]; if (!e) continue;
      merged.set(e.id, rowFor(e, { action: o.action, domain_corrected: o.domain })); }
    done += batch.length;
    process.stderr.write(`\r  ${done}/${targets.length}`);
  }
  process.stderr.write("\n");
  const usd = (inTok / 1e6) * 0.075 + (outTok / 1e6) * 0.30;
  if (has("--dry")) {
    console.log("DRY (not written) — sample classifications:");
    for (const e of targets.slice(0, 12)) { const r = merged.get(e.id); console.log(`  [${(r.action||"?").padEnd(9)} ${(r.domain_corrected||"?").padEnd(8)}] ${e.origin}${e.path} :: ${(e.summary || "").slice(0, 46)}`); }
  } else writeLabels([...merged.values()]);
  console.log(`tokens: in ${inTok} out ${outTok}  ~$${usd.toFixed(4)} (flash-lite est.); full ~${bound.length - labeled.size} bound-unlabeled ≈ $${(((inTok + outTok) / targets.length) * (bound.length - labeled.size) / 1e6 * 0.15).toFixed(2)}`);
}

// --- dispatch ---
const mode = arg("--emit-csv") ? "emit" : arg("--merge") ? "merge" : has("--llm") ? "llm" : "report";
if (mode === "report") report();
else if (mode === "emit") {
  const out = arg("--emit-csv");
  const pool = has("--all") ? deltaNew : boundUnlabeled;
  writeCsv(out, pool.map((e) => rowFor(e)));
  console.log(`emitted ${pool.length} endpoints for labeling → ${out}`);
  console.log(`  (fill action + domain_corrected + entity; hand back; then: node scripts/classify-delta.mjs --merge ${out})`);
} else if (mode === "merge") {
  const inc = parseCsv(readFileSync(arg("--merge"), "utf8")); const head = inc[0]; const ix = (n) => head.indexOf(n);
  const merged = new Map(labelRows.map((r) => [r.key, r]));
  let n = 0;
  for (const r of inc.slice(1)) { if (r.length <= ix("key") || !r[ix("key")]) continue;
    const o = Object.fromEntries(COLS.map((c) => [c, ix(c) >= 0 ? r[ix(c)] ?? "" : ""]));
    if (!o.action) continue; // only ingest rows that were actually labeled
    merged.set(o.key, o); n++; }
  writeLabels([...merged.values()]);
  console.log(`merged ${n} labeled row(s)`);
} else await runLlm();
