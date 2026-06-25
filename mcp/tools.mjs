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
import { loadEntityFlowRuntime, suggestFollowUps } from "../dist/entity-flow-traverse.js";
import { extractEntities } from "../dist/entity-extract.js";
import { curatedCapabilitiesForSearch } from "../dist/curated-search.js";
import { defaultLanceDir } from "../dist/embed/lance-index.js";
import { getTaxonomy } from "../dist/taxonomy.js";
import { validateSourceIntent } from "../dist/validate-source.js";
import { validateBinding } from "../dist/binding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");

const bundle = JSON.parse(readFileSync(path.join(DIST, "index.json"), "utf8"));
const lanceDir = defaultLanceDir(DIST);
const curatedCaps = curatedCapabilitiesForSearch(bundle);
const capById = new Map(curatedCaps.map((c) => [c.id, c]));

let entityFlowRuntime = null;
async function getEntityFlowRuntime() {
  if (entityFlowRuntime) return entityFlowRuntime;
  try {
    entityFlowRuntime = await loadEntityFlowRuntime(DIST, curatedCaps);
    return entityFlowRuntime;
  } catch {
    return null;
  }
}

// Direct endpoint-embedding arm — a confidence-GATED fallback consulted only when the
// router is unsure (see oasisFind). Reuses the build-time endpoint-vector cache; reports
// notReady() (→ pure concentration) when the cache is absent, so this is safe before the
// vectors ship. The routing-margin threshold below which the arm takes over is tunable.
const endpointArm = loadEndpointArm(DIST, bundle.endpoints);
// The arm fires when (1) the router was a near-tie — top-two intents within MARGIN_GATE —
// OR (2) the router was moderately unsure (margin < ARM_CONSIDER_MARGIN) AND the arm finds
// an endpoint whose query-cosine beats concentration's best by ARM_BEATS_DELTA. (1) catches
// routing mis-picks (whois, onchain); (2) catches mis-bindings the margin alone misses
// (domain_register, social_data) without disturbing the working low-margin routes.
const MARGIN_GATE = Number(process.env.OASIS_MARGIN_GATE ?? "0.011");
const ARM_CONSIDER_MARGIN = Number(process.env.OASIS_ARM_CONSIDER ?? "0.05");
const ARM_BEATS_DELTA = Number(process.env.OASIS_ARM_BEATS ?? "0.08");
if (endpointArm.ready) {
  console.error(`[oasis] endpoint arm ready (${endpointArm.size} endpoints, ${endpointArm.source}); gate: margin<${MARGIN_GATE} or (margin<${ARM_CONSIDER_MARGIN} & arm beats conc by ${ARM_BEATS_DELTA})`);
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
  if (endpointArm.ready && out.length && margin < ARM_CONSIDER_MARGIN) {
    const queryVec = await embedText(query);
    const armHits = endpointArm.topK(queryVec, limit * 3);
    // Gate signal 2: does the arm's best beat concentration's #1 on query-cosine by a clear
    // margin? (cosineToEndpoint reuses the same in-memory vectors — no extra embed call.)
    const concCosine = endpointArm.cosineToEndpoint(queryVec, `${out[0].method} ${out[0].url}`);
    const armTop = armHits[0]?.score ?? 0;
    const fire = margin < MARGIN_GATE || (concCosine != null && armTop - concCosine > ARM_BEATS_DELTA);
    if (fire && armHits.length) {
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

function fmtFollowUp(lead) {
  return {
    intent_id: lead.intent_id,
    label: lead.label,
    bridging_entity: lead.bridging_entity,
    match_kind: lead.match_kind,
    why: lead.why,
    score: lead.score,
    forward: [],
    endpoint: lead.top_endpoint
      ? {
          method: lead.top_endpoint.method,
          url: `${lead.top_endpoint.origin}${lead.top_endpoint.path}`,
          price_usd: lead.top_endpoint.price_usd,
          rails: lead.top_endpoint.rails,
        }
      : undefined,
  };
}

function legacyRelatedGroups(intent) {
  const options = relatedOptions(intent, bundle).slice(0, 12);
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
    next_steps: byRel(["pipes_to"]),
    drill_down: byRel(["broader_of"]),
    generalize: byRel(["narrower_of"]),
    alternatives: byRel(["alternative_of", "sibling_of"]),
    prior_steps: byRel(["fed_by"]),
  };
}

// oasis_next v1: cross-domain investigative leads from held identity entities.
async function oasisNext({
  finding,
  entities: explicitEntities,
  intent_id,
  query,
  exclude_intent_ids = [],
  limit = 8,
} = {}) {
  const runtime = await getEntityFlowRuntime();
  if (!runtime) {
    if (intent_id || query) {
      let intent;
      if (intent_id) {
        intent = capById.get(intent_id);
        if (!intent) return { error: `unknown intent_id: ${intent_id}` };
      } else {
        const hits = await searchHybridWithFallback(query, bundle, lanceDir, 5);
        const top = hits.find((h) => h.kind === "capability");
        if (!top) return { error: "no capability matched the query" };
        intent = capById.get(top.capability_id);
      }
      const legacy = legacyRelatedGroups(intent);
      return {
        source: { intent_id: intent.id, label: intent.label },
        forward: [],
        investigative: [],
        entity_context: { method: "legacy_fallback", held: [] },
        ...legacy,
        hint: "entity-flow index not built — rebuild with pnpm run build",
      };
    }
    return { error: "entity-flow index not available — run pnpm run build" };
  }

  let source_intent_id = intent_id;
  if (!source_intent_id && query) {
    const hits = await searchHybridWithFallback(query, bundle, lanceDir, 5);
    const top = hits.find((h) => h.kind === "capability");
    if (!top) return { error: "no capability matched the query" };
    source_intent_id = top.capability_id;
  }

  const extraction = extractEntities({
    finding,
    explicitEntities,
    source_intent_id,
    bundle,
    capabilitiesById: capById,
  });

  if (!extraction.entities.length) {
    return {
      error: "no entities held — pass entities[] or a finding with extractable typed nouns",
    };
  }

  const source = source_intent_id ? capById.get(source_intent_id) : undefined;

  // Topical relevance of the finding → intents: reuse oasis_find's hybrid search over the SAME
  // intent vectors, so oasis_next ranks bridges by relevance to the finding, not just by type.
  let topicalScores;
  const topicalText = finding || query;
  if (topicalText) {
    const hits = await searchHybridWithFallback(topicalText, bundle, lanceDir, 200);
    topicalScores = new Map();
    for (const h of hits) {
      if (h.kind === "capability" && !topicalScores.has(h.capability_id)) {
        topicalScores.set(h.capability_id, h.score);
      }
    }
  }

  const result = suggestFollowUps(
    {
      source_intent_id,
      entities: extraction.entities,
      exclude: exclude_intent_ids,
      finding,
    },
    runtime,
    { limit, capabilities: curatedCaps, endpoints: bundle.endpoints, topicalScores },
  );

  const out = {
    source: source ? { intent_id: source.id, label: source.label } : undefined,
    entity_context: { method: extraction.method, held: extraction.entities },
    forward: [],
    forward_note: "v2 — forward (process-output chaining) is always [] in v1",
    investigative: result.investigative.map(fmtFollowUp),
  };

  if (!out.investigative.length && extraction.entities.some((e) => e.kind === "observation")) {
    out.hint = "pass identity entities (e.g. Place, Company) for cross-domain leads";
  }

  if (process.env.OASIS_NEXT_LEGACY === "1" && source) {
    Object.assign(out, legacyRelatedGroups(source));
  }

  return out;
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
      "Given what an agent just found (finding) and/or typed identity entities it holds, return CALLABLE cross-domain investigative follow-ups — other-domain capabilities that consume an identity you hold. Each suggestion includes the bridging entity proving you can invoke it. Prefer passing entities[] explicitly. Forward chaining is v2 (forward always []).",
    schema: {
      type: "object",
      properties: {
        finding: { type: "string", description: "What the agent just learned — used for heuristic extraction when entities omitted." },
        entities: {
          type: "array",
          description: "Typed entities held (identity preferred for investigative leads).",
          items: {
            type: "object",
            properties: {
              entity: { type: "string" },
              value: { type: "string" },
              kind: { type: "string", enum: ["identity", "observation"] },
              source_intent_id: { type: "string" },
              role: { type: "string", enum: ["identifier", "payload"] },
            },
            required: ["entity"],
          },
        },
        intent_id: { type: "string", description: "Last capability invoked (source domain for cross-domain bias)." },
        query: { type: "string", description: "DEPRECATED — routes to intent when intent_id omitted." },
        exclude_intent_ids: { type: "array", items: { type: "string" } },
        limit: { type: "number", description: "Max investigative follow-ups (default 8)." },
      },
      anyOf: [
        { required: ["entities"] },
        { required: ["finding"] },
        { required: ["intent_id"] },
        { required: ["query"] },
      ],
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
