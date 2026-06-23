import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { materializeCuratedIntents } from "./materialize-satisfies.js";
import type { CapabilityIntent, CapabilityLink, CuratedIntentSource, IndexBundle } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");

const curatedSearchCache = new WeakMap<IndexBundle, CapabilityIntent[]>();

/** Sync mirror of loadInferredLinks (ontology.ts) for the runtime search path. */
function loadInferredLinksSync(intentsDir: string): Map<string, CapabilityLink[]> {
  const byFrom = new Map<string, CapabilityLink[]>();
  try {
    const file = path.join(path.dirname(intentsDir), "inferred-links.json");
    const data = JSON.parse(readFileSync(file, "utf8")) as {
      edges?: Array<{ from: string; type: CapabilityLink["type"]; to: string; why?: string }>;
    };
    for (const e of data.edges ?? []) {
      const list = byFrom.get(e.from) ?? [];
      list.push({ type: e.type, to: e.to, note: e.why });
      byFrom.set(e.from, list);
    }
  } catch {
    /* no inferred-links file — links come from YAML only */
  }
  return byFrom;
}

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

  // Merge inferred inter-intent links (authored win, dedupe by target) — same as the
  // async loader, so the runtime search path and the built index agree.
  const inferred = loadInferredLinksSync(intentsDir);
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