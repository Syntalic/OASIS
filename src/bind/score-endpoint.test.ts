import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { EndpointRecord, Port } from "../core/types.js";
import {
  fieldMapRelevanceBonus,
  hydrateEntityInputTokens,
  intentRelevanceBonus,
  rankEndpointsNeutral,
  resetEntityInputTokens,
  scoreEndpointNeutral,
  type IntentPorts,
} from "./score-endpoint.js";

function ep(partial: Partial<EndpointRecord> & Pick<EndpointRecord, "summary" | "path">): EndpointRecord {
  return {
    id: "a".repeat(64),
    origin: "https://example.com",
    method: "GET",
    payment: { paid: true, rails: [{ protocol: "x402" }], price_usd: 0.01 },
    search_text: partial.summary,
    built_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("intentRelevanceBonus + entity properties", () => {
  beforeEach(() => resetEntityInputTokens());
  afterEach(() => resetEntityInputTokens());

  it("base tokens still score Company domain inputs (no regression)", () => {
    const endpoint = ep({
      summary: "Enrich a company by domain",
      path: "/v1/company",
      inputs: ["domain"],
    });
    const bonus = intentRelevanceBonus(endpoint, { consumes: [{ entity: "Company", role: "identifier" }] });
    assert.ok(bonus >= 4, `expected ≥4 from domain token, got ${bonus}`);
  });

  it("hydrated property aliases improve ranking for lei-only endpoints", () => {
    const leiEp = ep({
      summary: "Lookup org by LEI",
      path: "/v1/lei",
      inputs: ["lei"],
      description: "Resolve a legal entity identifier to company profile data",
    });
    const intent: IntentPorts = {
      consumes: [{ entity: "Company", role: "identifier" }],
      produces: [{ entity: "Company", role: "payload" }],
    };
    // Force base-only tokens (reset clears hydrate flag; call entity path via explicit map).
    resetEntityInputTokens();
    hydrateEntityInputTokens({ Company: {} }); // empty props = base Company tokens only
    const before = intentRelevanceBonus(leiEp, intent);

    hydrateEntityInputTokens({
      Company: {
        properties: [
          { name: "domain", is_identifier: true, aliases: ["hostname"] },
          { name: "lei", type: "string" },
          { name: "name", aliases: ["company", "organization"] },
        ],
      },
    });
    const after = intentRelevanceBonus(leiEp, intent);
    assert.ok(after > before, `lei property should improve bonus: before=${before} after=${after}`);
    assert.ok(after >= 4, `hydrated lei should get strong input match, got ${after}`);
  });

  it("field_maps boost the correctly-mapped endpoint over a token-only peer", () => {
    const intent: IntentPorts = { consumes: [{ entity: "Ticker", role: "identifier" }] };
    const withMap = ep({
      summary: "Stock quote by symbol",
      path: "/quote",
      inputs: ["symbol"],
      field_maps: [{ entity: "Ticker", property: "symbol", in: "query", path: "symbol" }],
    });
    const withoutMap = ep({
      summary: "Stock quote by symbol",
      path: "/quote2",
      inputs: ["symbol"],
    });
    const ranked = rankEndpointsNeutral([withoutMap, withMap], 2, intent);
    assert.equal(ranked[0]!.path, "/quote", "field_map endpoint should rank first");
    assert.ok(
      scoreEndpointNeutral(withMap, intent) > scoreEndpointNeutral(withoutMap, intent),
    );
  });

  it("fieldMapRelevanceBonus is zero without matching consumes", () => {
    assert.equal(
      fieldMapRelevanceBonus(
        [{ entity: "Ticker", property: "symbol", in: "query", path: "symbol" }],
        [{ entity: "Company" }],
        ["symbol"],
      ),
      0,
    );
  });

  it("neutral score without intent is unchanged by field_maps (byte-identical path)", () => {
    const a = ep({ summary: "A detailed stock quote endpoint", path: "/a", inputs: ["symbol"] });
    const b = ep({
      summary: "A detailed stock quote endpoint",
      path: "/b",
      inputs: ["symbol"],
      field_maps: [{ entity: "Ticker", property: "symbol", in: "query", path: "symbol" }],
    });
    assert.equal(scoreEndpointNeutral(a), scoreEndpointNeutral(b));
  });
});
