import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { CuratedIntentSource, IndexBundle, Port } from "./types.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as (
  ajv: InstanceType<typeof Ajv>,
) => InstanceType<typeof Ajv>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");

export async function loadSchemas(): Promise<{
  validateIndex: (data: unknown) => boolean;
  validateEndpoint: (data: unknown) => boolean;
  validateCapability: (data: unknown) => boolean;
  errors: () => string[];
}> {
  const specDir = path.join(__dirname, "..", "spec");
  const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
  addFormats(ajv);

  const [endpointSchema, capabilitySchema, providerSchema, indexSchema] =
    await Promise.all([
      readFile(path.join(specDir, "endpoint-record.schema.json"), "utf8"),
      readFile(path.join(specDir, "capability.schema.json"), "utf8"),
      readFile(path.join(specDir, "provider-record.schema.json"), "utf8"),
      readFile(path.join(specDir, "ontology.schema.json"), "utf8"),
    ]);

  const endpointParsed = JSON.parse(endpointSchema);
  const capabilityParsed = JSON.parse(capabilitySchema);
  const providerParsed = JSON.parse(providerSchema);
  const indexParsed = JSON.parse(indexSchema);

  ajv.addSchema(endpointParsed);
  ajv.addSchema(capabilityParsed);
  ajv.addSchema(providerParsed);
  const validateEndpoint = ajv.compile(endpointParsed);
  const validateCapability = ajv.compile(capabilityParsed);
  const validateIndex = ajv.compile(indexParsed);

  return {
    validateIndex: (data) => validateIndex(data) as boolean,
    validateEndpoint: (data) => validateEndpoint(data) as boolean,
    validateCapability: (data) => validateCapability(data) as boolean,
    errors: () => {
      const errs = [
        ...(validateIndex.errors ?? []),
        ...(validateEndpoint.errors ?? []),
        ...(validateCapability.errors ?? []),
      ];
      return errs.map((e) => `${e.instancePath} ${e.message}`);
    },
  };
}

export async function validateBundle(bundle: IndexBundle): Promise<string[]> {
  const { validateIndex, validateEndpoint, validateCapability } =
    await loadSchemas();
  const issues: string[] = [];

  if (!validateIndex(bundle)) {
    issues.push("index.json failed schema validation");
  }
  for (const ep of bundle.endpoints) {
    if (!validateEndpoint(ep)) {
      issues.push(`endpoint ${ep.id} failed schema validation`);
    }
  }
  for (const cap of bundle.capabilities) {
    if (!validateCapability(cap)) {
      issues.push(`capability ${cap.id} failed schema validation`);
    }
  }

  // Referential-integrity gate. WARN only this round: print the report to
  // stderr but do NOT add to `issues` (which would fail the build / set a
  // non-zero exit code). Flip to errors after the catalog is backfilled.
  try {
    const report = await runReferentialIntegrity();
    console.error(formatIntegrityReport(report));
  } catch (err) {
    console.error(
      `referential-integrity gate skipped: ${(err as Error).message}`,
    );
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Referential-integrity gate (design §9)
//
// AJV validates the *shape* of links/ports but not whether a `links[].to`,
// `related[]` entry, or `consumes/produces.entity` actually resolves. This gate
// resolves them against (a) the in-file intent `id:` set and (b) the closed
// entity vocabulary, enforces symmetry for the symmetric link types, and runs
// a pipes_to flow-consistency lint. All findings are emitted as WARNINGS this
// round (not hard errors) so the build still completes — flip to errors after
// the catalog is backfilled.
//
// ID-grammar note (§9): intent refs use dotted-snake ids (cloud.domains), which
// come from the in-file `id:` field — NOT the hyphenated filename
// (cloud.domain-manage.yaml). Entity refs use CamelCase vocab names.
// ---------------------------------------------------------------------------

const SYMMETRIC_LINK_TYPES = new Set(["alternative_of", "sibling_of"]);
const INVERSE_LINK_TYPES: Record<string, string> = {
  narrower_of: "broader_of",
  broader_of: "narrower_of",
};

export interface IntegrityIssue {
  level: "warning";
  kind:
    | "dangling_link"
    | "dangling_related"
    | "unknown_entity"
    | "asymmetric_link"
    | "self_link"
    | "pipes_to_flow";
  intent_id: string;
  detail: string;
}

export interface IntegrityReport {
  intents: number;
  links_checked: number;
  related_checked: number;
  ports_checked: number;
  issues: IntegrityIssue[];
  counts: Record<IntegrityIssue["kind"], number>;
}

async function loadEntityVocab(): Promise<Set<string>> {
  const raw = await readFile(
    path.join(PACKAGE_ROOT, "spec", "entity-vocab.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as { entities?: Record<string, unknown> };
  return new Set(Object.keys(parsed.entities ?? {}));
}

async function loadIntentSources(
  intentsDir: string,
): Promise<CuratedIntentSource[]> {
  const files = (await readdir(intentsDir)).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
  );
  const sources: CuratedIntentSource[] = [];
  for (const file of files.sort()) {
    const raw = await readFile(path.join(intentsDir, file), "utf8");
    const parsed = parseYaml(raw) as CuratedIntentSource;
    if (parsed?.id && parsed.label) sources.push(parsed);
  }
  return sources;
}

function checkPorts(
  intentId: string,
  ports: Port[] | undefined,
  side: "consumes" | "produces",
  vocab: Set<string>,
  issues: IntegrityIssue[],
): number {
  let checked = 0;
  for (const port of ports ?? []) {
    checked += 1;
    if (!vocab.has(port.entity)) {
      issues.push({
        level: "warning",
        kind: "unknown_entity",
        intent_id: intentId,
        detail: `${side}.entity "${port.entity}" is not in entity-vocab.json`,
      });
    }
  }
  return checked;
}

/**
 * Resolve every link/related/port reference against the in-file id set and the
 * entity vocabulary; enforce symmetry for symmetric link types; lint pipes_to
 * flow-consistency where producer/consumer ports exist. WARN only.
 */
export async function checkReferentialIntegrity(
  sources: CuratedIntentSource[],
  vocab: Set<string>,
): Promise<IntegrityReport> {
  const issues: IntegrityIssue[] = [];
  const idSet = new Set(sources.map((s) => s.id));
  const byId = new Map(sources.map((s) => [s.id, s]));

  let linksChecked = 0;
  let relatedChecked = 0;
  let portsChecked = 0;

  for (const intent of sources) {
    portsChecked += checkPorts(intent.id, intent.consumes, "consumes", vocab, issues);
    portsChecked += checkPorts(intent.id, intent.produces, "produces", vocab, issues);

    for (const link of intent.links ?? []) {
      linksChecked += 1;
      if (link.to === intent.id) {
        issues.push({
          level: "warning",
          kind: "self_link",
          intent_id: intent.id,
          detail: `links[].to "${link.to}" (${link.type}) points to itself`,
        });
        continue;
      }
      if (!idSet.has(link.to)) {
        issues.push({
          level: "warning",
          kind: "dangling_link",
          intent_id: intent.id,
          detail: `links[].to "${link.to}" (${link.type}) does not resolve to any intent id`,
        });
        continue;
      }

      // Symmetry: a symmetric edge must be authored or auto-inverted on the
      // target. We accept either the same symmetric type back, OR the target
      // authoring no edge (build auto-generates the inverse). Flag only the
      // case where the target authors a *different-typed* edge back, which the
      // build cannot reconcile.
      if (SYMMETRIC_LINK_TYPES.has(link.type)) {
        const target = byId.get(link.to);
        const back = (target?.links ?? []).find((l) => l.to === intent.id);
        if (back && back.type !== link.type) {
          issues.push({
            level: "warning",
            kind: "asymmetric_link",
            intent_id: intent.id,
            detail: `${link.type} -> "${link.to}" but "${link.to}" links back as ${back.type} (symmetric mismatch)`,
          });
        }
      }
    }

    for (const rel of intent.related ?? []) {
      relatedChecked += 1;
      if (rel === intent.id) {
        issues.push({
          level: "warning",
          kind: "self_link",
          intent_id: intent.id,
          detail: `related[] "${rel}" points to itself`,
        });
        continue;
      }
      if (!idSet.has(rel)) {
        issues.push({
          level: "warning",
          kind: "dangling_related",
          intent_id: intent.id,
          detail: `related[] "${rel}" does not resolve to any intent id`,
        });
      }
    }
  }

  // pipes_to flow-consistency: producer.produces[entity] must intersect
  // consumer.consumes[entity]. Only checkable where both ports exist.
  for (const intent of sources) {
    for (const link of intent.links ?? []) {
      if (link.type !== "pipes_to") continue;
      const consumer = byId.get(link.to);
      if (!consumer) continue; // already reported as dangling above
      const produced = new Set((intent.produces ?? []).map((p) => p.entity));
      const consumed = new Set((consumer.consumes ?? []).map((p) => p.entity));
      if (!produced.size || !consumed.size) continue; // not enough info to lint
      const shared = [...produced].some((e) => consumed.has(e));
      if (!shared) {
        issues.push({
          level: "warning",
          kind: "pipes_to_flow",
          intent_id: intent.id,
          detail: `pipes_to -> "${link.to}": produces {${[...produced].join(", ")}} does not unify consumes {${[...consumed].join(", ")}}`,
        });
      }
    }
  }

  const counts = {
    dangling_link: 0,
    dangling_related: 0,
    unknown_entity: 0,
    asymmetric_link: 0,
    self_link: 0,
    pipes_to_flow: 0,
  } as Record<IntegrityIssue["kind"], number>;
  for (const issue of issues) counts[issue.kind] += 1;

  return {
    intents: sources.length,
    links_checked: linksChecked,
    related_checked: relatedChecked,
    ports_checked: portsChecked,
    issues,
    counts,
  };
}

export async function runReferentialIntegrity(
  intentsDir = path.join(PACKAGE_ROOT, "ontology", "intents"),
): Promise<IntegrityReport> {
  const [sources, vocab] = await Promise.all([
    loadIntentSources(intentsDir),
    loadEntityVocab(),
  ]);
  return checkReferentialIntegrity(sources, vocab);
}

export function formatIntegrityReport(report: IntegrityReport): string {
  const lines: string[] = [
    "Referential integrity (intents links/related/ports) — WARN only",
    "",
    `intents: ${report.intents}  links: ${report.links_checked}  related: ${report.related_checked}  ports: ${report.ports_checked}`,
    `dangling_link: ${report.counts.dangling_link}  dangling_related: ${report.counts.dangling_related}  unknown_entity: ${report.counts.unknown_entity}  asymmetric_link: ${report.counts.asymmetric_link}  self_link: ${report.counts.self_link}  pipes_to_flow: ${report.counts.pipes_to_flow}`,
    "",
  ];

  if (!report.issues.length) {
    lines.push("no referential-integrity warnings");
    return lines.join("\n");
  }

  for (const issue of report.issues) {
    lines.push(`WARN [${issue.kind}] ${issue.intent_id}: ${issue.detail}`);
  }
  return lines.join("\n");
}
