// Shared OASIS tool definitions + handlers, used by both the MCP server
// (server.mjs) and the automated agent probe (probe.mjs). Wraps the built OASIS
// dist — hybrid discovery + query-aware resolve — as two agent-facing tools.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchHybridWithFallback } from "../dist/search-hybrid.js";
import { resolveEndpointsForQuery } from "../dist/select-policy.js";
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
  for (const h of hits) {
    if (h.kind !== "capability" || out.length >= limit + 4) continue;
    const intent = capById.get(h.capability_id);
    if (!intent) continue;
    for (const e of resolveEndpointsForQuery(intent, bundle.endpoints, query, 3)) {
      add(e.method, e.origin, e.path, e.summary, e.payment?.price_usd, (e.payment?.rails ?? []).map((r) => r.protocol), h.capability_id);
    }
  }
  return { endpoints: out.slice(0, limit) };
}

export async function handleTool(name, args) {
  if (name === "oasis_search") return oasisSearch(args ?? {});
  if (name === "oasis_resolve") return oasisResolve(args ?? {});
  if (name === "oasis_find") return oasisFind(args ?? {});
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
