// Shared OASIS tool definitions + handlers, used by both the MCP server
// (server.mjs) and the automated agent probe (probe.mjs). Wraps the built OASIS
// dist — hybrid discovery + query-aware resolve — as two agent-facing tools.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchHybridWithFallback } from "../dist/search-hybrid.js";
import { resolveEndpointsForQuery } from "../dist/select-policy.js";
import { loadEndpointArm } from "../dist/endpoint-arm.js";
import { embedText } from "../dist/embed/embedder.js";
import { relatedOptions } from "../dist/related.js";
import { curatedCapabilitiesForSearch } from "../dist/curated-search.js";
import { defaultLanceDir } from "../dist/embed/lance-index.js";
import { getTaxonomy } from "../dist/taxonomy.js";
import { validateSourceIntent } from "../dist/validate-source.js";
import { validateBinding } from "../dist/binding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");

const bundle = JSON.parse(readFileSync(path.join(DIST, "index.json"), "utf8"));
const lanceDir = defaultLanceDir(DIST);
const capById = new Map(
  curatedCapabilitiesForSearch(bundle).map((c) => [c.id, c]),
);

// Direct endpoint-embedding arm — a confidence-GATED fallback consulted only when the
// router is unsure (see oasisFind). Reuses the build-time endpoint-vector cache; reports
// notReady() (→ pure concentration) when the cache is absent, so this is safe before the
// vectors ship. The routing-margin threshold below which the arm takes over is tunable.
const endpointArm = loadEndpointArm(DIST, bundle.endpoints);
const MARGIN_GATE = Number(process.env.OASIS_MARGIN_GATE ?? "0.011");
if (endpointArm.ready) {
  console.error(`[oasis] endpoint arm ready (${endpointArm.size} endpoints, ${endpointArm.source}), margin gate < ${MARGIN_GATE}`);
}

const TOOLS = [
  {
    name: "oasis_search",
    description:
      "Discover which paid API capability (task intent) best fits a natural-language task. Returns ranked capability intents (the routing unit) plus a few example endpoints. Call this FIRST when you are unsure which tool/service to use.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The task in natural language." },
        limit: { type: "number", description: "Max results (default 8)." },
      },
      required: ["query"],
    },
  },
  {
    name: "oasis_resolve",
    description:
      "Given a capability intent id (from oasis_search) and the original query, return concrete paid endpoints ranked for that query, plus typed related options (alternatives / more-general / more-specific / next-step / prior-step) so you can pivot if needed.",
    schema: {
      type: "object",
      properties: {
        intent_id: { type: "string", description: "Capability id, e.g. shop.compare_price." },
        query: { type: "string", description: "The original natural-language task." },
        limit: { type: "number", description: "Max endpoints (default 8)." },
      },
      required: ["intent_id", "query"],
    },
  },
];

async function oasisSearch({ query, limit = 8 }) {
  const hits = await searchHybridWithFallback(query, bundle, lanceDir, limit);
  const capabilities = hits
    .filter((h) => h.kind === "capability")
    .map((h) => ({ intent_id: h.capability_id, label: h.label, summary: h.summary }));
  const endpoints = hits
    .filter((h) => h.kind === "endpoint")
    .slice(0, 3)
    .map((h) => ({ intent_id: h.capability_id, summary: h.label, target: `${h.method} ${h.origin}${h.path}`, price_usd: h.price_usd }));
  return { capabilities, endpoints };
}

function oasisResolve({ intent_id, query, limit = 8 }) {
  const intent = capById.get(intent_id);
  if (!intent) return { error: `unknown intent_id: ${intent_id}` };
  const endpoints = resolveEndpointsForQuery(intent, bundle.endpoints, query, limit).map(
    (e) => ({
      method: e.method,
      target: `${e.origin}${e.path}`,
      summary: e.summary,
      price_usd: e.payment?.price_usd,
      inputs: (e.inputs ?? []).slice(0, 8),
      rails: (e.payment?.rails ?? []).map((r) => r.protocol),
    }),
  );
  const related = relatedOptions(intent, bundle).map((r) => ({
    relation: r.relation_label,
    intent_id: r.intent_id,
    label: r.label,
  }));
  return { intent: { id: intent.id, label: intent.label }, endpoints, related };
}

// One-hop prototype: collapse search→resolve SERVER-side. Hybrid discovery (capability
// vectors give recall on oblique queries) is expanded into a single FLAT, ranked
// endpoint list with payment metadata inline — the agent makes ONE call and reads one
// compact list, no capability/resolve round-trip and no separate related[] payload.
async function oasisFind({ query, limit = 8 }) {
  const hits = await searchHybridWithFallback(query, bundle, lanceDir, 12);
  const out = [];
  const seen = new Set();
  const add = (method, origin, path, summary, price_usd, rails, via) => {
    const k = `${method} ${origin}${path}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ method, url: `${origin}${path}`, summary, price_usd, rails, via });
  };
  for (const h of hits) {
    if (h.kind === "endpoint") add(h.method, h.origin, h.path, h.label, h.price_usd, undefined, "match");
  }
  // Concentrate on the TOP-routed intent — return many of ITS providers — and pull only
  // a couple from each subsequent intent as a fallback (mainly when the top is thin).
  // Resolving 3 from every routed intent padded the list with adjacent-capability
  // endpoints, diluting precision (dogfooding tail-drift: ~38% vs ~72%).
  // For the top intent, prefer one endpoint per DISTINCT host first, so the flat list
  // maximizes distinct relevant providers instead of stacking several paths on one host.
  const caps = hits.filter((h) => h.kind === "capability");
  const hostOf = (origin) => origin.replace(/^https?:\/\//, "").split("/")[0];
  caps.forEach((h, i) => {
    if (out.length >= limit) return;
    const intent = capById.get(h.capability_id);
    if (!intent) return;
    const pool = resolveEndpointsForQuery(intent, bundle.endpoints, query, i === 0 ? limit * 3 : 4);
    const addEp = (e) =>
      add(e.method, e.origin, e.path, e.summary, e.payment?.price_usd, (e.payment?.rails ?? []).map((r) => r.protocol), h.capability_id);
    if (i === 0) {
      const seenHost = new Set();
      for (const e of pool) { if (out.length >= limit) break; const ho = hostOf(e.origin); if (seenHost.has(ho)) continue; seenHost.add(ho); addEp(e); }
      for (const e of pool) { if (out.length >= limit) break; addEp(e); } // fill remaining (allow same-host)
    } else {
      for (const e of pool.slice(0, 2)) { if (out.length >= limit) break; addEp(e); }
    }
  });
  // GATED endpoint arm: when the router was UNSURE — the top two intents are separated by
  // a hair (e.g. whois: cloud.domains 0.560 vs data.whois_lookup 0.559) — the intent layer
  // is the bottleneck (mis-route, or the right endpoints mis-bound to a sibling). A direct
  // query→endpoint cosine search bypasses both. A CONFIDENT route is returned untouched, so
  // the 38/40 wins are structurally protected (a naive merge cost −27; this only swaps the
  // close-race tail). Degrades to pure concentration when the vector cache is absent.
  const margin = caps.length >= 2 ? caps[0].score - caps[1].score : 1;
  if (endpointArm.ready && margin < MARGIN_GATE) {
    const queryVec = await embedText(query);
    const armHits = endpointArm.topK(queryVec, limit * 3);
    if (armHits.length) {
      const picked = [];
      const seenHost = new Set();
      for (const a of armHits) { if (picked.length >= limit) break; const ho = hostOf(a.ep.origin); if (seenHost.has(ho)) continue; seenHost.add(ho); picked.push(a); }
      for (const a of armHits) { if (picked.length >= limit) break; if (!picked.includes(a)) picked.push(a); }
      return {
        endpoints: picked.map((a) => ({
          method: a.ep.method,
          url: `${a.ep.origin}${a.ep.path}`,
          summary: a.ep.summary,
          price_usd: a.ep.payment?.price_usd,
          rails: (a.ep.payment?.rails ?? []).map((r) => r.protocol),
          via: "endpoint-arm",
        })),
      };
    }
  }
  return { endpoints: out.slice(0, limit) };
}

// oasis_next: from a query (routed) or an intent id, surface the ontology-graph
// follow-ups so an agent can dig deeper / chain tools instead of re-searching. The
// typed-link graph (pipes_to / narrower / broader / alternatives) is something flat
// keyword or spec-embedding search structurally can't offer.
async function oasisNext({ query, intent_id, limit = 12 }) {
  let intent;
  if (intent_id) {
    intent = capById.get(intent_id);
    if (!intent) return { error: `unknown intent_id: ${intent_id}` };
  } else if (query) {
    const hits = await searchHybridWithFallback(query, bundle, lanceDir, 5);
    const top = hits.find((h) => h.kind === "capability");
    if (!top) return { error: "no capability matched the query" };
    intent = capById.get(top.capability_id);
  } else {
    return { error: "provide a query or an intent_id" };
  }
  const options = relatedOptions(intent, bundle).slice(0, limit);
  const fmt = (o) => ({
    intent_id: o.intent_id,
    label: o.label,
    why: o.note,
    endpoint: o.top_endpoint
      ? `${o.top_endpoint.method} ${o.top_endpoint.origin}${o.top_endpoint.path}`
      : undefined,
    price_usd: o.top_endpoint?.price_usd,
  });
  const byRel = (rels) => options.filter((o) => rels.includes(o.relation)).map(fmt);
  return {
    intent: { id: intent.id, label: intent.label },
    next_steps: byRel(["pipes_to"]),
    drill_down: byRel(["broader_of"]),
    generalize: byRel(["narrower_of"]),
    alternatives: byRel(["alternative_of", "sibling_of"]),
    prior_steps: byRel(["fed_by"]),
  };
}

export async function handleTool(name, args) {
  if (name === "oasis_search") return oasisSearch(args ?? {});
  if (name === "oasis_resolve") return oasisResolve(args ?? {});
  if (name === "oasis_find") return oasisFind(args ?? {});
  if (name === "oasis_next") return oasisNext(args ?? {});
  if (name === "oasis_taxonomy") return getTaxonomy();
  if (name === "oasis_validate") return validateSourceIntent(args?.intent ?? args ?? {});
  if (name === "oasis_validate_binding") return validateBinding(args?.binding ?? args ?? {}, bundle.endpoints);
  return { error: `unknown tool: ${name}` };
}

/** The loaded index bundle + curated-capability lookup, for harnesses (compare.mjs). */
export { bundle, capById };

/** Anthropic Messages API tool shape ({ input_schema }). */
export const ANTHROPIC_TOOLS = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.schema,
}));

/** MCP tool shape ({ inputSchema }). The server exposes the one-hop primary tool
 *  (oasis_find), the lower-level search/resolve, and the contribution tools. */
const FIND_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", description: "The task in natural language." },
    limit: { type: "number", description: "Max endpoints (default 8)." },
  },
  required: ["query"],
};
const SERVER_TOOLS = [
  {
    name: "oasis_find",
    description:
      "Find the best paid HTTP API endpoints for a task in ONE call. Returns a ranked, flat list of endpoints (method, url, summary, price, payment rails). Use this first when an agent is unsure which tool/service to use.",
    schema: FIND_SCHEMA,
  },
  {
    name: "oasis_next",
    description:
      "Given a task (query) or a capability intent id, return ontology-graph FOLLOW-UPS to dig deeper: next_steps (what to do with the result next), drill_down / generalize (more specific / more general capabilities), alternatives, and prior_steps (what feeds this intent). Chains tools and explores a topic without re-searching from scratch.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The task in natural language (routed to an intent)." },
        intent_id: { type: "string", description: "A capability id, instead of a query." },
        limit: { type: "number", description: "Max follow-ups (default 12)." },
      },
    },
  },
  ...TOOLS,
  {
    name: "oasis_taxonomy",
    description:
      "Return the OASIS controlled vocabulary to bind a service INTO: existing task capabilities (+aliases), facet enums (domain/action/modality/freshness), and the closed entity vocab. Call before authoring or updating a capability.",
    schema: { type: "object", properties: {} },
  },
  {
    name: "oasis_validate",
    description:
      "Validate a proposed task-intent object (an ontology/intents capability) against the taxonomy: schema, facet/entity vocab, link targets. Returns { valid, isNew, errors, warnings }. SAME check CI runs on the PR.",
    schema: {
      type: "object",
      properties: { intent: { type: "object", description: "The capability intent object to validate." } },
      required: ["intent"],
    },
  },
  {
    name: "oasis_validate_binding",
    description:
      "Validate an authored endpoint→capability binding for a service: schema + capability ids exist in the taxonomy + whether the endpoints are in the index. Returns { valid, errors, warnings }. SAME check CI runs on the PR.",
    schema: {
      type: "object",
      properties: { binding: { type: "object", description: "Service binding: { bindings: [{ origin, method, path, capabilities }] }." } },
      required: ["binding"],
    },
  },
];
export const MCP_TOOLS = SERVER_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.schema,
}));

/** OpenAI Chat Completions tool shape ({ type:"function", function:{ parameters } }).
 *  Works with any OpenAI-compatible provider (OpenAI, OpenRouter, Together, Groq,
 *  Ollama, LM Studio, vLLM, ...). */
export const OPENAI_TOOLS = TOOLS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.schema },
}));
