import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IndexBundle } from "./types.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as (
  ajv: InstanceType<typeof Ajv>,
) => InstanceType<typeof Ajv>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  return issues;
}