import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { searchIndex } from "./search.js";
import type { CapabilityIntent, EndpointRecord } from "./types.js";

const capabilities: CapabilityIntent[] = [
  {
    id: "shop.compare_price",
    label: "Compare retail price across stores",
    aliases: ["cheapest price"],
    satisfies: [
      {
        origin: "https://api.example.com",
        method: "GET",
        path: "/v1/shopper/best-price",
      },
    ],
  },
];

const endpoints: EndpointRecord[] = [
  {
    id: "a".repeat(64),
    origin: "https://api.example.com",
    method: "GET",
    path: "/v1/shopper/best-price",
    summary: "Find the best price for a product",
    payment: { paid: true, price_usd: 0.01, rails: [{ protocol: "x402" }] },
    search_text: "find best price product retailers shopping",
    built_at: new Date().toISOString(),
  },
];

describe("searchIndex", () => {
  it("ranks capability matches for shopping queries", () => {
    const hits = searchIndex("cheapest airpods", endpoints, capabilities, 5);
    assert.ok(hits.length > 0);
    assert.equal(hits[0].kind, "capability");
    assert.equal(hits[0].capability_id, "shop.compare_price");
  });
});