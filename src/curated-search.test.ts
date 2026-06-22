import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CURATED_INTENT_IDS } from "./intent-match.js";
import { curatedCapabilitiesForSearch } from "./curated-search.js";
import type { IndexBundle } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(__dirname, "..", "dist", "index.json");

async function loadBundle(): Promise<IndexBundle> {
  const raw = await readFile(distIndex, "utf8");
  return JSON.parse(raw) as IndexBundle;
}

// dist/index.json is a build artifact (gitignored). Skip when absent (e.g. CI
// that only compiles); runs after `pnpm run build` locally.
const SKIP_MSG = "dist/index.json missing — run pnpm run build first";

describe("curated-search", () => {
  it("materializes all curated intents with endpoint candidates", async (t) => {
    if (!existsSync(distIndex)) return t.skip(SKIP_MSG);
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
