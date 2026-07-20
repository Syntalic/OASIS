import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { EndpointRecord } from "../core/types.js";
import {
  applyBindings,
  applyFieldMapToRequest,
  validateBinding,
  validateFieldMaps,
  type ServiceBinding,
} from "./binding.js";

const vocab = {
  Ticker: {
    kind: "identity" as const,
    properties: [{ name: "symbol", type: "string" as const, is_identifier: true, aliases: ["ticker"] }],
  },
  Company: {
    kind: "identity" as const,
    properties: [
      { name: "domain", type: "string" as const, is_identifier: true },
      { name: "lei", type: "string" as const },
    ],
  },
  Mystery: { kind: "identity" as const },
};

describe("field_maps validation", () => {
  it("accepts maps onto declared entity properties", () => {
    const r = validateFieldMaps(
      [{ entity: "Ticker", property: "symbol", in: "query", path: "symbol" }],
      vocab,
      "bindings[0]",
    );
    assert.equal(r.errors.length, 0, r.errors.join(";"));
  });

  it("ERRORs on unknown entity", () => {
    const r = validateFieldMaps(
      [{ entity: "NotAThing", property: "x", in: "body", path: "x" }],
      vocab,
      "bindings[0]",
    );
    assert.ok(r.errors.some((e) => e.includes("unknown entity")), r.errors.join(";"));
  });

  it("ERRORs on unknown property when entity declares properties[]", () => {
    const r = validateFieldMaps(
      [{ entity: "Ticker", property: "not_a_prop", in: "query", path: "s" }],
      vocab,
      "bindings[0]",
    );
    assert.ok(r.errors.some((e) => e.includes("not declared")), r.errors.join(";"));
  });

  it("WARNs when entity has no properties[] (untyped but allowed)", () => {
    const r = validateFieldMaps(
      [{ entity: "Mystery", property: "anything", in: "query", path: "q" }],
      vocab,
      "bindings[0]",
    );
    assert.equal(r.errors.length, 0);
    assert.ok(r.warnings.some((w) => w.includes("no properties")), r.warnings.join(";"));
  });
});

describe("applyFieldMapToRequest", () => {
  it("places values into the right HTTP locations", () => {
    const req = applyFieldMapToRequest(
      [
        { entity: "Ticker", property: "symbol", in: "query", path: "symbol" },
        { entity: "Company", property: "domain", in: "body", path: "$.domain" },
      ],
      {
        Ticker: { symbol: "AAPL" },
        Company: { domain: "apple.com" },
      },
    );
    assert.equal(req.query.symbol, "AAPL");
    assert.equal(req.body.domain, "apple.com");
  });
});

describe("applyBindings materializes field_maps", () => {
  it("copies field_maps onto the matched endpoint", () => {
    const endpoints: EndpointRecord[] = [
      {
        id: "b".repeat(64),
        origin: "https://2s.io",
        method: "GET",
        path: "/api/stocks/quote",
        summary: "quote",
        payment: { paid: true, rails: [{ protocol: "x402" }] },
        search_text: "quote",
        built_at: "2026-01-01T00:00:00Z",
      },
    ];
    const bindings: ServiceBinding[] = [
      {
        bindings: [
          {
            origin: "https://2s.io",
            method: "GET",
            path: "/api/stocks/quote",
            capabilities: ["finance.stock_quote"],
            field_maps: [{ entity: "Ticker", property: "symbol", in: "query", path: "symbol" }],
          },
        ],
      },
    ];
    const n = applyBindings(endpoints, bindings);
    assert.equal(n, 1);
    assert.equal(endpoints[0]!.capabilities?.[0], "finance.stock_quote");
    assert.deepEqual(endpoints[0]!.field_maps, [
      { entity: "Ticker", property: "symbol", in: "query", path: "symbol" },
    ]);
  });
});

describe("validateBinding + field_maps (integration)", () => {
  it("accepts a binding with valid Ticker.symbol field_map", async () => {
    const r = await validateBinding({
      provider: "test",
      bindings: [
        {
          origin: "https://example.com",
          method: "GET",
          path: "/quote",
          capabilities: ["finance.stock_quote"],
          field_maps: [{ entity: "Ticker", property: "symbol", in: "query", path: "symbol" }],
        },
      ],
    });
    assert.equal(r.valid, true, r.errors.join(";"));
  });

  it("rejects a binding with a bad field_map property", async () => {
    const r = await validateBinding({
      bindings: [
        {
          origin: "https://example.com",
          method: "GET",
          path: "/quote",
          capabilities: ["finance.stock_quote"],
          field_maps: [{ entity: "Ticker", property: "not_real", in: "query", path: "x" }],
        },
      ],
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("not declared")), r.errors.join(";"));
  });
});
