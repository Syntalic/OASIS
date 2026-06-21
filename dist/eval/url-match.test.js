import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchesExpectedEndpoint, parseResourceUrl, rankExternalHits, } from "./url-match.js";
describe("url-match", () => {
    it("parses full resource URLs", () => {
        const parsed = parseResourceUrl("https://screenshotone.x402.paysponge.com/take", "GET");
        assert.deepEqual(parsed, {
            origin: "https://screenshotone.x402.paysponge.com",
            method: "GET",
            path: "/take",
        });
    });
    it("matches expected endpoint refs", () => {
        const hit = parseResourceUrl("https://stablecrypto.dev/api/coingecko/price", "POST");
        const expected = {
            origin: "https://stablecrypto.dev",
            method: "POST",
            path: "/api/coingecko/price",
        };
        assert.ok(matchesExpectedEndpoint(hit, expected));
    });
    it("ranks external hits by position", () => {
        const hits = [
            parseResourceUrl("https://example.com/wrong", "GET"),
            parseResourceUrl("https://stablecrypto.dev/api/coingecko/price", "POST"),
        ];
        const rank = rankExternalHits(hits, {
            origin: "https://stablecrypto.dev",
            method: "POST",
            path: "/api/coingecko/price",
        });
        assert.equal(rank, 2);
    });
});
//# sourceMappingURL=url-match.test.js.map