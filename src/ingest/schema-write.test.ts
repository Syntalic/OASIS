import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SchemaCollector } from "./schema-store.js";
import { writeSchemas } from "./discover.js";

describe("writeSchemas", () => {
  it("writes the ref→schema map to schemas.json", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "oasis-"));
    const c = new SchemaCollector();
    const ref = c.add({ type: "string" });
    await writeSchemas(c.toObject(), dir);
    const out = JSON.parse(await readFile(path.join(dir, "schemas.json"), "utf8"));
    assert.deepEqual(out[ref], { type: "string" });
  });
});
