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
  const rc = key ? (responses[key].content as Record<string, { schema?: JsonSchema }> | undefined) : undefined;
  const outSchema = rc?.["application/json"]?.schema ?? Object.values(rc ?? {})[0]?.schema;
  const output = outSchema ? norm(outSchema) : undefined;

  return { input, output, truncated };
}

export function bazaarEndpointSchemas(resource: { accepts?: Array<Record<string, any>>; extensions?: any }): EndpointSchemas {
  let truncated = false;
  const norm = (s: JsonSchema): JsonSchema => {
    const r = normalizeSchema(s); truncated = truncated || r.truncated; return r.schema;
  };
  const os = resource.accepts?.find((a) => a.outputSchema)?.outputSchema;
  const bschema = resource.extensions?.bazaar?.schema as JsonSchema | undefined;
  const inRaw = os?.input;
  const outRaw = os?.output ?? bschema;
  return { input: inRaw ? norm(inRaw) : undefined, output: outRaw ? norm(outRaw) : undefined, truncated };
}
