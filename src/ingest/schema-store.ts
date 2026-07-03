import { createHash } from "node:crypto";
import type { JsonSchema } from "../core/types.js";

/** Deterministic JSON: object keys sorted recursively (RFC 8785 JCS semantics, sufficient for
 *  schema objects). Arrays keep order (significant in JSON Schema). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Content address = sha256 over canonical JSON. The hash IS the schema version. */
export function schemaRef(schema: JsonSchema): string {
  return createHash("sha256").update(canonicalJson(schema)).digest("hex");
}

/** Accumulates ref → schema, deduping identical schemas by hash. */
export class SchemaCollector {
  private map = new Map<string, JsonSchema>();
  add(schema: JsonSchema): string {
    const ref = schemaRef(schema);
    if (!this.map.has(ref)) this.map.set(ref, schema);
    return ref;
  }
  merge(other: SchemaCollector): void {
    for (const [k, v] of other.map) if (!this.map.has(k)) this.map.set(k, v);
  }
  toObject(): Record<string, JsonSchema> {
    return Object.fromEntries(this.map);
  }
  get size(): number {
    return this.map.size;
  }
}
