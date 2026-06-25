#!/usr/bin/env node
/**
 * Audit endpoints with no curated intent binding after enrich-facets.
 * Groups orphans by origin and surfaces high-IDF terms for gap filling.
 *
 * Usage: node scripts/orphan-audit.mjs [distDir] [--top 30]
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const distDir = path.resolve(process.argv[2] ?? path.join(ROOT, "dist"));
const topN = Number(process.argv.find((a) => a.startsWith("--top="))?.split("=")[1] ?? 40);

const STOP = new Set(
  "the a an and or of to for in on with by from get post put delete api key data your you this that is are be use using paid endpoint service via per call return returns request response price token usd usdc x402 mpp http https www com io app dev net org based one all any can will".split(
    " ",
  ),
);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map((t) => t.replace(/(ing|ed|es|s)$/, ""))
    .filter((t) => t.length > 2);
}

function host(origin) {
  try {
    return new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return origin ?? "unknown";
  }
}

async function loadIntentTerms() {
  const { loadOntologySources } = await import(`file://${path.join(ROOT, "dist/ontology/ontology.js")}`);
  const sources = await loadOntologySources(path.join(ROOT, "ontology", "intents"));
  const terms = new Set();
  for (const s of sources) {
    for (const part of [s.id, s.label, s.description, ...(s.aliases ?? [])]) {
      if (!part) continue;
      for (const t of tokenize(String(part).replace(/[._]/g, " "))) terms.add(t);
    }
  }
  return terms;
}

async function main() {
  const bundle = JSON.parse(await readFile(path.join(distDir, "index.json"), "utf8"));
  const endpoints = bundle.endpoints ?? [];
  const bound = endpoints.filter((e) => e.capabilities?.length);
  const orphans = endpoints.filter((e) => !e.capabilities?.length);
  const intentTerms = await loadIntentTerms();

  const byOrigin = new Map();
  for (const ep of orphans) {
    const h = host(ep.origin);
    const row = byOrigin.get(h) ?? { count: 0, samples: [] };
    row.count += 1;
    if (row.samples.length < 3) {
      row.samples.push({
        path: ep.path,
        summary: (ep.summary ?? "").slice(0, 120),
      });
    }
    byOrigin.set(h, row);
  }

  const df = new Map();
  const orphanTokens = orphans.map((ep) => {
    const text = `${ep.summary ?? ""} ${ep.description ?? ""} ${ep.path ?? ""} ${ep.search_text ?? ""}`;
    const toks = [...new Set(tokenize(text))];
    for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
    return toks;
  });
  const N = orphans.length;
  const uncovered = [];
  for (const [term, docFreq] of df) {
    if (intentTerms.has(term)) continue;
    const idf = Math.log(N / (1 + docFreq));
    uncovered.push({ term, docFreq, idf: idf * docFreq });
  }
  uncovered.sort((a, b) => b.idf - a.idf);

  const byPathPrefix = new Map();
  for (const ep of orphans) {
    const parts = (ep.path ?? "").split("/").filter(Boolean);
    const prefix = parts.slice(0, 2).join("/") || parts[0] || "(root)";
    byPathPrefix.set(prefix, (byPathPrefix.get(prefix) ?? 0) + 1);
  }
  const topPrefixes = [...byPathPrefix.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);

  const rate = ((bound.length / endpoints.length) * 100).toFixed(1);
  console.log(`\nOrphan audit — ${distDir}`);
  console.log(`  total:   ${endpoints.length}`);
  console.log(`  bound:   ${bound.length} (${rate}%)`);
  console.log(`  orphans: ${orphans.length}`);

  console.log(`\nTop orphan origins (by count):`);
  for (const [h, row] of [...byOrigin.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 20)) {
    console.log(`  ${row.count.toString().padStart(5)}  ${h}`);
    for (const s of row.samples) console.log(`           ${s.path} — ${s.summary}`);
  }

  console.log(`\nTop uncovered terms (not in intent vocab):`);
  for (const row of uncovered.slice(0, 25)) {
    console.log(`  ${row.docFreq.toString().padStart(5)} docs  idf×df=${row.idf.toFixed(1).padStart(6)}  ${row.term}`);
  }

  console.log(`\nTop orphan path prefixes:`);
  for (const [pfx, n] of topPrefixes.slice(0, 25)) {
    console.log(`  ${n.toString().padStart(5)}  /${pfx}`);
  }

  const out = {
    total: endpoints.length,
    bound: bound.length,
    orphans: orphans.length,
    bind_rate: bound.length / endpoints.length,
    top_origins: [...byOrigin.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 50)
      .map(([origin, row]) => ({ origin, count: row.count, samples: row.samples })),
    uncovered_terms: uncovered.slice(0, 100),
    top_path_prefixes: topPrefixes.slice(0, 50).map(([prefix, count]) => ({ prefix, count })),
  };
  const outPath = path.join(distDir, "orphan-audit.json");
  await writeFile(outPath, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});