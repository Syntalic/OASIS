import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { ValidateFunction } from "ajv";
import type { CuratedIntentSource } from "./types.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as (ajv: InstanceType<typeof Ajv>) => unknown;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEC = path.join(__dirname, "..", "spec");
const INTENTS = path.join(__dirname, "..", "ontology", "intents");

export interface SourceValidation {
  id: string | null;
  valid: boolean;
  /** true when `id` is not an existing capability — a proposed NEW cluster that needs
   *  human review in the PR (the curator should prefer binding into an existing one). */
  isNew: boolean;
  errors: string[];
  warnings: string[];
}

let _validate: ValidateFunction | null = null;
async function schemaValidator(): Promise<void> {
  if (_validate) return;
  const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
  addFormats(ajv);
  const schema = JSON.parse(await readFile(path.join(SPEC, "ontology-source.schema.json"), "utf8"));
  _validate = ajv.compile(schema);
}

let _entities: Set<string> | null = null;
async function entityVocab(): Promise<Set<string>> {
  if (_entities) return _entities;
  const vocab = JSON.parse(await readFile(path.join(SPEC, "entity-vocab.json"), "utf8"));
  const set = new Set<string>();
  for (const [name, def] of Object.entries<{ absorbs?: string[] }>(vocab.entities ?? {})) {
    set.add(name);
    for (const a of def.absorbs ?? []) set.add(a);
  }
  _entities = set;
  return set;
}

async function existingIds(): Promise<Set<string>> {
  const files = (await readdir(INTENTS).catch(() => [])).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
  );
  const ids = new Set<string>();
  for (const f of files) {
    try {
      const src = parseYaml(await readFile(path.join(INTENTS, f), "utf8")) as CuratedIntentSource;
      if (src?.id) ids.add(src.id);
    } catch {
      /* skip */
    }
  }
  return ids;
}

/**
 * Validate a contributor-authored task intent (the artifact a curator/agent produces
 * for a service). Shared by the CLI, the CI gate, and the MCP `oasis_validate` tool —
 * ONE implementation, so a binding can't pass at authoring time and fail review.
 * Checks: ontology-source schema; consumes/produces use the CLOSED entity vocab;
 * link targets resolve; and whether the id binds into an existing capability (good)
 * or proposes a new one (allowed, flagged for review).
 */
export async function validateSourceIntent(source: unknown): Promise<SourceValidation> {
  await schemaValidator();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!_validate!(source)) {
    for (const e of _validate!.errors ?? []) errors.push(`schema: ${e.instancePath || "/"} ${e.message}`);
  }

  const src = (source ?? {}) as CuratedIntentSource;
  const id = typeof src.id === "string" ? src.id : null;

  // Closed entity vocab — the schema lets `entity` be any string; enforce the controlled
  // vocabulary here so consumes/produces stay typed (chaining + guards depend on it).
  const entities = await entityVocab();
  for (const port of [...(src.consumes ?? []), ...(src.produces ?? [])]) {
    if (port?.entity && !entities.has(port.entity)) {
      errors.push(
        `unknown entity "${port.entity}" — consumes/produces must use the closed entity vocab (spec/entity-vocab.json)`,
      );
    }
  }

  const ids = await existingIds();
  const isNew = !!id && !ids.has(id);
  if (isNew) {
    warnings.push(
      `"${id}" is a NEW capability (not in the existing taxonomy). Allowed, but prefer binding into an existing capability when one fits; flag new clusters in the PR for review.`,
    );
  }

  for (const link of src.links ?? []) {
    if (link?.to && !ids.has(link.to) && link.to !== id) {
      warnings.push(`link target "${link.to}" is not an existing capability id`);
    }
  }

  return { id, valid: errors.length === 0, isNew, errors, warnings };
}

export async function validateSourceFile(file: string): Promise<SourceValidation> {
  const src = parseYaml(await readFile(file, "utf8"));
  return validateSourceIntent(src);
}

/** Validate every ontology/intents/*.yaml — the CI gate over the whole taxonomy. */
export async function validateAllSources(dir = INTENTS): Promise<{ file: string; result: SourceValidation }[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  return Promise.all(
    files.map(async (f) => ({ file: f, result: await validateSourceFile(path.join(dir, f)) })),
  );
}
