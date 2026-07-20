import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { EndpointRecord } from "../core/types.js";
import {
  collectPayTos,
  mergeUsage,
  enrichUsageOnEndpoints,
  BASE_USDC,
} from "./enrich-usage.js";
import { usageScore } from "../bind/select-policy.js";
import { MIN_SUMMARY_CHARS, gradeStructural } from "../bind/quality-gate.js";

function ep(partial: Partial<EndpointRecord> & { path: string }): EndpointRecord {
  return {
    id: "a".repeat(64),
    origin: "https://example.com",
    method: "GET",
    summary: "test",
    payment: { paid: true, rails: [{ protocol: "x402" }] },
    search_text: "test",
    built_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("collectPayTos", () => {
  it("dedupes wallets and tracks origins (service-level)", () => {
    const a = ep({
      id: "1".repeat(64),
      origin: "https://svc.example",
      path: "/a",
      payment: {
        paid: true,
        rails: [{ protocol: "x402" }],
        live_challenge: [
          {
            protocol: "x402",
            accepts: [{ payTo: "0xAbc", network: "eip155:8453", asset: BASE_USDC }],
          },
        ],
      },
    });
    const b = ep({
      id: "2".repeat(64),
      origin: "https://svc.example",
      path: "/b",
      payment: {
        paid: true,
        rails: [{ protocol: "x402" }],
        live_challenge: [
          { protocol: "x402", accepts: [{ payTo: "0xabc", network: "eip155:8453" }] },
        ],
      },
    });
    const refs = collectPayTos([a, b]);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.endpointIds.length, 2);
    assert.deepEqual(refs[0]!.origins, ["https://svc.example"]);
  });

  it("includes OpenAPI-declared payTos when live_challenge is missing", () => {
    const a = ep({
      id: "6".repeat(64),
      origin: "https://api.syntalic.com",
      path: "/v1/shopper/best-price",
      payment: {
        paid: true,
        rails: [{ protocol: "x402" }],
        declared_pay_tos: [
          { payTo: "0xe2e662cF219025AFC0C9Bf850b6a2B0a0b5517fe", source: "x-faremeter-assets" },
        ],
      },
    });
    const refs = collectPayTos([a]);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.payTo.toLowerCase(), "0xe2e662cf219025afc0c9bf850b6a2b0a0b5517fe");
  });
});

describe("mergeUsage activity", () => {
  it("marks active if any wallet is active", () => {
    const m = mergeUsage([
      {
        active: false,
        stage: "activity",
        transactions: 0,
        observed_at: "2026-01-01T00:00:00Z",
        source: "base-blockscout",
        pay_tos: ["0xa"],
      },
      {
        active: true,
        stage: "activity",
        transactions: 1,
        observed_at: "2026-01-01T00:00:00Z",
        source: "solana-rpc",
        pay_tos: ["SolX"],
      },
    ]);
    assert.equal(m!.active, true);
    assert.equal(m!.source, "mixed");
  });
});

describe("stage activity probe + drop", () => {
  it("drops endpoints whose only payTo is inactive", async () => {
    const payTo = "0x2b6D4988Db4723E6908Db86Ab2b8dFBc51FC32C5";
    const dead = ep({
      id: "3".repeat(64),
      path: "/dead",
      payment: {
        paid: true,
        rails: [{ protocol: "x402" }],
        live_challenge: [
          { protocol: "x402", accepts: [{ payTo, network: "eip155:8453", asset: BASE_USDC }] },
        ],
      },
    });
    const free = ep({
      id: "4".repeat(64),
      path: "/free",
      payment: { paid: false, rails: [] },
    });

    const fetchImpl = async (): Promise<Response> =>
      new Response(JSON.stringify({ status: "1", result: [] }), { status: 200 });

    const r = await enrichUsageOnEndpoints([dead, free], {
      stage: "activity",
      dropInactive: true,
      fetchImpl: fetchImpl as typeof fetch,
      maxWallets: 10,
    });
    assert.equal(r.wallets_inactive, 1);
    assert.equal(r.endpoints_dropped_inactive, 1);
    assert.equal(r.kept.length, 1);
    assert.equal(r.kept[0]!.path, "/free");
  });

  it("keeps endpoints when activity is present", async () => {
    const payTo = "0x2b6D4988Db4723E6908Db86Ab2b8dFBc51FC32C5";
    const live = ep({
      id: "5".repeat(64),
      path: "/live",
      payment: {
        paid: true,
        rails: [{ protocol: "x402" }],
        live_challenge: [
          { protocol: "x402", accepts: [{ payTo, network: "eip155:8453", asset: BASE_USDC }] },
        ],
      },
    });
    const fetchImpl = async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          status: "1",
          result: [{ from: "0xpayer", to: payTo.toLowerCase(), value: "1000", tokenDecimal: "6" }],
        }),
        { status: 200 },
      );

    const r = await enrichUsageOnEndpoints([live], {
      stage: "activity",
      dropInactive: true,
      fetchImpl: fetchImpl as typeof fetch,
    });
    assert.equal(r.wallets_active, 1);
    assert.equal(r.endpoints_dropped_inactive, 0);
    assert.equal(r.kept.length, 1);
    assert.equal(live.usage?.active, true);
    assert.equal(live.usage?.stage, "activity");
  });
});

describe("usageScore ranking term", () => {
  it("is zero without volume and for inactive stage-activity stamps", () => {
    const bare = ep({ path: "/x" });
    assert.equal(usageScore(bare, 6), 0);
    const inactive = ep({
      path: "/y",
      usage: {
        active: false,
        stage: "activity",
        transactions: 0,
        observed_at: "2026-01-01T00:00:00Z",
        source: "base-blockscout",
      },
    });
    assert.equal(usageScore(inactive, 6), 0);
  });
});

describe("summary threshold allows stableupload-length lines", () => {
  it("passes DELETE-domain-length summary (≥32)", () => {
    const r = gradeStructural({
      id: "c".repeat(64),
      origin: "https://stableupload.dev",
      method: "DELETE",
      path: "/api/site/domain",
      summary: "Detach a custom domain from a site.",
      operation_id: "site_domain",
      tags: ["Site"],
      inputs: ["uploadId"],
      payment: { paid: false, rails: [] },
      responses: { has200: true, has402: true },
      search_text: "",
      built_at: "2026-01-01T00:00:00Z",
      input_schema_ref: "a".repeat(64),
    } as EndpointRecord);
    assert.ok(MIN_SUMMARY_CHARS <= 32);
    assert.equal(r.verdict, "pass", r.reasons.join(";"));
  });
});
