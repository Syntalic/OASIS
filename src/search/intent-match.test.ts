import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { CURATED_INTENT_IDS } from "./intent-match.js";

const INTENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "ontology", "intents");

function intentIdsFromYaml(): string[] {
  return readdirSync(INTENTS_DIR)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => (parseYaml(readFileSync(path.join(INTENTS_DIR, f), "utf8")) as { id?: string }).id)
    .filter((id): id is string => Boolean(id));
}

describe("intent-match", () => {
  it("defines a unique set of curated intent ids", () => {
    assert.equal(new Set(CURATED_INTENT_IDS).size, CURATED_INTENT_IDS.length);
  });

  // Drift guard: CURATED_INTENT_IDS is a hand-maintained allowlist that the semantic binder,
  // search, and vector index all scope to. An intent YAML that isn't registered here loads into
  // the index but binds ZERO endpoints (a silent no-op); an id here with no YAML resolves to
  // nothing. Keep the two in lockstep so adding ontology/intents/<x>.yaml can't silently do nothing.
  it("CURATED_INTENT_IDS exactly matches ontology/intents/*.yaml", () => {
    const yamlIds = new Set(intentIdsFromYaml());
    const curated = new Set<string>(CURATED_INTENT_IDS);
    const unregistered = [...yamlIds].filter((id) => !curated.has(id)).sort();
    const orphaned = [...curated].filter((id) => !yamlIds.has(id)).sort();
    assert.deepEqual(unregistered, [], `intent YAML(s) not registered in CURATED_INTENT_IDS: ${unregistered.join(", ")}`);
    assert.deepEqual(orphaned, [], `CURATED_INTENT_IDS entr(ies) with no ontology/intents YAML: ${orphaned.join(", ")}`);
  });
});
