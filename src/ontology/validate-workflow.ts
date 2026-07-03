import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { ValidateFunction } from "ajv";

const require = createRequire(import.meta.url);
const Ajv = require("ajv") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as (ajv: InstanceType<typeof Ajv>) => unknown;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEC = path.join(__dirname, "..", "..", "spec");
const INTENTS = path.join(__dirname, "..", "..", "ontology", "intents");
const WORKFLOWS = path.join(__dirname, "..", "..", "ontology", "workflows");

export interface WorkflowValidation {
  id: string | null;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface WorkflowStep { intent?: string; do?: string; optional?: boolean; gate?: string }
interface WorkflowSource { id?: string; goal?: string; shape?: string; aliases?: string[]; steps?: WorkflowStep[]; produces?: string }

let _validate: ValidateFunction | null = null;
async function schemaValidator(): Promise<void> {
  if (_validate) return;
  const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
  addFormats(ajv);
  const schema = JSON.parse(await readFile(path.join(SPEC, "workflow.schema.json"), "utf8"));
  _validate = ajv.compile(schema);
}

interface IntentPorts { consumes: Set<string>; produces: Set<string> }
const _portsCache = new Map<string, Map<string, IntentPorts>>();

/** Map every curated intent id → its consumes/produces entities, from the intent YAMLs (the source
 *  of truth for the entity graph a workflow's steps flow through). Cached per directory. */
async function intentPorts(dir = INTENTS): Promise<Map<string, IntentPorts>> {
  const cached = _portsCache.get(dir);
  if (cached) return cached;
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const map = new Map<string, IntentPorts>();
  for (const f of files) {
    try {
      const src = parseYaml(await readFile(path.join(dir, f), "utf8")) as {
        id?: string; consumes?: { entity?: string }[]; produces?: { entity?: string }[];
      };
      if (!src?.id) continue;
      map.set(src.id, {
        consumes: new Set((src.consumes ?? []).map((p) => p.entity).filter((e): e is string => !!e)),
        produces: new Set((src.produces ?? []).map((p) => p.entity).filter((e): e is string => !!e)),
      });
    } catch { /* skip unparseable */ }
  }
  _portsCache.set(dir, map);
  return map;
}

const intersects = (a: Set<string>, b: Set<string>): boolean => [...a].some((x) => b.has(x));

/**
 * Validate a contributed workflow recipe. Shared by the CLI and the CI gate — ONE implementation.
 * Checks: the workflow schema; every step's `intent` is an EXISTING curated intent id (ERROR — a
 * workflow composes the stable vocabulary, it never invents); and entity-flow coherence against the
 * intents' ports (WARN, not error — the ports are incomplete and a planner bridges real seams, per
 * docs/proposals/workflows.md). OASIS suggests the route; the agent executes it.
 */
export async function validateWorkflow(
  source: unknown,
  opts: { intentsDir?: string } = {},
): Promise<WorkflowValidation> {
  await schemaValidator();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!_validate!(source)) {
    for (const e of _validate!.errors ?? []) errors.push(`schema: ${e.instancePath || "/"} ${e.message}`);
  }

  const wf = (source ?? {}) as WorkflowSource;
  const id = typeof wf.id === "string" ? wf.id : null;
  const ports = await intentPorts(opts.intentsDir ?? INTENTS);
  const steps = Array.isArray(wf.steps) ? wf.steps : [];

  // Every referenced intent must exist.
  for (const s of steps) {
    if (s?.intent && !ports.has(s.intent)) {
      errors.push(`step intent "${s.intent}" is not an existing curated intent id`);
    }
  }

  // Entity-flow coherence (WARN). A gap = the graph doesn't encode the hop; a planner bridges it.
  if (wf.shape === "chain") {
    for (let i = 0; i < steps.length - 1; i++) {
      const a = steps[i]?.intent, b = steps[i + 1]?.intent;
      if (!a || !b || !ports.has(a) || !ports.has(b)) continue;
      if (!intersects(ports.get(a)!.produces, ports.get(b)!.consumes)) {
        warnings.push(
          `chain seam ${a} → ${b}: produces {${[...ports.get(a)!.produces].join(",") || "-"}} does not feed ` +
            `consumes {${[...ports.get(b)!.consumes].join(",") || "-"}} — a planner bridges this hop`,
        );
      }
    }
  } else if (wf.shape === "fanout") {
    const req = steps.filter((s) => s?.intent && !s.optional && ports.has(s.intent));
    if (req.length >= 2) {
      const common = req
        .map((s) => ports.get(s.intent!)!.consumes)
        .reduce((acc, set) => new Set([...acc].filter((x) => set.has(x))));
      if (common.size === 0) {
        warnings.push(
          `fanout steps share no common consumed entity — a fanout usually enriches one held entity; confirm they operate on the same subject`,
        );
      }
    }
  }

  return { id, valid: errors.length === 0, errors, warnings };
}

export async function validateWorkflowFile(
  file: string,
  opts: { intentsDir?: string } = {},
): Promise<WorkflowValidation> {
  const src = parseYaml(await readFile(file, "utf8"));
  return validateWorkflow(src, opts);
}

/** Validate every ontology/workflows/*.yaml — the CI gate over the workflow library. */
export async function validateAllWorkflows(dir = WORKFLOWS): Promise<{ file: string; result: WorkflowValidation }[]> {
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  return Promise.all(files.map(async (f) => ({ file: f, result: await validateWorkflowFile(path.join(dir, f)) })));
}
