import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { endpointId } from "./id.js";
describe("endpointId", () => {
    it("is stable for origin/method/path", () => {
        const a = endpointId("https://api.example.com", "GET", "/v1/foo");
        const b = endpointId("https://api.example.com/", "get", "/v1/foo");
        assert.equal(a, b);
        assert.match(a, /^[a-f0-9]{64}$/);
    });
});
//# sourceMappingURL=id.test.js.map