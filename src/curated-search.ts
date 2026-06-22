import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { materializeCuratedIntents } from "./materialize-satisfies.js";
import type { CapabilityIntent, CuratedIntentSource, IndexBundle } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");

const curatedSearchCache = new WeakMap<IndexBundle, CapabilityIntent[]>();

function loadOntologySourcesSync(
  intentsDir: string,
): CuratedIntentSource[] {
  const files = readdirSync(intentsDir).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
  );
  const intents: CuratedIntentSource[] = [];

  for (const file of files.sort()) {
    const raw = readFileSync(path.join(intentsDir, file), "utf8");
    const parsed = parseYaml(raw) as CuratedIntentSource;
    if (parsed?.id && parsed.label) {
      intents.push(parsed);
    }
  }

  return intents;
}

/**
 * Materialize the 47 curated task intents against the live endpoint index.
 * Used at search/eval time so discovery works even when dist/index.json was
 * built before intent-match materialization covered every curated intent.
 */
export function curatedCapabilitiesForSearch(
  bundle: IndexBundle,
  intentsDir = path.join(PACKAGE_ROOT, "ontology", "intents"),
): CapabilityIntent[] {
  const cached = curatedSearchCache.get(bundle);
  if (cached) return cached;

  const sources = loadOntologySourcesSync(intentsDir);
  const materialized = materializeCuratedIntents(sources, bundle.endpoints);
  curatedSearchCache.set(bundle, materialized);
  return materialized;
}