import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_ENTITY_INPUT_TOKENS,
  buildEntityInputTokens,
  tokensFromProperties,
  type EntityVocabDef,
} from "./entity-tokens.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOCAB_PATH = path.join(__dirname, "..", "..", "spec", "entity-vocab.json");

describe("entity properties (vocab)", () => {
  it("shipped entity-vocab declares properties on high-traffic identities", async () => {
    const raw = JSON.parse(await readFile(VOCAB_PATH, "utf8")) as {
      spec_version: string;
      entities: Record<string, EntityVocabDef>;
    };
    assert.equal(raw.spec_version, "0.4.0");
    const required = ["Company", "Person", "Place", "Ticker", "Webpage", "CryptoAsset", "Domain", "Query"];
    for (const name of required) {
      assert.ok(raw.entities[name]?.properties?.length, `${name} should have properties[]`);
      assert.ok(
        raw.entities[name]!.properties!.some((p) => p.is_identifier) || name === "Place" || name === "Contact",
        `${name} should mark an identifier property (or is multi-key)`,
      );
    }
  });

  it("tokensFromProperties flattens name + aliases", () => {
    const tokens = tokensFromProperties([
      { name: "domain", is_identifier: true, aliases: ["hostname", "website"] },
      { name: "lei", type: "string" },
    ]);
    assert.deepEqual(tokens.sort(), ["domain", "hostname", "lei", "website"].sort());
  });

  it("buildEntityInputTokens never drops base coverage (no regression)", () => {
    const vocab: Record<string, EntityVocabDef> = {
      Company: {
        properties: [{ name: "lei", type: "string" }, { name: "domain", aliases: ["hostname"] }],
      },
    };
    const merged = buildEntityInputTokens(vocab);
    for (const t of BASE_ENTITY_INPUT_TOKENS.Company!) {
      assert.ok(merged.Company!.includes(t), `base token "${t}" must remain for Company`);
    }
    assert.ok(merged.Company!.includes("lei"));
    assert.ok(merged.Company!.includes("hostname"));
  });

  it("shipped vocab properties only *extend* base tokens", async () => {
    const raw = JSON.parse(await readFile(VOCAB_PATH, "utf8")) as {
      entities: Record<string, EntityVocabDef>;
    };
    const merged = buildEntityInputTokens(raw.entities);
    for (const [entity, base] of Object.entries(BASE_ENTITY_INPUT_TOKENS)) {
      for (const t of base) {
        assert.ok(
          (merged[entity] ?? []).includes(t),
          `${entity}: base token "${t}" missing after vocab merge`,
        );
      }
    }
  });
});
