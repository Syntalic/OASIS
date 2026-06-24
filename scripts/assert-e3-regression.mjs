#!/usr/bin/env node
/**
 * E3 regression gate (05 §3.4): oasis discover@1/@3 must not regress vs baseline.
 * Usage: node scripts/assert-e3-regression.mjs <pre.json> <post.json>
 */
import { readFileSync } from "node:fs";

const [prePath, postPath] = process.argv.slice(2);
if (!prePath || !postPath) {
  console.error("usage: assert-e3-regression.mjs <pre.json> <post.json>");
  process.exit(2);
}

const pre = JSON.parse(readFileSync(prePath, "utf8"));
const post = JSON.parse(readFileSync(postPath, "utf8"));
const preOasis = pre.find((r) => r.method === "oasis");
const postOasis = post.find((r) => r.method === "oasis");

if (!preOasis || !postOasis) {
  console.error("missing oasis method in pre or post report");
  process.exit(1);
}

const TOL = 2.0; // percentage points (baseline − 0.02 on 0–1 scale ≈ 2pp on 0–100 scale)
const checks = [
  ["disc_at_1", preOasis.disc_at_1, postOasis.disc_at_1],
  ["disc_at_3", preOasis.disc_at_3, postOasis.disc_at_3],
  ["mrr", preOasis.mrr, postOasis.mrr],
];

let failed = false;
for (const [name, baseline, current] of checks) {
  const floor = baseline - (name === "mrr" ? 0.02 : TOL);
  const ok = current >= floor;
  console.log(
    `${name}: baseline=${baseline} current=${current} floor=${floor} ${ok ? "OK" : "FAIL"}`,
  );
  if (!ok) failed = true;
}

if (failed) process.exit(1);
console.log("E3 regression gate passed");