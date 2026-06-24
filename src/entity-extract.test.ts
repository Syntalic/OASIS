import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  extractEntities,
  extractEntitiesFromFinding,
} from "./entity-extract.js";
import type { CapabilityIntent, IndexBundle } from "./types.js";
import { oasisDistIndex, SKIP_NO_INDEX } from "./test-helpers.js";

const distIndex = oasisDistIndex();

async function loadBundle(): Promise<IndexBundle> {
  const raw = await readFile(distIndex, "utf8");
  return JSON.parse(raw) as IndexBundle;
}

describe("extractEntitiesFromFinding", () => {
  it("extracts Place from city, state pattern", () => {
    const out = extractEntitiesFromFinding(
      "LA consumer electronics sales down 12% YoY in Los Angeles, CA",
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].entity, "Place");
    assert.equal(out[0].value, "Los Angeles, CA");
    assert.equal(out[0].kind, "identity");
  });

  it("extracts Domain from finding text", () => {
    const out = extractEntitiesFromFinding("acme.com registered 2010, WHOIS clean");
    assert.ok(out.some((e) => e.entity === "Domain" && e.value === "acme.com"));
  });

  it("returns empty when no bridge patterns match", () => {
    assert.deepEqual(extractEntitiesFromFinding("sales down 12% YoY"), []);
  });
});

describe("extractEntities", () => {
  it("prefers explicit entities over finding heuristics", async (t) => {
    if (!existsSync(distIndex)) return t.skip(SKIP_NO_INDEX);
    const bundle = await loadBundle();
    const caps = new Map(bundle.capabilities.map((c) => [c.id, c]));
    const result = extractEntities({
      finding: "competitor in Los Angeles, CA",
      explicitEntities: [{ entity: "Company", value: "Acme Corp" }],
      bundle,
      capabilitiesById: caps,
    });
    assert.equal(result.method, "explicit");
    assert.equal(result.confidence, "high");
    assert.equal(result.entities[0].entity, "Company");
    assert.equal(result.entities[0].value, "Acme Corp");
  });

  it("uses heuristic path when only finding is provided", async (t) => {
    if (!existsSync(distIndex)) return t.skip(SKIP_NO_INDEX);
    const bundle = await loadBundle();
    const caps = new Map(bundle.capabilities.map((c) => [c.id, c]));
    const result = extractEntities({
      finding: "Investigate acme.com domain footprint in Austin, TX",
      bundle,
      capabilitiesById: caps,
    });
    assert.equal(result.method, "heuristic");
    assert.equal(result.confidence, "medium");
    assert.ok(result.entities.some((e) => e.entity === "Domain"));
    assert.ok(result.entities.some((e) => e.entity === "Place"));
  });

  it("rejects forbidden entity types from explicit input", async (t) => {
    if (!existsSync(distIndex)) return t.skip(SKIP_NO_INDEX);
    const bundle = await loadBundle();
    const caps = new Map(bundle.capabilities.map((c) => [c.id, c]));
    const result = extractEntities({
      explicitEntities: [
        { entity: "Query", value: "weather" },
        { entity: "Place", value: "Austin, TX" },
      ],
      bundle,
      capabilitiesById: caps,
    });
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].entity, "Place");
  });

  it("falls back to intent identity produces", async (t) => {
    if (!existsSync(distIndex)) return t.skip(SKIP_NO_INDEX);
    const bundle = await loadBundle();
    const geocode = bundle.capabilities.find((c) => c.id === "maps.geocode");
    assert.ok(geocode);
    const caps = new Map<string, CapabilityIntent>([["maps.geocode", geocode]]);
    const result = extractEntities({
      source_intent_id: "maps.geocode",
      bundle,
      capabilitiesById: caps,
    });
    assert.equal(result.method, "intent_produces");
    assert.ok(result.entities.some((e) => e.entity === "Place"));
  });
});