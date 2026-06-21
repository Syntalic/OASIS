import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOntology } from "../ontology.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..", "..");

export function defaultIntentsDir(packageRoot = PACKAGE_ROOT): string {
  return path.join(packageRoot, "ontology", "intents");
}

export async function loadCuratedIntentIds(
  intentsDir = defaultIntentsDir(),
): Promise<Set<string>> {
  const intents = await loadOntology(intentsDir);
  return new Set(intents.map((i) => i.id));
}