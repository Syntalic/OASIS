import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { canonicalOrigin } from "./origin-aliases.js";
import type { CapabilityIntent, CapabilityLink, CuratedIntentSource } from "./types.js";

/**
 * Centrally-inferred inter-intent typed links (`ontology/inferred-links.json`),
 * grouped by source intent. These power oasis_next; authored YAML links always win.
 */
async function loadInferredLinks(intentsDir: string): Promise<Map<string, CapabilityLink[]>> {
  const byFrom = new Map<string, CapabilityLink[]>();
  try {
    const file = path.join(path.dirname(intentsDir), "inferred-links.json");
    const data = JSON.parse(await readFile(file, "utf8")) as {
      edges?: Array<{ from: string; type: CapabilityLink["type"]; to: string; why?: string }>;
    };
    for (const e of data.edges ?? []) {
      const list = byFrom.get(e.from) ?? [];
      list.push({ type: e.type, to: e.to, note: e.why });
      byFrom.set(e.from, list);
    }
  } catch {
    /* no inferred-links file — fine, links come from YAML only */
  }
  return byFrom;
}

export async function loadOntologySources(
  intentsDir: string,
): Promise<CuratedIntentSource[]> {
  const files = (await readdir(intentsDir)).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
  );
  const intents: CuratedIntentSource[] = [];

  for (const file of files.sort()) {
    const raw = await readFile(path.join(intentsDir, file), "utf8");
    const parsed = parseYaml(raw) as CuratedIntentSource;
    if (parsed?.id && parsed.label) {
      intents.push(parsed);
    }
  }

  // Merge the inferred inter-intent links into each source — authored links win,
  // inferred ones dedupe by target. Inverses (fed_by/broader_of) are generated later
  // at materialize (addInverseLinks).
  const inferred = await loadInferredLinks(intentsDir);
  for (const intent of intents) {
    const add = inferred.get(intent.id);
    if (!add) continue;
    const authored = intent.links ?? [];
    const seenTargets = new Set(authored.map((l) => l.to));
    intent.links = [...authored];
    for (const l of add) {
      if (seenTargets.has(l.to)) continue;
      seenTargets.add(l.to);
      intent.links.push(l);
    }
  }

  return intents;
}

/** @deprecated Use loadOntologySources — bundle capabilities come from materialize step. */
export async function loadOntology(intentsDir: string): Promise<CapabilityIntent[]> {
  const sources = await loadOntologySources(intentsDir);
  return sources.map((s) => ({ ...s, satisfies: [] }));
}

export function linkCapabilitiesToEndpoints(
  capabilities: CapabilityIntent[],
  endpointIndex: Map<string, { capabilities?: string[] }>,
): void {
  for (const cap of capabilities) {
    for (const ref of cap.satisfies) {
      const origin = canonicalOrigin(ref.origin.replace(/\/$/, ""));
      const method = ref.method.toUpperCase();
      const p = ref.path.startsWith("/") ? ref.path : `/${ref.path}`;
      const key = `${origin}|${method}|${p}`;
      const ep = endpointIndex.get(key);
      if (ep) {
        ep.capabilities = [...new Set([...(ep.capabilities ?? []), cap.id])];
      }
    }
  }
}