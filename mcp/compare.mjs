#!/usr/bin/env node
// End-to-end A/B: the SAME agent + SAME tasks, with ONLY the discovery tool
// swapped — OASIS (search -> resolve, with the ontology) vs raw keyword search
// over the endpoint index (what an agent does WITHOUT OASIS), sliced the same way
// as the offline eval (all / pay-skills / x402scan / mpp).
//
// Headline metric is a METHOD-NEUTRAL LLM judge: for each run, "does the agent's
// final CHOSEN endpoint actually accomplish the task?" — judged from the endpoint's
// own summary, independent of OASIS's curation. This is the fair number: it credits
// any working endpoint a baseline finds, not just ones OASIS happens to curate.
// A second column ("curated-match" = chosen endpoint is in OASIS's own
// satisfies/capabilities sets) is shown for reference, but it is biased toward OASIS
// (OASIS's resolve hands the agent exactly those endpoints) so it is NOT the headline.
//
// Provider-agnostic (see llm.mjs). Run: node --env-file=../.env compare.mjs
import { writeFileSync } from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { searchIndex } from "../dist/search/search.js";
import { resolveEndpointsForQuery } from "../dist/bind/select-policy.js";
import { embedText } from "../dist/embed/embedder.js";
import { embedEndpointsCached } from "../dist/embed/endpoint-cache.js";
import { endpointEmbedText } from "../dist/embed/endpoint-text.js";
import { runAgent, providerLabel, simpleComplete } from "./llm.mjs";
import { ANTHROPIC_TOOLS, OPENAI_TOOLS, handleTool, bundle, capById } from "./tools.mjs";
import { TASKS as COMMON_TASKS } from "./tasks.mjs";
import { TASKS as HARD_TASKS } from "./tasks-hard.mjs";

// COMPARE_TASKS=hard runs the trap/ambiguous set; default is the common set.
const TASKS = process.env.COMPARE_TASKS === "hard" ? HARD_TASKS : COMMON_TASKS;

const ENDPOINTS = bundle.endpoints;

// --- spec-embedding discovery: semantic search over endpoint spec vectors (the
// semantic-spec technique third-party registries use). Vectors come from the build
// cache, so this reuses them with no re-embedding. ---
const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));
const epText = endpointEmbedText; // shared with the binder so the cache hashes line up
console.error("loading endpoint vectors (cache) for the spec-embedding backend ...");
const { vectors: EP_VECS } = await embedEndpointsCached(ENDPOINTS.map(epText), nodePath.join(__dirname, "..", "dist", "cache"));
const dotp = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const specHandle = async (name, args) => {
  if (name !== "search_endpoints") return { error: `unknown tool: ${name}` };
  const { query, limit = 8 } = args ?? {};
  const qv = await embedText(query, "RETRIEVAL_QUERY");
  const k = Math.min(limit || 8, 8);
  const sc = new Array(k).fill(-Infinity), ix = new Array(k).fill(-1);
  for (let i = 0; i < ENDPOINTS.length; i++) {
    const s = dotp(qv, EP_VECS[i]);
    if (s > sc[k - 1]) { let j = k - 1; while (j > 0 && sc[j - 1] < s) { sc[j] = sc[j - 1]; ix[j] = ix[j - 1]; j--; } sc[j] = s; ix[j] = i; }
  }
  const endpoints = ix.filter((i) => i >= 0).map((i) => {
    const e = ENDPOINTS[i];
    return { method: e.method, url: `${e.origin}${e.path}`, summary: e.summary, price_usd: e.payment?.price_usd };
  });
  return { endpoints };
};

// --- baseline discovery tool: keyword search over a (sliced) endpoint corpus ---
const KW_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", description: "the task in natural language" },
    limit: { type: "number", description: "max results (default 8)" },
  },
  required: ["query"],
};
const KW_DESC =
  "Keyword search over paid HTTP API endpoint summaries. Returns matching endpoints (method, url, summary, price). Use it to find an API for the task.";
const KW_ANTHROPIC = [{ name: "search_endpoints", description: KW_DESC, input_schema: KW_SCHEMA }];
const KW_OPENAI = [{ type: "function", function: { name: "search_endpoints", description: KW_DESC, parameters: KW_SCHEMA } }];

const kwHandle = (corpus) => async (name, args) => {
  if (name !== "search_endpoints") return { error: `unknown tool: ${name}` };
  const { query, limit = 8 } = args ?? {};
  const endpoints = searchIndex(query, corpus, [], limit)
    .filter((h) => h.kind === "endpoint")
    .map((h) => ({ method: h.method, url: `${h.origin}${h.path}`, summary: h.label, price_usd: h.price_usd }));
  return { endpoints };
};

// Same instruction for every backend; only the available tool differs.
const RULES =
  "You are a tool-routing agent. Find which external PAID HTTP API the user should " +
  "call. Assume the task MUST be done via an external paid API — never answer from " +
  "your own knowledge, never ask for the payload. Pick exactly ONE endpoint. End " +
  "with exactly one line: CHOSEN <METHOD> <URL>";
const OASIS_SYSTEM = RULES + " Begin with oasis_search, then oasis_resolve (best capability id AND the original task) for concrete endpoints.";
const KW_SYSTEM = RULES + " Use search_endpoints to find candidates (try a few phrasings if the first is weak).";
const FIND_SYSTEM = RULES + " Call oasis_find with the task to get ranked paid endpoints (with price/rails), then pick one.";

// One-hop OASIS tool (oasis_find), handled by tools.mjs handleTool.
const FIND_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", description: "the task in natural language" },
    limit: { type: "number", description: "max endpoints (default 8)" },
  },
  required: ["query"],
};
const FIND_DESC =
  "Find the best paid HTTP API endpoints for a task in ONE call. Returns a ranked, flat list of endpoints (method, url, summary, price, payment rails). Use this first.";
const FIND_ANTHROPIC = [{ name: "oasis_find", description: FIND_DESC, input_schema: FIND_SCHEMA }];
const FIND_OPENAI = [{ type: "function", function: { name: "oasis_find", description: FIND_DESC, parameters: FIND_SCHEMA } }];

// Endpoint slices — same provider_fqn prefixes the offline eval uses.
const isScan = (e) => {
  const f = e.provider_fqn || "";
  return f.startsWith("x402scan/") || f.startsWith("mppscan/") || f.startsWith("mpp-catalog/");
};
const SLICES = {
  "keyword: all endpoints": ENDPOINTS,
  "keyword: pay-skills slice": ENDPOINTS.filter((e) => !isScan(e)),
  "keyword: x402scan slice": ENDPOINTS.filter((e) => (e.provider_fqn || "").startsWith("x402scan/")),
  "keyword: mpp slice": ENDPOINTS.filter((e) => {
    const f = e.provider_fqn || "";
    return f.startsWith("mppscan/") || f.startsWith("mpp-catalog/");
  }),
};

const BACKENDS = [
  { name: "OASIS 1-hop (find)", system: FIND_SYSTEM, anthropicTools: FIND_ANTHROPIC, openaiTools: FIND_OPENAI, handle: handleTool },
  { name: "OASIS 2-hop (search→resolve)", system: OASIS_SYSTEM, anthropicTools: ANTHROPIC_TOOLS, openaiTools: OPENAI_TOOLS, handle: handleTool },
  { name: "spec-embedding (semantic)", system: KW_SYSTEM, anthropicTools: KW_ANTHROPIC, openaiTools: KW_OPENAI, handle: specHandle },
  ...Object.entries(SLICES).map(([name, corpus]) => ({
    name, system: KW_SYSTEM, anthropicTools: KW_ANTHROPIC, openaiTools: KW_OPENAI, handle: kwHandle(corpus),
  })),
];

// --- scoring: did the agent's final CHOSEN endpoint do the task? ---
// Answer key per capability = the UNION of (a) its curated `satisfies` endpoints
// and (b) every endpoint tagged with it in `.capabilities`. Both are OASIS's own
// "this endpoint does X" signal; the union is the most generous, identical credit
// for every backend. (Keying only on `.capabilities` is wrong — it is sparse, most
// `satisfies` endpoints are NOT self-tagged — so it silently undercounts OASIS.)
const norm = (u) =>
  String(u)
    .trim()
    .replace(/^[<`'"(]+/, "")
    .replace(/[>`'".,)\]]+$/, "")
    .split(/[?#]/)[0]
    .replace(/\/+$/, "");

const answerKey = new Map(); // expect -> Set(normUrl)
for (const task of TASKS) {
  if (answerKey.has(task.expect)) continue;
  const set = new Set();
  const intent = capById.get(task.expect);
  if (intent) for (const e of resolveEndpointsForQuery(intent, ENDPOINTS, "", 999)) set.add(norm(`${e.origin}${e.path}`));
  for (const e of ENDPOINTS) if ((e.capabilities || []).includes(task.expect)) set.add(norm(`${e.origin}${e.path}`));
  answerKey.set(task.expect, set);
}

function pickUrl(final) {
  const lines = (final || "").split(/\r?\n/);
  const chosen = [...lines].reverse().find((l) => /CHOSEN/i.test(l));
  const fromChosen = chosen?.match(/https?:\/\/\S+/)?.[0];
  if (fromChosen) return norm(fromChosen);
  const urls = [...(final || "").matchAll(/https?:\/\/\S+/g)].map((m) => m[0]);
  return urls.length ? norm(urls[urls.length - 1]) : null;
}

// Map a chosen url back to a real indexed endpoint (exact, then lenient prefix).
const epByUrl = new Map();
for (const e of ENDPOINTS) {
  const u = norm(`${e.origin}${e.path}`);
  if (!epByUrl.has(u)) epByUrl.set(u, e);
}
function lookupEndpoint(url) {
  if (!url) return null;
  const e = epByUrl.get(url);
  if (e) return e;
  for (const cand of ENDPOINTS) {
    const cu = norm(`${cand.origin}${cand.path}`);
    if (cu.length > 16 && (url.startsWith(cu) || cu.startsWith(url))) return cand;
  }
  return null;
}

// HEADLINE metric — method-neutral LLM judge: does the chosen endpoint actually do
// the task? Independent of OASIS's curation, so it credits ANY working endpoint a
// baseline finds (the curated answerKey, by contrast, only credits OASIS's own
// satisfies/capabilities sets — biased toward OASIS). Cached per (task, url).
const JUDGE_SYS =
  "You evaluate whether a chosen paid API endpoint can accomplish a user's task. " +
  "Judge only whether the endpoint's purpose matches what the task needs. " +
  "Reply with exactly one word: YES or NO.";
// Fixed judge model (default Sonnet) so the metric is identical no matter which
// model drove the agent — a weak agent run must not be scored by a weak judge.
const JUDGE_MODEL = process.env.JUDGE_MODEL || undefined;
const judgeCache = new Map();
function judge(q, ep) {
  const key = q + "||" + norm(`${ep.origin}${ep.path}`);
  if (!judgeCache.has(key)) {
    judgeCache.set(
      key,
      simpleComplete({
        maxTokens: 4,
        model: JUDGE_MODEL,
        system: JUDGE_SYS,
        user: `Task: "${q}"\nChosen endpoint: ${ep.method} ${ep.origin}${ep.path}\nWhat it is: ${ep.summary || ""} — ${(ep.description || "").slice(0, 160)}\nCan this endpoint accomplish the task? YES or NO.`,
      })
        .then((r) => /\byes\b/i.test(r))
        .catch(() => false),
    );
  }
  return judgeCache.get(key);
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

// COMPARE_BACKENDS=oasis,all restricts to a subset (substring match on the name) to
// keep cost down on the weak-model / hard-task sweeps; default runs all backends.
const want = process.env.COMPARE_BACKENDS?.toLowerCase().split(",").map((s) => s.trim());
const RUN_BACKENDS = want ? BACKENDS.filter((b) => want.some((w) => b.name.toLowerCase().includes(w))) : BACKENDS;

const pairs = RUN_BACKENDS.flatMap((b) => TASKS.map((task) => ({ b, task })));
console.error(`running ${pairs.length} agent runs (${RUN_BACKENDS.length} backends × ${TASKS.length} tasks) on ${providerLabel()} ...`);
const results = await pool(pairs, 5, async ({ b, task }) => {
  try {
    const r = await runAgent({ system: b.system, query: task.q, anthropicTools: b.anthropicTools, openaiTools: b.openaiTools, handle: b.handle });
    const url = pickUrl(r.final);
    const ep = lookupEndpoint(url);
    const curatedHit = !!(url && answerKey.get(task.expect)?.has(url));
    const hit = ep ? await judge(task.q, ep) : false; // headline: neutral judge
    return { backend: b.name, expect: task.expect, url, known: !!ep, curatedHit, hit, calls: r.calls, tokensIn: r.tokensIn, tokensOut: r.tokensOut, finalTail: (r.final || "").slice(-160) };
  } catch (e) {
    return { backend: b.name, expect: task.expect, url: null, known: false, curatedHit: false, hit: false, calls: 0, tokensIn: 0, tokensOut: 0, error: String(e).slice(0, 80) };
  }
});
const detailPath = nodePath.join(os.tmpdir(), "oasis-compare-runs.json");
writeFileSync(detailPath, JSON.stringify(results));
console.error("per-run detail written to", detailPath);

const byBackend = new Map(RUN_BACKENDS.map((b) => [b.name, []]));
for (const r of results) byBackend.get(r.backend).push(r);

const pct = (h, n) => `${h}/${n} (${Math.round((h / n) * 100)}%)`;
const pad = (s, n) => String(s).padEnd(n);
console.log(`\n=== OASIS vs baseline discovery — end-to-end agent A/B (${providerLabel()}, ${TASKS.length} tasks) ===`);
console.log("HEADLINE = method-neutral LLM judge: did the agent's CHOSEN endpoint actually do the task?");
console.log("(curated = chosen endpoint is in OASIS's own satisfies/capabilities sets — biased toward OASIS, shown for reference)\n");
const avg = (rs, f) => rs.reduce((s, r) => s + (f(r) || 0), 0) / rs.length;
console.log(
  pad("discovery tool the agent had", 30) + pad("judged-correct", 15) +
    pad("avg tokens/task (in+out)", 26) + "avg tool-calls",
);
for (const b of RUN_BACKENDS) {
  const rs = byBackend.get(b.name);
  const hit = rs.filter((r) => r.hit).length;
  const tin = Math.round(avg(rs, (r) => r.tokensIn));
  const tout = Math.round(avg(rs, (r) => r.tokensOut));
  console.log(
    pad(b.name, 30) + pad(pct(hit, rs.length), 15) +
      pad(`${tin + tout}  (${tin} + ${tout})`, 26) + avg(rs, (r) => r.calls).toFixed(1),
  );
}
console.log("(curated-match column moved to the per-run detail json; tokens are uncached prompt+completion)");

const short = RUN_BACKENDS.map((b) => b.name.replace("OASIS (search→resolve)", "OASIS").replace("keyword: ", "kw:").replace(" slice", "").replace(" endpoints", ""));
console.log("\nper-task (✓ = judge says the agent's chosen endpoint accomplishes the task):");
console.log(pad("task", 26) + short.map((s) => pad(s, 12)).join(""));
for (const task of TASKS) {
  const cells = RUN_BACKENDS.map((b) => byBackend.get(b.name).find((r) => r.expect === task.expect));
  console.log(pad(task.expect, 26) + cells.map((c) => pad(c?.hit ? "✓" : "✗", 12)).join(""));
}
