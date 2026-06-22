import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CURATED_INTENT_IDS,
  INTENT_MATCHERS,
  matchEndpointsForIntent,
} from "./intent-match.js";
import type { EndpointRecord } from "./types.js";

function ep(
  partial: Partial<EndpointRecord> & Pick<EndpointRecord, "path" | "summary">,
): EndpointRecord {
  return {
    id: "x".repeat(64),
    origin: "https://example.com",
    method: "GET",
    payment: { paid: true, rails: [{ protocol: "x402" }] },
    search_text: partial.summary,
    built_at: new Date().toISOString(),
    ...partial,
  };
}

describe("intent-match", () => {
  it("defines matchers for all curated intent ids", () => {
    assert.equal(CURATED_INTENT_IDS.length, 47);
    for (const id of CURATED_INTENT_IDS) {
      assert.ok(INTENT_MATCHERS[id], `${id} matcher exists`);
    }
  });

  it("matches shop.compare_price by path pattern", () => {
    const hits = matchEndpointsForIntent("shop.compare_price", [
      ep({
        path: "/v1/shopper/best-price",
        summary: "Cross retailer price comparison",
        origin: "https://api.syntalic.com",
      }),
      ep({ path: "/health", summary: "health check" }),
    ]);
    assert.equal(hits.length, 1);
  });

  it("matches web.screenshot without vendor origin", () => {
    const hits = matchEndpointsForIntent("web.screenshot", [
      ep({
        path: "/take",
        summary: "Capture website screenshot PNG",
        origin: "https://screenshot.example.com",
      }),
    ]);
    assert.equal(hits.length, 1);
  });
});