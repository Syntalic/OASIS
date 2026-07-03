import assert from "node:assert/strict";
import { test } from "node:test";
import { gradeEndpoint, completeness } from "./quality-gate.js";
import type { EndpointRecord } from "../core/types.js";

// A 6-field record: summary, description, inputs, price_usd, rails, has_402.
const base = (o: Partial<EndpointRecord>): EndpointRecord =>
  ({
    id: "a".repeat(64),
    origin: "https://e.example",
    method: "POST",
    path: "/v1/go",
    summary: "Do the thing for agents",
    description: "A longer description of what this endpoint does.",
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

test("drops a THIN record (<5 fields), reporting completeness", () => {
  const r = gradeEndpoint({
    id: "b".repeat(64), origin: "https://e.example", method: "GET", path: "/x",
    summary: "Bare endpoint", payment: { paid: false, rails: [] }, search_text: "", built_at: "2026-01-01T00:00:00Z",
  } as EndpointRecord);
  assert.equal(r.verdict, "drop");
  assert.ok(r.reasons[0].includes("thin"), JSON.stringify(r.reasons));
  assert.equal(r.completeness, 1);
});

test("passes a well-fleshed endpoint and attaches completeness", () => {
  const r = gradeEndpoint(base({}));
  assert.equal(r.verdict, "pass");
  assert.equal(r.completeness, 6);
});

test("KEEPS a free endpoint when it has enough other fields", () => {
  const r = gradeEndpoint(base({
    payment: { paid: false, rails: [] }, // no payment, but summary+description+inputs+op_id+tags+has402 = 6
    operation_id: "doThing",
    tags: ["agent"],
  }));
  assert.equal(r.verdict, "pass");
  assert.ok(r.flags.includes("no-payment-detected"));
});

test("flags legacy payment on a passing record", () => {
  assert.ok(gradeEndpoint(base({})).flags.includes("legacy-payment"));
});

test("completeness() counts filled fields", () => {
  assert.equal(completeness(base({})), 6);
});

// Task 8: payment_verified gate + flags

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
