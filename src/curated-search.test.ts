import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { CURATED_INTENT_IDS } from "./intent-match.js";
import { curatedCapabilitiesForSearch } from "./curated-search.js";
import type { IndexBundle } from "./types.js";
import { oasisDistIndex, SKIP_NO_INDEX, skipIfPinned } from "./test-helpers.js";

const distIndex = oasisDistIndex();

async function loadBundle(): Promise<IndexBundle> {
  const raw = await readFile(distIndex, "utf8");
  return JSON.parse(raw) as IndexBundle;
}

// dist/index.json is a build artifact (gitignored). Skip when absent (e.g. CI
// that only compiles); runs after `pnpm run build` locally.
describe("curated-search", () => {
  it("materializes all curated intents with endpoint candidates", async (t) => {
    if (skipIfPinned(t)) return;
    if (!existsSync(distIndex)) return t.skip(SKIP_NO_INDEX);
    const bundle = await loadBundle();
    const curated = curatedCapabilitiesForSearch(bundle);

    assert.equal(curated.length, CURATED_INTENT_IDS.length);
    const missing = curated.filter((c) => c.satisfies.length === 0);
    assert.equal(
      missing.length,
      0,
      `intents without candidates: ${missing.map((c) => c.id).join(", ")}`,
    );
  });
});
