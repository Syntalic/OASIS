import type { JsonSchema } from "../core/types.js";
import { normalizeSchema } from "./schema-normalize.js";

export interface EndpointSchemas { input?: JsonSchema; output?: JsonSchema; truncated: boolean }

const LOC = (i: string): "path" | "query" | "headers" | null =>
  i === "path" ? "path" : i === "query" ? "query" : i === "header" ? "headers" : null;

export function openApiEndpointSchemas(
  op: Record<string, unknown>,
  resolve: (ref: string) => JsonSchema | undefined,
  oas30: boolean,
): EndpointSchemas {
  let truncated = false;
  const norm = (s: JsonSchema): JsonSchema => {
    const r = normalizeSchema(s, { oas30, resolve });
    truncated = truncated || r.truncated;
    return r.schema;
  };
  const props: Record<string, JsonSchema> = {};
  const required: string[] = [];

  // parameters → path/query/headers objects
  const buckets: Record<string, { properties: Record<string, unknown>; required: string[] }> = {};
  for (const raw of (op.parameters as Array<Record<string, unknown>> | undefined) ?? []) {
    const p = typeof raw.$ref === "string" ? resolve(raw.$ref) ?? raw : raw;
    const loc = LOC(String(p.in));
    if (!loc || typeof p.name !== "string") continue;
    (buckets[loc] ??= { properties: {}, required: [] });
    buckets[loc].properties[p.name] = p.schema ? norm(p.schema as JsonSchema) : {};
    if (p.required === true) buckets[loc].required.push(p.name);
  }
  for (const [loc, b] of Object.entries(buckets)) {
    props[loc] = { type: "object", properties: b.properties, ...(b.required.length ? { required: b.required } : {}) };
  }

  // requestBody → body
  let body = op.requestBody as Record<string, unknown> | undefined;
  if (body && typeof body.$ref === "string") body = resolve(body.$ref);
  const content = body?.content as Record<string, { schema?: JsonSchema }> | undefined;
  const bodySchema = content?.["application/json"]?.schema ?? Object.values(content ?? {})[0]?.schema;
  if (bodySchema) { props.body = norm(bodySchema); if (body?.required === true) required.push("body"); }

  const input = Object.keys(props).length
    ? ({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: props, ...(required.length ? { required } : {}) } as JsonSchema)
    : undefined;

  // responses → output
  const responses = (op.responses as Record<string, any> | undefined) ?? {};
  const key = responses["200"] ? "200" : Object.keys(responses).find((k) => /^2\d\d$/.test(k));
  // A 2xx whose response object is itself a $ref (#/components/responses/X) must be resolved before
  // reading .content — mirror the requestBody handling above, else output is silently omitted.
  let respObj = key ? (responses[key] as Record<string, unknown> | undefined) : undefined;
  if (respObj && typeof respObj.$ref === "string") respObj = resolve(respObj.$ref);
  const rc = respObj?.content as Record<string, { schema?: JsonSchema }> | undefined;
  const outSchema = rc?.["application/json"]?.schema ?? Object.values(rc ?? {})[0]?.schema;
  const output = outSchema ? norm(outSchema) : undefined;

  return { input, output, truncated };
}

/**
 * The x402 Bazaar `outputSchema.input` is NOT a JSON Schema — it is a transport
 * envelope: `{ type: "http", method, discoverable, queryParams?, body?/bodyFields? }`
 * where queryParams/body map a param name → `{ type, description?, required? }`.
 * Translate it into the same location-keyed object schema the OpenAPI path emits,
 * instead of normalizing the envelope directly (which would store `type:"http"` and
 * bury the real params under non-keyword fields).
 */
function paramMapToSchema(params: unknown): JsonSchema | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [name, raw] of Object.entries(params as Record<string, unknown>)) {
    const spec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const prop: JsonSchema = {};
    if (typeof spec.type === "string") prop.type = spec.type;
    if (typeof spec.description === "string") prop.description = spec.description;
    properties[name] = prop;
    if (spec.required === true) required.push(name);
  }
  if (!Object.keys(properties).length) return undefined;
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

function bazaarInputToSchema(input: unknown): JsonSchema | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const env = input as Record<string, unknown>;
  const props: Record<string, JsonSchema> = {};
  const query = paramMapToSchema(env.queryParams);
  const body = paramMapToSchema(env.body ?? env.bodyFields);
  if (query) props.query = query;
  if (body) props.body = body;
  if (!Object.keys(props).length) return undefined; // param-less request → no input contract
  return { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: props };
}

export function bazaarEndpointSchemas(resource: { accepts?: Array<Record<string, any>>; extensions?: any }): EndpointSchemas {
  let truncated = false;
  const norm = (s: JsonSchema): JsonSchema => {
    const r = normalizeSchema(s); truncated = truncated || r.truncated; return r.schema;
  };
  const os = resource.accepts?.find((a) => a.outputSchema)?.outputSchema;
  const bschema = resource.extensions?.bazaar?.schema as JsonSchema | undefined;
  const outRaw = os?.output ?? bschema; // output IS a JSON Schema (the response shape)
  return {
    input: bazaarInputToSchema(os?.input), // envelope → location-keyed schema (never normalized directly)
    output: outRaw ? norm(outRaw) : undefined,
    truncated,
  };
}
