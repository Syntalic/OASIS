import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lintMethodology, intentDomainPrefix } from "./methodology-lint.js";
import { validateSourceIntent, validateAllSources } from "./validate-source.js";
import type { CuratedIntentSource } from "../core/types.js";

const goodBase: CuratedIntentSource = {
  id: "finance.stock_quote",
  label: "Get a stock quote",
  description: "Live equity price quote for a ticker symbol.",
  aliases: ["stock price", "equity quote", "share price", "ticker price", "stock quote lookup"],
  consumes: [{ entity: "Ticker", role: "identifier" }],
  produces: [{ entity: "MarketQuote", role: "payload" }],
  facets: { domain: "finance", action: "lookup" },
};

describe("intentDomainPrefix", () => {
  it("splits dotted ids", () => {
    assert.equal(intentDomainPrefix("finance.stock_quote"), "finance");
    assert.equal(intentDomainPrefix("web.search"), "web");
    assert.equal(intentDomainPrefix("nodot"), null);
  });
});

describe("lintMethodology", () => {
  it("accepts a well-formed intent with no findings", () => {
    const findings = lintMethodology(goodBase);
    assert.equal(findings.length, 0, findings.map((f) => f.detail).join(";"));
  });

  it("ERRORs when facets.domain disagrees with id prefix", () => {
    const findings = lintMethodology({
      ...goodBase,
      facets: { domain: "blockchain", action: "lookup" },
    });
    assert.ok(findings.some((f) => f.level === "error" && f.code === "domain_prefix_mismatch"));
  });

  it("ERRORs on self-links", () => {
    const findings = lintMethodology({
      ...goodBase,
      links: [{ type: "sibling_of", to: "finance.stock_quote" }],
    });
    assert.ok(findings.some((f) => f.code === "self_link" && f.level === "error"));
  });

  it("WARNs on cross-domain links without a boundary note", () => {
    const findings = lintMethodology({
      ...goodBase,
      links: [{ type: "sibling_of", to: "blockchain.spot_price" }],
    });
    assert.ok(findings.some((f) => f.code === "cross_domain_link_missing_note" && f.level === "warning"));
  });

  it("does not warn when cross-domain link has a note", () => {
    const findings = lintMethodology({
      ...goodBase,
      links: [
        {
          type: "sibling_of",
          to: "blockchain.spot_price",
          note: "same price-lookup verb; asset-form subject differs (stock vs crypto)",
        },
      ],
    });
    assert.ok(!findings.some((f) => f.code === "cross_domain_link_missing_note"));
  });

  it("WARNs on thin aliases", () => {
    const findings = lintMethodology({ ...goodBase, aliases: ["one"] });
    assert.ok(findings.some((f) => f.code === "thin_aliases"));
  });
});

describe("validate-source methodology integration", () => {
  it("fails validateSourceIntent on domain prefix mismatch", async () => {
    const r = await validateSourceIntent({
      ...goodBase,
      id: "finance.fake_new_intent_xyz",
      facets: { domain: "ai" },
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("methodology") && e.includes("domain")), r.errors.join(";"));
  });

  it("every shipped ontology/intents/*.yaml still validates (no regression)", async () => {
    const all = await validateAllSources();
    assert.ok(all.length >= 100, `expected full taxonomy, got ${all.length}`);
    const failures = all.filter((x) => !x.result.valid);
    assert.equal(
      failures.length,
      0,
      failures.map((f) => `${f.file}: ${f.result.errors.join("; ")}`).join("\n"),
    );
  });
});
