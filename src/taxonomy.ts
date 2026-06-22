import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { CuratedIntentSource } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEC = path.join(__dirname, "..", "spec");
const INTENTS = path.join(__dirname, "..", "ontology", "intents");

export interface Taxonomy {
  /** Existing task capabilities a contributor should bind INTO before proposing new ones. */
  capabilities: { id: string; label: string; aliases: string[]; domain?: string }[];
  /** Controlled facet enums (from ontology-source.schema.json). */
  facets: { domain: string[]; action: string[]; modality: string[]; freshness: string[] };
  /** Closed entity vocabulary for consumes/produces ports (name + the narrower nouns it absorbs). */
  entities: { name: string; role?: string; absorbs?: string[] }[];
  link_types: string[];
}

async function intentFiles(dir = INTENTS): Promise<string[]> {
  const files = await readdir(dir).catch(() => []);
  return files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
}

/** The controlled vocabulary a contributor (or the curator agent) binds into:
 *  existing capabilities + facet enums + the closed entity vocab. */
export async function getTaxonomy(): Promise<Taxonomy> {
  const capabilities: Taxonomy["capabilities"] = [];
  for (const f of await intentFiles()) {
    try {
      const src = parseYaml(await readFile(path.join(INTENTS, f), "utf8")) as CuratedIntentSource;
      if (src?.id) {
        capabilities.push({
          id: src.id,
          label: src.label,
          aliases: src.aliases ?? [],
          domain: src.facets?.domain,
        });
      }
    } catch {
      /* skip unparseable */
    }
  }
  capabilities.sort((a, b) => a.id.localeCompare(b.id));

  const schema = JSON.parse(await readFile(path.join(SPEC, "ontology-source.schema.json"), "utf8"));
  const F = schema.$defs.Facets.properties;
  const facets = {
    domain: F.domain.enum as string[],
    action: F.action.enum as string[],
    modality: F.modality.items.enum as string[],
    freshness: F.freshness.enum as string[],
  };
  const link_types = schema.$defs.CapabilityLink.properties.type.enum as string[];

  const vocab = JSON.parse(await readFile(path.join(SPEC, "entity-vocab.json"), "utf8"));
  const entities = Object.entries<{ role?: string; absorbs?: string[] }>(vocab.entities ?? {}).map(
    ([name, def]) => ({ name, role: def.role, absorbs: def.absorbs }),
  );

  return { capabilities, facets, entities, link_types };
}
