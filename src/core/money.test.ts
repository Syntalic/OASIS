import assert from "node:assert/strict";
import { test } from "node:test";
import { baseUnitsToUsd, decimalsFor, parseAmountHint } from "./money.js";

test("parseAmountHint pulls a $ figure", () => {
  assert.equal(parseAmountHint("$0.20/page"), 0.2);
  assert.equal(parseAmountHint("approx $1.50 per call"), 1.5);
  assert.equal(parseAmountHint(undefined), undefined);
  assert.equal(parseAmountHint("free"), undefined);
});

test("decimalsFor priority: explicit > token > fiat > default", () => {
  assert.equal(decimalsFor({ decimals: 8 }), 8);
  assert.equal(decimalsFor({ asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }), 6);
  assert.equal(decimalsFor({ currency: "usd" }), 2);
  assert.equal(decimalsFor({ currency: "0xUnknownToken000000000000000000000000beef" }), 6);
  assert.equal(decimalsFor({}), 6);
});

test("baseUnitsToUsd across encodings", () => {
  // Bazaar USDC accept: 1000 base units / 1e6
  assert.equal(baseUnitsToUsd("1000", { asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }), 0.001);
  // fiat cents
  assert.equal(baseUnitsToUsd("5", { currency: "usd" }), 0.05);
  // explicit decimals (mpp.dev)
  assert.equal(baseUnitsToUsd("1000000", { decimals: 6 }), 1);
  // dynamic / non-integer → undefined
  assert.equal(baseUnitsToUsd(null), undefined);
  assert.equal(baseUnitsToUsd("1.5"), undefined);
});
