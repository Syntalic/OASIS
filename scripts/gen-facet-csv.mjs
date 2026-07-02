#!/usr/bin/env node
/**
 * Emit a CSV of endpoints for OFFLINE facet labeling (action + domain correction) by an
 * external high-quality model, plus a labeling rubric. The returned CSV becomes an authored
 * facet-override artifact (applied like ontology/bindings — authored beats the regex deriver).
 *
 * Usage:
 *   node scripts/gen-facet-csv.mjs                       # validation slice (default)
 *   node scripts/gen-facet-csv.mjs --scope bound         # every bound endpoint (~11.8k)
 *   node scripts/gen-facet-csv.mjs --scope all           # every endpoint (~21.8k)
 *   node scripts/gen-facet-csv.mjs --out path/file.csv
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const distDir = path.join(ROOT, "dist");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const scope = arg("--scope", "slice");
const outCsv = path.resolve(arg("--out", path.join(ROOT, "endpoint-facets-slice.csv")));
const outDoc = outCsv.replace(/\.csv$/, "") + ".RUBRIC.md";

// The 12-value FacetAction enum (src/core/types.ts) + plain definitions for the labeler.
const ACTION_DEFS = {
  search: "Find/list matching items by a query (web, people, jobs, places, product search).",
  lookup: "Fetch known data by id/params — get/read/resolve/check/list-by-id/whois/price-now.",
  compare: "Compare the SAME item across sources (e.g. one product's price across retailers).",
  extract: "Pull structured data OUT of unstructured input — OCR, PDF/table parse, scrape→data.",
  generate: "Create NEW content from a prompt — image generation, text-to-speech, text generation.",
  transform: "Convert/modify EXISTING content — translate, resize, transcode, reformat.",
  validate: "Verify correctness/validity — email validation, verify a domain/address, check a signature.",
  send: "Deliver a message/payload outward — send email/SMS, post a message, dispatch a webhook.",
  provision: "Create/register/allocate/PURCHASE a resource — register a domain, create an inbox, buy.",
  analyze: "Score/assess/derive insight — sentiment, risk score, analytics, ratings, trends.",
  execute: "Run a computation/transaction/RPC — execute code, submit a trade, blockchain RPC call.",
  monitor: "Watch/track over time or alert — price alerts, status watch, change/depeg tracking.",
};
const DOMAINS = "shop ai data web comms finance maps travel realestate social media marketing analyst cloud compute devtools storage search crypto".split(" ");

const csvCell = (v) => {
  const s = (v ?? "").toString().replace(/\r?\n/g, " ").trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const caps = JSON.parse(await readFile(path.join(distDir, "capabilities.json"), "utf8")).capabilities;
  const eps = JSON.parse(await readFile(path.join(distDir, "endpoints.json"), "utf8")).endpoints;

  // Anchor the rubric: which curated intents carry each action value (so labels align with the ontology).
  const intentsByAction = new Map();
  for (const c of caps) {
    const a = c.facets?.action;
    if (!a) continue;
    (intentsByAction.get(a) ?? intentsByAction.set(a, []).get(a)).push(c.id);
  }

  // Stable join key — prefer ep.id, fall back to origin|method|path; assert uniqueness.
  const keyOf = (e) => e.id || `${e.origin}|${e.method}|${e.path}`;
  const seen = new Set();
  for (const e of eps) { const k = keyOf(e); if (seen.has(k)) throw new Error(`dup key ${k}`); seen.add(k); }

  let chosen;
  if (scope === "all") chosen = eps;
  else if (scope === "bound") chosen = eps.filter((e) => e.capabilities?.length);
  else {
    // validation slice: both collision targets (all bound) + a sample of the noisy intents
    const targets = ["cloud.domains", "travel.place_reviews"];
    const noisy = { "blockchain.rpc": 15, "finance.exchange_rates": 15, "agent.memory": 15, "shop.tcg_catalog": 15 };
    const pick = new Map();
    for (const e of eps) {
      const caps_ = e.capabilities ?? [];
      if (caps_.some((c) => targets.includes(c))) pick.set(keyOf(e), e);
    }
    for (const [intent, n] of Object.entries(noisy)) {
      let c = 0;
      for (const e of eps) {
        if (c >= n) break;
        if ((e.capabilities ?? []).includes(intent) && !pick.has(keyOf(e))) { pick.set(keyOf(e), e); c++; }
      }
    }
    chosen = [...pick.values()];
  }

  const cols = ["key", "method", "path", "origin", "summary", "description", "inputs", "bound_intents", "regex_domain", "action", "domain_corrected"];
  const lines = [cols.join(",")];
  for (const e of chosen) {
    lines.push([
      keyOf(e), e.method, e.path, e.origin,
      csvCell(e.summary), csvCell((e.description ?? "").slice(0, 400)),
      csvCell((e.inputs ?? []).join(" | ")),
      csvCell((e.capabilities ?? []).join(" | ")),
      e.facets?.domain ?? "",
      "", "", // action (FILL), domain_corrected (FILL only if regex_domain wrong)
    ].map(csvCell).join(","));
  }
  await writeFile(outCsv, lines.join("\n") + "\n");

  const rubric = [
    `# Facet labeling rubric — fill \`action\` (required) and \`domain_corrected\` (only if wrong)`,
    ``,
    `Classify what each ENDPOINT actually does, independently — do NOT copy the bound intent's facet.`,
    `Edit ONLY the \`action\` and \`domain_corrected\` columns. Never change \`key\` (it joins your labels back).`,
    ``,
    `## \`action\` — pick exactly one (closed enum; these are the values the ontology already uses):`,
    ...Object.entries(ACTION_DEFS).map(([k, v]) => {
      const ex = (intentsByAction.get(k) ?? []).slice(0, 4).join(", ");
      return `- **${k}** — ${v}${ex ? `  _(intents: ${ex})_` : "  _(no intent uses this yet)_"}`;
    }),
    ``,
    `## \`domain_corrected\` — leave BLANK if \`regex_domain\` is correct; else pick one:`,
    `\`${DOMAINS.join(" | ")}\``,
    `(The regex deriver is noisy — e.g. it tags a "store a document scoped to your wallet" endpoint`,
    `as \`crypto\` because of the word "wallet". Fix only clear errors; blank = regex was fine.)`,
    ``,
    `## Notes`,
    `- "register/renew/buy a domain" → action **provision**; "check if a domain is available" → **lookup**.`,
    `- "Amazon product reviews", "Wirecutter reviews" → domain **shop** (these are the bleed we're separating from travel).`,
    `- Return the CSV with the same columns; I join on \`key\` and apply your labels as authored overrides.`,
  ].join("\n");
  await writeFile(outDoc, rubric + "\n");

  console.log(`scope=${scope}  rows=${chosen.length}`);
  console.log(`CSV    → ${outCsv}`);
  console.log(`RUBRIC → ${outDoc}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
