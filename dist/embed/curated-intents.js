import path from "node:path";
import { fileURLToPath } from "node:url";
import { CURATED_INTENT_IDS } from "../intent-match.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..", "..");
export function defaultIntentsDir(packageRoot = PACKAGE_ROOT) {
    return path.join(packageRoot, "ontology", "intents");
}
export async function loadCuratedIntentIds(_intentsDir = defaultIntentsDir()) {
    return new Set(CURATED_INTENT_IDS);
}
//# sourceMappingURL=curated-intents.js.map