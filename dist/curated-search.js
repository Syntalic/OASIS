import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { materializeCuratedIntents } from "./materialize-satisfies.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");

const curatedSearchCache = new WeakMap();

function loadOntologySourcesSync(intentsDir) {
    const files = readdirSync(intentsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    const intents = [];
    for (const file of files.sort()) {
        const raw = readFileSync(path.join(intentsDir, file), "utf8");
        const parsed = parseYaml(raw);
        if (parsed?.id && parsed.label) {
            intents.push(parsed);
        }
    }
    return intents;
}

/** Materialize curated task intents against the live endpoint index at search/eval time. */
export function curatedCapabilitiesForSearch(bundle, intentsDir = path.join(PACKAGE_ROOT, "ontology", "intents")) {
    const cached = curatedSearchCache.get(bundle);
    if (cached)
        return cached;
    const sources = loadOntologySourcesSync(intentsDir);
    const materialized = materializeCuratedIntents(sources, bundle.endpoints);
    curatedSearchCache.set(bundle, materialized);
    return materialized;
}