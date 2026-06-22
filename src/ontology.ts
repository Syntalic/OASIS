import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { canonicalOrigin } from "./origin-aliases.js";
import type { CapabilityIntent, CuratedIntentSource } from "./types.js";

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