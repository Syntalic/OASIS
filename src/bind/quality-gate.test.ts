import assert from "node:assert/strict";
import { test } from "node:test";
import {
  gradeEndpoint,
  gradeStructural,
  completeness,
  hasDocCore,
  hasPaymentCore,
  MIN_FIELDS,
  MIN_SUMMARY_CHARS,
} from "./quality-gate.js";
import type { EndpointRecord } from "../core/types.js";

// A well-documented paid record: long summary, description, inputs, price, rails, 402.
const base = (o: Partial<EndpointRecord>): EndpointRecord =>
  ({
    id: "a".repeat(64),
    origin: "https://e.example",
    method: "POST",
    path: "/v1/go",
    summary: "Do the thing for agents with a clear capability-first summary",
    description: "A longer description of what this endpoint does for the agent.",
    inputs: ["query"],
    payment: { paid: true, price_usd: 0.01, rails: [{ protocol: "x402" }] },
    responses: { has200: true, has402: true },
    search_text: "",
    built_at: "2026-01-01T00:00:00Z",
    ...o,
  }) as EndpointRecord;

test("drops a synthesized stub summary", () => {
  assert.equal(gradeEndpoint(base({ summary: "GET /v1/go" })).verdict, "drop");
});

test("drops well-known / meta paths", () => {
  assert.equal(gradeEndpoint(base({ path: "/.well-known/x402" })).verdict, "drop");
});

test("drops a THIN record missing doc core", () => {
  const r = gradeEndpoint({
    id: "b".repeat(64),
    origin: "https://e.example",
    method: "GET",
    path: "/x",
    summary: "Bare",
    payment: { paid: false, rails: [] },
    search_text: "",
    built_at: "2026-01-01T00:00:00Z",
  } as EndpointRecord);
  assert.equal(r.verdict, "drop");
  assert.ok(
    r.reasons.some((x) => x.startsWith("core:") || x.includes("thin") || x.includes("stub") || x.includes("content-free")),
    JSON.stringify(r.reasons),
  );
});

test("drops short summary without description (doc core)", () => {
  const r = gradeEndpoint(
    base({
      summary: "Too short",
      description: undefined,
      inputs: ["q"],
    }),
  );
  assert.equal(r.verdict, "drop");
  assert.ok(r.reasons.some((x) => x.includes("summary≥") || x.includes("description≥")), r.reasons.join(";"));
});

test("drops paid endpoint with no rails/offers/price (payment core)", () => {
  const r = gradeEndpoint(
    base({
      payment: { paid: true, rails: [] },
    }),
  );
  assert.equal(r.verdict, "drop");
  assert.ok(r.reasons.some((x) => x.includes("paid endpoint needs")), r.reasons.join(";"));
});

test("passes a well-fleshed paid endpoint", () => {
  const r = gradeEndpoint(base({}));
  assert.equal(r.verdict, "pass");
  assert.ok(r.completeness >= MIN_FIELDS);
});

test("PASSES free companion ops with good summary+inputs (stableupload-shaped)", () => {
  // Completeness often 5 (no payment flesh) — must still pass required core.
  const r = gradeStructural({
    id: "c".repeat(64),
    origin: "https://stableupload.dev",
    method: "PUT",
    path: "/api/site",
    summary: "Get a new upload URL for an existing site. Upload a new zip, then call POST /api/site/activate to re-extract.",
    operation_id: "site",
    tags: ["Site"],
    inputs: ["uploadId"],
    payment: { paid: false, rails: [] },
    responses: { has200: true, has402: true },
    search_text: "",
    built_at: "2026-01-01T00:00:00Z",
    input_schema_ref: "a".repeat(64),
  } as EndpointRecord);
  assert.equal(r.verdict, "pass", r.reasons.join(";"));
  assert.equal(r.completeness, 5); // summary, op_id, tags, inputs, has402
});

test("PASSES paid stableupload-shaped dynamic price (rails, no price_usd)", () => {
  const r = gradeStructural({
    id: "d".repeat(64),
    origin: "https://stableupload.dev",
    method: "POST",
    path: "/api/upload",
    summary: "Buy an upload slot. Agent uploads file via returned URL.",
    operation_id: "upload",
    tags: ["Upload"],
    inputs: ["filename", "contentType", "tier"],
    payment: {
      paid: true,
      rails: [
        { protocol: "x402", version: "2" },
        { protocol: "mpp", networks: ["tempo"] },
      ],
    },
    responses: { has200: true, has402: true },
    search_text: "",
    built_at: "2026-01-01T00:00:00Z",
    input_schema_ref: "b".repeat(64),
  } as EndpointRecord);
  assert.equal(r.verdict, "pass", r.reasons.join(";"));
});

test("KEEPS a free endpoint when doc core is met", () => {
  const r = gradeEndpoint(
    base({
      payment: { paid: false, rails: [] },
      operation_id: "doThing",
      tags: ["agent"],
    }),
  );
  assert.equal(r.verdict, "pass");
  assert.ok(r.flags.includes("no-payment-detected"));
});

test("flags legacy payment on a passing record", () => {
  assert.ok(gradeEndpoint(base({})).flags.includes("legacy-payment"));
});

test("completeness() counts filled fields", () => {
  assert.equal(completeness(base({})), 6);
});

test("hasDocCore accepts long summary without description", () => {
  const r = hasDocCore(
    base({
      summary: "x".repeat(MIN_SUMMARY_CHARS),
      description: undefined,
      inputs: ["a"],
    }),
  );
  assert.equal(r.ok, true);
});

test("hasPaymentCore is ok for free endpoints", () => {
  assert.equal(hasPaymentCore(base({ payment: { paid: false, rails: [] } })).ok, true);
});

test("drops a contradicted endpoint (failed live payment verification)", () => {
  const r = gradeEndpoint(base({ payment_verified: "contradicted" }));
  assert.equal(r.verdict, "drop");
  assert.ok(
    r.reasons.some((x) => /payment verification/i.test(x)),
    `expected reason about payment verification, got ${JSON.stringify(r.reasons)}`,
  );
});

test("passes a verified endpoint and includes payment-verified flag", () => {
  const r = gradeEndpoint(base({ payment_verified: "verified" }));
  assert.equal(r.verdict, "pass");
  assert.ok(
    r.flags.includes("payment-verified"),
    `expected payment-verified flag, got ${JSON.stringify(r.flags)}`,
  );
});

test("passes an unknown-verified endpoint and includes payment-unverified flag", () => {
  const r = gradeEndpoint(base({ payment_verified: "unknown" }));
  assert.equal(r.verdict, "pass");
  assert.ok(
    r.flags.includes("payment-unverified"),
    `expected payment-unverified flag, got ${JSON.stringify(r.flags)}`,
  );
});

test("backward-compat: endpoint without payment_verified field passes unchanged", () => {
  const r = gradeEndpoint(base({}));
  assert.equal(r.verdict, "pass");
  assert.ok(!r.flags.includes("payment-verified"), "should not have payment-verified flag");
  assert.ok(!r.flags.includes("payment-unverified"), "should not have payment-unverified flag");
});
