import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateMode } from "./discovery-benchmark.js";
import { runCompareBenchmark } from "./compare-benchmark.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(__dirname, "..", "..", "dist", "index.json");

async function loadBundle() {
    const raw = await readFile(distIndex, "utf8");
    return JSON.parse(raw);
}

describe("compare benchmark", () => {
    it("x402scan-only slice is smaller than full index", async () => {
        const bundle = await loadBundle();
        const x402 = bundle.endpoints.filter((e) => e.provider_fqn?.startsWith("x402scan/"));
        assert.ok(x402.length > 0);
        assert.ok(x402.length < bundle.endpoints.length);
    });

    it("mpp-only slice includes catalog and mppscan endpoints", async () => {
        const bundle = await loadBundle();
        const mpp = bundle.endpoints.filter((e) => e.provider_fqn?.startsWith("mppscan/") ||
            e.provider_fqn?.startsWith("mpp-catalog/"));
        const catalog = mpp.filter((e) => e.provider_fqn?.startsWith("mpp-catalog/"));
        assert.ok(catalog.length > 0);
        assert.ok(mpp.length > catalog.length);
    });

    it("full index beats every baseline on messy discover@3", async () => {
        const bundle = await loadBundle();
        const { loadMessyQueries } = await import("./hybrid-mvp.js");
        const queries = await loadMessyQueries();
        const full = evaluateMode(queries, bundle, "full");
        const baselines = [
            ["endpoints-only", evaluateMode(queries, bundle, "endpoints-only")],
            ["pay-skills-only", evaluateMode(queries, bundle, "pay-skills-only")],
            ["x402scan-only", evaluateMode(queries, bundle, "x402scan-only")],
            ["mpp-only", evaluateMode(queries, bundle, "mpp-only")],
        ];

        for (const [name, other] of baselines) {
            assert.ok(full.discover_hit_at_3 >= other.discover_hit_at_3, `discover@3: full=${full.discover_hit_at_3} ${name}=${other.discover_hit_at_3}`);
            assert.ok(full.task_hit_at_3 >= other.task_hit_at_3, `task@3: full=${full.task_hit_at_3} ${name}=${other.task_hit_at_3}`);
        }

        const taskQueries = queries.filter((q) => q.expect_intent).length;
        assert.equal(full.discover_hit_at_3, taskQueries, `discover@3 must find task + candidates for all ${taskQueries} messy intent queries`);
    });

    it("runs offline compare without external APIs", async () => {
        const bundle = await loadBundle();
        const reports = await runCompareBenchmark(bundle, {
            offline: true,
            methods: ["full", "x402scan-only", "mpp-only"],
        });
        assert.equal(reports.length, 3);
        assert.ok(reports.some((r) => r.mode === "full"));
        assert.ok(reports.some((r) => r.mode === "x402scan-only"));
        assert.ok(reports.some((r) => r.mode === "mpp-only"));
    });
});