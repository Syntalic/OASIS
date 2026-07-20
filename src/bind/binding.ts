import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { ValidateFunction } from "ajv";
import type { EndpointRecord, FieldMap } from "../core/types.js";
import type { EntityVocabDef } from "../entity/entity-tokens.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as (ajv: InstanceType<typeof Ajv>) => unknown;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEC = path.join(__dirname, "..", "..", "spec");
const INTENTS = path.join(__dirname, "..", "..", "ontology", "intents");
export const BINDINGS_DIR = path.join(__dirname, "..", "..", "ontology", "bindings");

export interface BindingEntry {
  origin: string;
  method: string;
  path: string;
  capabilities: string[];
  field_maps?: FieldMap[];
}
export interface ServiceBinding {
  provider?: string;
  note?: string;
  bindings: BindingEntry[];
}

const key = (origin: string, method: string, p: string) => `${origin}|${method.toUpperCase()}|${p}`;

let _validate: ValidateFunction | null = null;
async function validator(): Promise<void> {
  if (_validate) return;
  const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
  addFormats(ajv);
  const schema = JSON.parse(await readFile(path.join(SPEC, "binding.schema.json"), "utf8"));
  _validate = ajv.compile(schema);
}

let _capIds: Set<string> | null = null;
async function existingCapabilityIds(): Promise<Set<string>> {
  if (_capIds) return _capIds;
  const files = (await readdir(INTENTS).catch(() => [])).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const ids = new Set<string>();
  for (const f of files) {
    try {
      const s = parseYaml(await readFile(path.join(INTENTS, f), "utf8")) as { id?: string };
      if (s?.id) ids.add(s.id);
    } catch {
      /* skip */
    }
  }
  _capIds = ids;
  return ids;
}

let _vocab: Record<string, EntityVocabDef> | null = null;
async function entityVocab(): Promise<Record<string, EntityVocabDef>> {
  if (_vocab) return _vocab;
  const raw = JSON.parse(await readFile(path.join(SPEC, "entity-vocab.json"), "utf8")) as {
    entities?: Record<string, EntityVocabDef>;
  };
  _vocab = raw.entities ?? {};
  return _vocab;
}

/** Validate field_maps against the closed entity vocab (and its properties when declared). */
export function validateFieldMaps(
  fieldMaps: FieldMap[] | undefined,
  vocab: Record<string, EntityVocabDef>,
  loc: string,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!fieldMaps?.length) return { errors, warnings };

  for (let i = 0; i < fieldMaps.length; i++) {
    const fm = fieldMaps[i]!;
    const prefix = `${loc}.field_maps[${i}]`;
    if (!fm.entity || !vocab[fm.entity]) {
      // Also accept absorbed names as entity keys? Keep strict: canonical vocab keys only.
      const absorbed = Object.entries(vocab).some(([, d]) => d.absorbs?.includes(fm.entity));
      if (!vocab[fm.entity] && !absorbed) {
        errors.push(`${prefix}: unknown entity "${fm.entity}" — must be in entity-vocab.json`);
        continue;
      }
    }
    const def = vocab[fm.entity];
    if (def?.properties?.length) {
      const propNames = new Set(def.properties.map((p) => p.name));
      // Allow alias as property key only if it matches a property name (not alias) — property is the canonical field.
      if (!propNames.has(fm.property)) {
        errors.push(
          `${prefix}: property "${fm.property}" is not declared on entity "${fm.entity}" (known: ${[...propNames].join(", ")})`,
        );
      }
    } else {
      warnings.push(
        `${prefix}: entity "${fm.entity}" has no properties[] in the vocab — field map is accepted but untyped`,
      );
    }
    if (!fm.path?.trim()) {
      errors.push(`${prefix}: path must be non-empty`);
    }
  }
  return { errors, warnings };
}

/**
 * Apply a field map: place `value` into a request locations object.
 * Returns a shallow structure agents can merge into fetch options.
 */
export function applyFieldMapToRequest(
  maps: FieldMap[],
  values: Record<string, Record<string, unknown>>,
): { path: Record<string, unknown>; query: Record<string, unknown>; headers: Record<string, unknown>; body: Record<string, unknown> } {
  const out = {
    path: {} as Record<string, unknown>,
    query: {} as Record<string, unknown>,
    headers: {} as Record<string, unknown>,
    body: {} as Record<string, unknown>,
  };
  for (const fm of maps) {
    const v = values[fm.entity]?.[fm.property];
    if (v === undefined) continue;
    const loc =
      fm.in === "header" ? out.headers :
      fm.in === "path" ? out.path :
      fm.in === "query" ? out.query :
      out.body;
    // Simple path: last segment or full name if no $.
    const keyName = fm.path.startsWith("$.")
      ? fm.path.slice(2).split(".")[0]!
      : fm.path.replace(/^\{|\}$/g, "").split(".").pop()!;
    loc[keyName] = v;
  }
  return out;
}

export interface BindingValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a service binding: schema + every capability id exists in the taxonomy. If the
 * built endpoint set is provided, warn (not error) when a binding references an endpoint not
 * in the index — it may be a typo, or a service not ingested yet. Shared by the CLI, CI, and
 * the MCP `oasis_validate_binding` tool.
 */
export async function validateBinding(obj: unknown, endpoints?: EndpointRecord[]): Promise<BindingValidation> {
  await validator();
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!_validate!(obj)) {
    for (const e of _validate!.errors ?? []) errors.push(`schema: ${e.instancePath || "/"} ${e.message}`);
  }
  const sb = (obj ?? {}) as ServiceBinding;
  const caps = await existingCapabilityIds();
  const vocab = await entityVocab();
  const epKeys = endpoints ? new Set(endpoints.map((e) => key(e.origin, e.method, e.path))) : null;
  for (let bi = 0; bi < (sb.bindings ?? []).length; bi++) {
    const b = sb.bindings[bi]!;
    for (const c of b.capabilities ?? []) {
      if (!caps.has(c)) errors.push(`unknown capability "${c}" — must be an existing capability id (see \`capindex taxonomy\`)`);
    }
    if (epKeys && b.origin && b.method && b.path && !epKeys.has(key(b.origin, b.method, b.path))) {
      warnings.push(`no indexed endpoint matches ${b.method} ${b.origin}${b.path} (not ingested yet, or a typo)`);
    }
    const fm = validateFieldMaps(b.field_maps, vocab, `bindings[${bi}]`);
    errors.push(...fm.errors);
    warnings.push(...fm.warnings);
  }
  return { valid: errors.length === 0, errors, warnings };
}

export async function loadBindings(dir = BINDINGS_DIR): Promise<ServiceBinding[]> {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const out: ServiceBinding[] = [];
  for (const f of files) {
    try {
      out.push(parseYaml(await readFile(path.join(dir, f), "utf8")) as ServiceBinding);
    } catch {
      /* skip unparseable */
    }
  }
  return out;
}

/**
 * Apply authored bindings as an AUTHORITATIVE override of `endpoint.capabilities` for the
 * matched endpoints (by origin|method|path). Also materializes optional `field_maps`.
 * The materialized `satisfies[]` is then derived from the corrected capabilities.
 * Returns the number of endpoints overridden.
 */
export function applyBindings(endpoints: EndpointRecord[], bindings: ServiceBinding[]): number {
  // Drop previously materialised field_maps so a removed map does not stick across enrich runs.
  for (const e of endpoints) delete e.field_maps;

  const byKey = new Map(endpoints.map((e) => [key(e.origin, e.method, e.path), e]));
  let applied = 0;
  for (const sb of bindings) {
    for (const b of sb.bindings ?? []) {
      const ep = byKey.get(key(b.origin, b.method, b.path));
      if (ep) {
        ep.capabilities = [...b.capabilities];
        if (b.field_maps?.length) {
          ep.field_maps = b.field_maps.map((fm) => ({ ...fm }));
        }
        applied += 1;
      }
    }
  }
  return applied;
}

export async function validateBindingFile(file: string, endpoints?: EndpointRecord[]): Promise<BindingValidation> {
  return validateBinding(parseYaml(await readFile(file, "utf8")), endpoints);
}

/** Validate every ontology/bindings/*.yaml — the CI gate. */
export async function validateAllBindings(
  dir = BINDINGS_DIR,
  endpoints?: EndpointRecord[],
): Promise<{ file: string; result: BindingValidation }[]> {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  return Promise.all(files.map(async (f) => ({ file: f, result: await validateBindingFile(path.join(dir, f), endpoints) })));
}
