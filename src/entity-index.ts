import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSubtypeClosure, V1_BRIDGE_IDENTITIES } from "./entity-match.js";
import type { CapabilityIntent } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");

export interface EntityVocabEntry {
  role?: string;
  kind?: "identity" | "observation" | "abstract";
  bridge_eligible?: boolean;
  deprecated?: boolean;
  absorbs?: string[];
}

export interface EntityIndex {
  spec_version: string;
  entities: string[];
  subtype_closure: Record<string, string[]>;
  parent_of: Record<string, string>;
  bridge_eligible: string[];
  observation_entities: string[];
  produces_index: Record<string, string[]>;
  consumes_index: Record<string, string[]>;
}

export async function loadEntityVocabAndSubtypes(): Promise<{
  vocab: { spec_version: string; entities: Record<string, EntityVocabEntry> };
  subtypes: Record<string, { parent: string }>;
}> {
  const spec = path.join(PACKAGE_ROOT, "spec");
  const vocab = JSON.parse(
    await readFile(path.join(spec, "entity-vocab.json"), "utf8"),
  ) as { spec_version: string; entities: Record<string, EntityVocabEntry> };
  const subtypesFile = JSON.parse(
    await readFile(path.join(spec, "entity-subtypes.json"), "utf8"),
  ) as { subtypes: Record<string, { parent: string }> };
  return { vocab, subtypes: subtypesFile.subtypes };
}

export function buildEntityIndex(capabilities: CapabilityIntent[]): EntityIndex {
  // sync build from already-loaded vocab would need async — use buildEntityIndexFromVocab
  throw new Error("use buildEntityIndexFromVocab");
}

export function buildEntityIndexFromVocab(
  vocab: { spec_version: string; entities: Record<string, EntityVocabEntry> },
  subtypes: Record<string, { parent: string }>,
  capabilities: CapabilityIntent[],
): EntityIndex {
  const closure = buildSubtypeClosure(subtypes);
  const parentOf = closure.parentOf;

  const observation_entities: string[] = [];
  const allBridgeFromVocab: string[] = [];
  for (const [name, def] of Object.entries(vocab.entities)) {
    if (def.kind === "observation") observation_entities.push(name);
    if (def.bridge_eligible) allBridgeFromVocab.push(name);
  }

  // v1 runtime filter: exactly five identities
  const bridge_eligible = V1_BRIDGE_IDENTITIES.filter((e) =>
    allBridgeFromVocab.includes(e) || vocab.entities[e]?.bridge_eligible !== false,
  );

  const produces_index: Record<string, string[]> = {};
  const consumes_index: Record<string, string[]> = {};
  for (const cap of capabilities) {
    produces_index[cap.id] = [...new Set((cap.produces ?? []).map((p) => p.entity))];
    consumes_index[cap.id] = [...new Set((cap.consumes ?? []).map((p) => p.entity))];
  }

  const subtype_closure: Record<string, string[]> = {};
  for (const canonical of new Set([
    ...Object.keys(parentOf).map((c) => parentOf[c]),
    ...Object.keys(parentOf),
    ...Object.keys(vocab.entities),
  ])) {
    const members = [canonical];
    for (const [child, parent] of Object.entries(parentOf)) {
      if (parent === canonical) members.push(child);
    }
    subtype_closure[canonical] = [...new Set(members)];
  }

  return {
    spec_version: vocab.spec_version,
    entities: Object.keys(vocab.entities),
    subtype_closure,
    parent_of: parentOf,
    bridge_eligible: [...bridge_eligible],
    observation_entities,
    produces_index,
    consumes_index,
  };
}

export async function loadEntityIndex(distDir: string): Promise<EntityIndex> {
  const raw = await readFile(path.join(distDir, "entity-index.json"), "utf8");
  return JSON.parse(raw) as EntityIndex;
}