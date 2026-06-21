import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { canonicalOrigin } from "./origin-aliases.js";
export async function loadOntology(intentsDir) {
    const files = (await readdir(intentsDir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    const intents = [];
    for (const file of files.sort()) {
        const raw = await readFile(path.join(intentsDir, file), "utf8");
        const parsed = parseYaml(raw);
        if (parsed?.id && parsed.label && parsed.satisfies?.length) {
            intents.push(parsed);
        }
    }
    return intents;
}
export function linkCapabilitiesToEndpoints(capabilities, endpointIndex) {
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
//# sourceMappingURL=ontology.js.map