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

export async function handleTool(name, args) {
  if (name === "oasis_search") return oasisSearch(args ?? {});
  if (name === "oasis_resolve") return oasisResolve(args ?? {});
  return { error: `unknown tool: ${name}` };
}

/** Anthropic Messages API tool shape ({ input_schema }). */
export const ANTHROPIC_TOOLS = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.schema,
}));

/** MCP tool shape ({ inputSchema }). */
export const MCP_TOOLS = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.schema,
}));
