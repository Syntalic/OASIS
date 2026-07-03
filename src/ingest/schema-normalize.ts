import type { JsonSchema } from "../core/types.js";

export const DIALECT_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const MAX_NODES = 2000; // lowered from 4000: Node 26 walk() stack depth ~2836; cap must fire before overflow
const OAS_ONLY_KEYS = ["nullable", "example", "xml", "discriminator", "externalDocs"];

interface Ctx {
  resolve?: (ref: string) => JsonSchema | undefined;
  oas30: boolean;
  defs: Record<string, JsonSchema>;
  seen: Set<string>;
  nodes: number;
  truncated: boolean;
}

function refName(ref: string): string {
  return ref.split("/").pop() || ref;
}

function walk(node: unknown, ctx: Ctx): unknown {
  if (Array.isArray(node)) return node.map((n) => walk(n, ctx));
  if (!node || typeof node !== "object") return node;
  if (++ctx.nodes > MAX_NODES) { ctx.truncated = true; return {}; }
  const src = node as Record<string, unknown>;

  if (typeof src.$ref === "string") {
    const ref = src.$ref;
    const name = refName(ref);
    if (ctx.resolve && ref.startsWith("#/")) {
      if (!ctx.seen.has(name)) {
        ctx.seen.add(name);
        const target = ctx.resolve(ref);
        ctx.defs[name] = target ? (walk(target, ctx) as JsonSchema) : {};
      }
      return { $ref: `#/$defs/${name}` };
    }
    return { $ref: ref }; // foreign/remote — leave as-is
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (ctx.oas30 && OAS_ONLY_KEYS.includes(k)) continue;
    out[k] = walk(v, ctx);
  }
  if (ctx.oas30) {
    if (src.nullable === true) {
      const t = out.type;
      if (typeof t === "string") out.type = [t, "null"];
      else if (Array.isArray(t) && !t.includes("null")) out.type = [...t, "null"];
    }
    if ("example" in src && !("examples" in out)) out.examples = [src.example];
  }
  return out;
}

/** Normalize any source schema to a self-contained JSON Schema 2020-12 document. */
export function normalizeSchema(
  schema: JsonSchema,
  opts: { oas30?: boolean; resolve?: (ref: string) => JsonSchema | undefined } = {},
): { schema: JsonSchema; truncated: boolean } {
  const ctx: Ctx = { resolve: opts.resolve, oas30: opts.oas30 ?? false, defs: {}, seen: new Set(), nodes: 0, truncated: false };
  const body = walk(schema, ctx) as Record<string, unknown>;
  const result: JsonSchema = { ...body, $schema: DIALECT_2020_12 };
  if (Object.keys(ctx.defs).length) result.$defs = { ...(result.$defs as object ?? {}), ...ctx.defs };
  return { schema: result, truncated: ctx.truncated };
}
