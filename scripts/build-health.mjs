#!/usr/bin/env node
// Build-time LIVENESS + HOST-HEALTH gate. Probes the index UNPAID (a healthy x402/MPP endpoint returns
// 402 on an unpaid request; a dead one returns 404/5xx/connection-error), rolls up to per-host health,
// and writes dist/endpoint-health.json — the sidecar the server reads to DROP dead endpoints / hosts and
// demote slow ones. Free (no payment). Host-correlated: ~3 probes/host covers all endpoints of that host.
//
// Guardrails against false-deads:
//   • "any endpoint on a host answers (402/2xx/4xx-shape) → host is UP" — the reliable signal.
//   • Path-param routes ({id}) can 404 on a bad param, not death — so a 404 marks an ENDPOINT dead only
//     when its path is param-free; a host is marked dead only when NOTHING on it responds.
//   • timeouts → "slow" (demote, not drop).
//
// Env: PER_HOST (default 8 — big/mixed hosts need enough samples to avoid false-deads), TIMEOUT
// (default 12000), CONC (default 20 — high concurrency saturates local sockets → false timeouts),
// MAX_HOSTS (default all). Transient timeouts/errors are retried once.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DIST = path.join(process.cwd(), "dist");
const B = JSON.parse(readFileSync(path.join(DIST, "index.json"), "utf8"));
const PER_HOST = Number(process.env.PER_HOST ?? 8);
const TIMEOUT = Number(process.env.TIMEOUT ?? 12000);
const CONC = Number(process.env.CONC ?? 20); // gentle — high concurrency saturates local sockets/DNS → false timeouts
const MAX_HOSTS = Number(process.env.MAX_HOSTS ?? 0);

const hasParam = (p) => /\{[^}]+\}/.test(p ?? "");
function classify(status, err) {
  if (err) return /abort|timeout|timed out/i.test(err) ? "slow" : "unreach";
  if (status === 402) return "alive";
  if (status >= 200 && status < 300) return "alive";
  if ([400, 401, 403, 405, 415, 422].includes(status)) return "alive"; // reachable + responding
  if (status === 404) return "dead404";
  if (status >= 500) return "dead5xx";
  if (status >= 300 && status < 400) return "alive"; // redirect = server up
  return "other";
}
async function probeOnce(url, method, timeout) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const o = { method: method || "GET", signal: ctl.signal, headers: {}, redirect: "manual" };
    if (o.method !== "GET" && o.method !== "HEAD") { o.headers["content-type"] = "application/json"; o.body = "{}"; }
    const r = await fetch(url, o);
    clearTimeout(t);
    return { status: r.status, cls: classify(r.status) };
  } catch (e) {
    clearTimeout(t);
    return { status: null, cls: classify(null, String(e?.message || e)) };
  }
}
// Retry a transient failure once (a genuine dead host stays dead; a socket/DNS hiccup recovers).
async function probe(url, method) {
  let r = await probeOnce(url, method, TIMEOUT);
  if (r.cls === "slow" || r.cls === "unreach") r = await probeOnce(url, method, TIMEOUT + 6000);
  return r;
}

// group by host, pick up to PER_HOST endpoints (param-free first) per host
const byHost = new Map();
for (const e of B.endpoints) {
  if (!byHost.has(e.origin)) byHost.set(e.origin, []);
  byHost.get(e.origin).push(e);
}
let hosts = [...byHost.entries()];
if (MAX_HOSTS) hosts = hosts.slice(0, MAX_HOSTS);
const jobs = [];
for (const [origin, eps] of hosts) {
  const sorted = [...eps].sort((a, b) => (hasParam(a.path) - hasParam(b.path)));
  for (const e of sorted.slice(0, PER_HOST)) jobs.push({ origin, id: e.id, url: `${e.origin}${e.path}`, method: e.method, param: hasParam(e.path) });
}
console.error(`probing ${jobs.length} endpoints across ${hosts.length} hosts (${PER_HOST}/host, ${TIMEOUT}ms, conc ${CONC})…`);

let i = 0; const done = [];
const t0 = Date.now?.() ?? 0; // may be undefined in some envs
await Promise.all(Array.from({ length: CONC }, async () => {
  while (i < jobs.length) { const j = jobs[i++]; const r = await probe(j.url, j.method); done.push({ ...j, ...r }); }
}));

// roll up host verdicts + collect confirmed-dead endpoint ids
const hostRec = {};
const deadIds = new Set();
for (const [origin, eps] of hosts) {
  const probes = done.filter((d) => d.origin === origin);
  const n = { alive: 0, dead404: 0, dead5xx: 0, unreach: 0, slow: 0, other: 0 };
  for (const p of probes) n[p.cls] = (n[p.cls] ?? 0) + 1;
  let verdict;
  if (n.alive > 0) verdict = "alive";                                  // anything answered → host up
  else if (n.unreach > 0 || n.dead5xx > 0) verdict = "dead";           // unreachable/broken
  else if (n.dead404 > 0 && n.slow === 0) verdict = "dead";            // nothing but 404s → gone/misconfigured
  else if (n.slow > 0) verdict = "slow";
  else verdict = "unknown";
  hostRec[origin] = { n_endpoints: eps.length, probed: probes.length, ...n, verdict };
  // confirmed-dead individual endpoints: param-free 404/5xx/unreach on an otherwise-ALIVE host
  if (verdict === "alive") for (const p of probes) if (!p.param && (p.cls === "dead404" || p.cls === "dead5xx" || p.cls === "unreach")) deadIds.add(p.id);
}

const totalEp = B.endpoints.length;
const deadHostEp = B.endpoints.filter((e) => hostRec[e.origin]?.verdict === "dead").length;
const slowHostEp = B.endpoints.filter((e) => hostRec[e.origin]?.verdict === "slow").length;
const sidecar = {
  built_at: B.built_at, index_version: B.index_version,
  params: { per_host: PER_HOST, timeout_ms: TIMEOUT },
  stats: {
    hosts: hosts.length, endpoints_covered: totalEp, endpoints_probed: jobs.length,
    hosts_alive: Object.values(hostRec).filter((h) => h.verdict === "alive").length,
    hosts_dead: Object.values(hostRec).filter((h) => h.verdict === "dead").length,
    hosts_slow: Object.values(hostRec).filter((h) => h.verdict === "slow").length,
    hosts_unknown: Object.values(hostRec).filter((h) => h.verdict === "unknown").length,
    endpoints_on_dead_hosts: deadHostEp, endpoints_on_slow_hosts: slowHostEp, confirmed_dead_endpoints: deadIds.size,
  },
  hosts: hostRec,
  dead_endpoint_ids: [...deadIds],
};
writeFileSync(path.join(DIST, "endpoint-health.json"), JSON.stringify(sidecar));
const s = sidecar.stats;
console.error(`\n=== HEALTH SIDECAR written: dist/endpoint-health.json ===`);
console.error(`hosts: ${s.hosts}  alive=${s.hosts_alive} dead=${s.hosts_dead} slow=${s.hosts_slow} unknown=${s.hosts_unknown}`);
console.error(`endpoints: ${totalEp}  on-dead-hosts=${deadHostEp} (${(100*deadHostEp/totalEp).toFixed(1)}%)  on-slow-hosts=${slowHostEp} (${(100*slowHostEp/totalEp).toFixed(1)}%)  +confirmed-dead-routes=${deadIds.size}`);
console.error(`\nDEAD hosts (would be dropped):`);
for (const [h, r] of Object.entries(hostRec).filter(([,r])=>r.verdict==="dead").sort((a,b)=>b[1].n_endpoints-a[1].n_endpoints).slice(0,25))
  console.error(`  ${h.replace(/^https?:\/\//,"").padEnd(42)} ${r.n_endpoints} endpoints  (probed ${r.probed}: 404=${r.dead404} 5xx=${r.dead5xx} unreach=${r.unreach})`);
