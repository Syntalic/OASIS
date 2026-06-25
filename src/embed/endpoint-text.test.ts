import assert from "node:assert/strict";
import { test } from "node:test";
import type { EndpointRecord } from "../core/types.js";
import { endpointEmbedText, normalizeEndpointText } from "./endpoint-text.js";

test("strips pricing and payment-rail boilerplate", () => {
  const out = normalizeEndpointText("Scrape a URL for $0.01 via x402, 0.013 USDC per call");
  assert.ok(!/\$0\.01|x402|usdc/i.test(out), out);
  assert.match(out, /scrape a url/i);
});

test("strips actor/wrapper framing but keeps the capability terms", () => {
  const raw =
    'Start the "Reddit Scraper Lite" Apify actor. Pay Per Result, unlimited Reddit web scraper to crawl posts, comments, communities, and users without login';
  const out = normalizeEndpointText(raw);
  // boilerplate gone
  assert.ok(!/apify|pay per result|without login/i.test(out), out);
  // capability signal retained — this is the whole point
  for (const term of ["Reddit", "posts", "comments", "communities", "users", "scraper"]) {
    assert.match(out, new RegExp(term, "i"), `dropped capability term "${term}": ${out}`);
  }
});

test("denylist, not allowlist: leaves clean capability text untouched", () => {
  const raw = "Fetch a Reddit post with comments, subreddit feed, or user";
  assert.equal(normalizeEndpointText(raw), raw);
});

test("endpointEmbedText uses summary/description/path/inputs, never origin", () => {
  const text = endpointEmbedText({
    summary: "Fetch a Reddit post with comments",
    description: "",
    path: "/api/v1/reddit/get",
    inputs: ["url", "kind"],
    origin: "https://glim.sh",
    method: "POST",
  } as EndpointRecord);
  assert.match(text, /Reddit/);
  assert.match(text, /\/api\/v1\/reddit\/get/);
  assert.match(text, /\burl\b/);
  assert.ok(!text.includes("glim.sh"), text);
});
