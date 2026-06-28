#!/usr/bin/env node
/**
 * Per-intent binding-precision proxy (roadmap #0 of docs/proposals/binding-precision.md).
 *
 * For each curated intent, over the endpoints BOUND to it, report the facet-disagreement rate —
 * the share whose typed facet contradicts the intent's facet. This is a measurable proxy for
 * "of the endpoints bound to intent X, what fraction actually do X": a `shop`-domain product
 * scraper bound to `travel.place_reviews`, or (after Stage B) a `lookup` endpoint bound to a
 * `provision` intent, is almost certainly mis-bound. Pure, read-only over dist/.
 *
 * It is a PROXY, not ground truth: it only flags endpoints whose facet is present AND contradicts
 * the intent (absence is never counted). It is exactly the signal the domain/action gates target,
 * so before/after deltas here measure the gates' effect on binding precision.
 *
 * Usage: node scripts/binding-precision.mjs [distDir]   (default ./dist)
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const distDir = path.resolve(process.argv[2] ?? path.join(ROOT, "dist"));

// Mirrors DOMAIN_COMPAT in src/bind/select-policy.ts — KEEP IN SYNC. Domains that legitimately
// serve each other: `maps` POI/reviews serve `travel`; the endpoint vocab splits `crypto` out of
// the intent vocab's `finance`.
const DOMAIN_COMPAT = { travel: ["maps"], maps: ["travel"], finance: ["crypto"], crypto: ["finance"] };
const domainCompatible = (ed, id) => ed === id || (DOMAIN_COMPAT[id] ?? []).includes(ed);

function host(origin) {
  try {
    return new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return origin ?? "unknown";
  }
}

async function main() {
  const caps = JSON.parse(await readFile(path.join(distDir, "capabilities.json"), "utf8")).capabilities;
  const eps = JSON.parse(await readFile(path.join(distDir, "endpoints.json"), "utf8")).endpoints;

  const boundByIntent = new Map();
  for (const ep of eps) {
    for (const id of ep.capabilities ?? []) {
      const list = boundByIntent.get(id) ?? boundByIntent.set(id, []).get(id);
      list.push(ep);
    }
  }

  const rows = [];
  let totBound = 0, totDomMis = 0, totDomDen = 0, totActMis = 0, totActDen = 0;
  for (const cap of caps) {
    const idom = cap.facets?.domain;
    const iact = cap.facets?.action;
    const bound = boundByIntent.get(cap.id) ?? [];
    if (!bound.length) continue;
    let domMis = 0, domDen = 0, actMis = 0, actDen = 0;
    const offenders = [];
    for (const ep of bound) {
      const ed = ep.facets?.domain;
      const ea = ep.facets?.action;
      if (idom && ed) {
        domDen++;
        if (!domainCompatible(ed, idom)) {
          domMis++;
          if (offenders.length < 6)
            offenders.push(`[${ed}] ${host(ep.origin)} :: ${(ep.summary ?? "").slice(0, 64)}`);
        }
      }
      if (iact && ea) {
        actDen++;
        if (ea !== iact) actMis++; // action compatibility refined via spec/action-compat.json in Stage B
      }
    }
    totBound += bound.length;
    totDomMis += domMis; totDomDen += domDen; totActMis += actMis; totActDen += actDen;
    rows.push({
      id: cap.id, domain: idom ?? null, action: iact ?? null, bound: bound.length,
      domain_mismatch: domMis, domain_denom: domDen, domain_rate: domDen ? domMis / domDen : null,
      action_mismatch: actMis, action_denom: actDen, action_rate: actDen ? actMis / actDen : null,
      offenders,
    });
  }
  rows.sort((a, b) => (b.domain_rate ?? -1) - (a.domain_rate ?? -1) || b.domain_mismatch - a.domain_mismatch);

  const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");
  console.log(`\nBinding precision (proxy) — ${distDir}`);
  console.log(`  intents with bindings: ${rows.length}`);
  console.log(`  domain mismatch (corpus): ${totDomMis}/${totDomDen} (${pct(totDomMis, totDomDen)}) of facet-comparable bindings`);
  console.log(`  action mismatch (corpus): ${totActMis}/${totActDen} (${pct(totActMis, totActDen)})  [0 until Stage B classifies endpoint action]`);

  console.log(`\nWorst intents by domain-mismatch rate (bound ≥ 10):`);
  for (const r of rows.filter((r) => r.bound >= 10 && r.domain_rate).slice(0, 15)) {
    console.log(`  ${pct(r.domain_mismatch, r.domain_denom).padStart(6)}  ${r.domain_mismatch}/${r.domain_denom}  ${r.id} [${r.domain}]  (bound ${r.bound})`);
    for (const o of r.offenders.slice(0, 3)) console.log(`            ${o}`);
  }

  const outPath = path.join(distDir, "binding-precision.json");
  await writeFile(outPath, JSON.stringify({
    generated_over: distDir,
    corpus: {
      intents_with_bindings: rows.length,
      domain_mismatch: totDomMis, domain_denom: totDomDen,
      action_mismatch: totActMis, action_denom: totActDen,
    },
    intents: rows,
  }, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
