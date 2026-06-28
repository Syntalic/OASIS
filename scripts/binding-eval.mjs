#!/usr/bin/env node
// Endpoint-level binding-precision eval. Runs each probe through the FULL oasis_find pipeline
// under several gate configs (env-toggled), then scores whether the RIGHT endpoint class ranks
// on top — the thing the host-level dogfooding gold cannot see.
//
//   set -a; . ./.env; set +a
//   node scripts/binding-eval.mjs
//
// Self-spawns a worker subprocess per config so each gets its own load-time gate env.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PROBES = JSON.parse(readFileSync(new URL("../eval/binding-probes.json", import.meta.url))).probes;

// ---- worker: run all probes under the current env, emit JSON to stdout ----
if (process.argv.includes("--worker")) {
  const { handleTool } = await import(new URL("../mcp/tools.mjs", import.meta.url).href);
  const out = {};
  for (const p of PROBES) {
    const r = await handleTool("oasis_find", { query: p.query, limit: 8 });
    out[p.key] = (r.endpoints || []).map((e) => ({ url: e.url, summary: e.summary || "" }));
  }
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// ---- parent ----
const CONFIGS = [
  { name: "off", env: {} },
  { name: "mod", env: { OASIS_ACTION_PENALTY: "30", OASIS_DOMAIN_PENALTY: "10", OASIS_ENTITY_PENALTY: "25" } },
  { name: "full", env: { OASIS_ACTION_PENALTY: "60", OASIS_DOMAIN_PENALTY: "20", OASIS_ENTITY_PENALTY: "40" } },
];
const self = fileURLToPath(import.meta.url);
function run(env) {
  const buf = execFileSync(process.execPath, [self, "--worker"], {
    env: { ...process.env, RATE_LIMIT: "0", ...env },
    stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024, encoding: "utf8",
  });
  return JSON.parse(buf);
}

const pathOf = (u) => (u || "").replace(/^https?:\/\//, "").replace(/^[^/]+/, "");
const rx = (s) => (s ? new RegExp(s, "i") : null);
function classify(probe, ep) {
  const p = pathOf(ep.url), rel = rx(probe.relevant), relP = rx(probe.relevant_path), dec = rx(probe.decoy);
  const relPath = !!(relP && relP.test(p));               // the URL path is authoritative about what the endpoint DOES
  const decHit = !!(dec && dec.test(`${ep.summary} ${p}`));
  const isRel = relPath || ((rel && rel.test(ep.summary)) && !decHit);
  return { relevant: isRel, decoy: decHit && !relPath };
}
const pAtK = (probe, eps, k) => { const t = eps.slice(0, k); return t.length ? t.filter((e) => classify(probe, e).relevant).length / t.length : 0; };
const firstRel = (probe, eps) => { const i = eps.findIndex((e) => classify(probe, e).relevant); return i < 0 ? null : i + 1; };
const decoysAtK = (probe, eps, k) => eps.slice(0, k).filter((e) => classify(probe, e).decoy).length;

console.error("running configs:", CONFIGS.map((c) => c.name).join(", "), "…");
const R = Object.fromEntries(CONFIGS.map((c) => [c.name, run(c.env)]));
const names = CONFIGS.map((c) => c.name);
const fr = (v) => (v == null ? ">8" : String(v));

for (const probe of PROBES) {
  const tag = probe.type === "collision" ? "🎯" : "🛡 ";
  console.log(`\n${tag} ${probe.key} [${probe.type}]  "${probe.query}"`);
  console.log(`     want: ${probe.expect}`);
  const head = names.map((n) => n.padStart(7)).join(" |");
  console.log(`     ${"".padEnd(14)} ${head}`);
  const row = (label, fn) => console.log(`     ${label.padEnd(14)} ${names.map((n) => String(fn(R[n][probe.key] || [])).padStart(7)).join(" |")}`);
  row("first-true", (eps) => fr(firstRel(probe, eps)));
  row("P@1", (eps) => pAtK(probe, eps, 1).toFixed(2));
  row("P@3", (eps) => pAtK(probe, eps, 3).toFixed(2));
  row("P@5", (eps) => pAtK(probe, eps, 5).toFixed(2));
  row("decoys@5", (eps) => decoysAtK(probe, eps, 5));
  for (const n of names) {
    const top = (R[n][probe.key] || []).slice(0, 5).map((e) => { const c = classify(probe, e); return `${c.relevant ? "✓" : c.decoy ? "✗" : "·"}${pathOf(e.url).slice(0, 26)}`; });
    console.log(`       ${n.padEnd(5)}: ${top.join("  ")}`);
  }
}

// ---- summary / pass-fail ----
console.log("\n" + "═".repeat(64));
const collisions = PROBES.filter((p) => p.type === "collision"), cleans = PROBES.filter((p) => p.type === "clean");
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
for (const n of names) {
  const cP3 = mean(collisions.map((p) => pAtK(p, R[n][p.key] || [], 3)));
  const cP1 = mean(collisions.map((p) => pAtK(p, R[n][p.key] || [], 1)));
  const clP3 = mean(cleans.map((p) => pAtK(p, R[n][p.key] || [], 3)));
  console.log(`  ${n.padEnd(5)}  collision P@1=${cP1.toFixed(2)} P@3=${cP3.toFixed(2)}   clean P@3=${clP3.toFixed(2)}`);
}
// regression guard: clean P@3 must not drop vs off
const base = R["off"]; let worst = 0, worstKey = "";
for (const p of cleans) for (const n of names.filter((x) => x !== "off")) {
  const d = pAtK(p, R[n][p.key] || [], 3) - pAtK(p, base[p.key] || [], 3);
  if (d < worst) { worst = d; worstKey = `${p.key}@${n}`; }
}
console.log(`\n  regression guard (clean P@3 vs off): ${worst < -0.001 ? `❌ ${worstKey} dropped ${worst.toFixed(2)}` : "✅ no clean probe regressed"}`);
